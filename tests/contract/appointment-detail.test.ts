import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTRACT_NOW,
  COLOR,
  CORTE,
  LAVADO,
  seedContractDatabase,
} from './helpers/seed-contract-db';
import { expectMatchesContract, responseSchema } from './helpers/openapi';
import { closeTestDb, testPool, truncateAppointments } from '../integration/helpers/test-db';

const clock = { current: CONTRACT_NOW };
vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => clock.current },
}));

vi.mock('@/infrastructure/security/rate-limiter', () => ({
  rateLimiter: () => ({
    check: async () => ({ allowed: true }),
    rejections: () => ({ APPOINTMENT_LOOKUP: 0, BOOKING_CONFIRMATION: 0 }),
    trackedKeyCount: () => 0,
  }),
}));

const { GET } = await import('@/app/api/appointments/[token]/route');
const { POST } = await import('@/app/api/appointments/route');

const detailSchema = responseSchema('/appointments/{token}', 'get', '200');
const notFoundSchema = responseSchema('/appointments/{token}', 'get', '404');

/** Friday 2026-09-18 at 11:30, salon time. */
const FRIDAY_1130 = '2026-09-18T09:30:00Z';

async function book(
  serviceIds: string | readonly string[] = CORTE,
  startsAt = FRIDAY_1130,
): Promise<string> {
  const response = await POST(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceIds: [serviceIds].flat(),
        startsAt,
        customer: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
      }),
    }),
  );

  const location = response.headers.get('Location');
  if (location === null) throw new Error('the fixture booking did not redirect');
  return location.replace('/cita/', '').replace('?nueva=1', '');
}

function lookup(token: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/appointments/${token}`), {
    params: Promise.resolve({ token }),
  });
}

beforeAll(async () => {
  await seedContractDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  clock.current = CONTRACT_NOW;
});

describe('GET /api/appointments/{token} — AppointmentDetail', () => {
  it('answers 200 with a body shaped like the contract', async () => {
    const response = await lookup(await book());

    expect(response.status).toBe(200);
    expectMatchesContract(detailSchema, await response.json());
  });

  it('shows the appointment with its hours already written out (FR-033)', async () => {
    const body = (await (await lookup(await book(COLOR))).json()) as {
      view: string;
      date: string;
      startsLocalTime: string;
      endsLocalTime: string;
      durationMinutes: number;
      services: { name: string; priceCents: number }[];
    };

    expect(body.view).toBe('CONFIRMED');
    expect(body.date).toBe('2026-09-18');
    expect(body.startsLocalTime).toBe('11:30');
    expect(body.endsLocalTime).toBe('13:00');
    expect(body.durationMinutes).toBe(90);
    expect(body.services).toMatchObject([{ name: 'Color', priceCents: 5500 }]);
  });

  it('offers both actions while there is more than 24 hours to go', async () => {
    const body = (await (await lookup(await book())).json()) as {
      canCancel: boolean;
      canReschedule: boolean;
      unavailableReason: string | null;
    };

    expect(body.canCancel).toBe(true);
    expect(body.canReschedule).toBe(true);
    expect(body.unavailableReason).toBeNull();
  });

  it('explains why the actions are gone once the deadline has passed (FR-028)', async () => {
    const token = await book();
    clock.current = CONTRACT_NOW.add({ hours: 60 }); // inside the 24 hour deadline

    const body = (await (await lookup(token)).json()) as {
      canCancel: boolean;
      unavailableReason: string | null;
    };

    expect(body.canCancel).toBe(false);
    // The reason names the salon phone as the way out.
    expect(body.unavailableReason).toMatch(/\d/);
  });

  it('derives COMPLETED from the clock, with no state change in the database', async () => {
    const token = await book();
    clock.current = CONTRACT_NOW.add({ hours: 24 * 5 });

    const body = (await (await lookup(token)).json()) as { view: string };
    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment');

    expect(body.view).toBe('COMPLETED');
    expect(rows[0]?.status).toBe('CONFIRMED');
  });

  it('carries the salon details and no salon identifier', async () => {
    const body = (await (await lookup(await book())).json()) as {
      salon: Record<string, unknown>;
    };

    expect(body.salon['phone']).toBeDefined();
    expect(Object.keys(body.salon)).not.toContain('id');
  });

  it('never leaks another appointment or the agenda (FR-018, BR-009)', async () => {
    const mine = await book(CORTE, FRIDAY_1130);
    await book(CORTE, '2026-09-18T12:00:00Z');

    const raw = await (await lookup(mine)).text();

    expect(raw).toContain('11:30');
    expect(raw).not.toContain('14:00');
    // No customer data of any kind travels in the response.
    expect(raw).not.toContain('600112233');
    expect(raw).not.toContain('ana@example.com');
  });
});

describe('404 — the neutral answer', () => {
  it('answers a body shaped like the contract for a token that resolves to nothing', async () => {
    const response = await lookup('a'.repeat(43));

    expect(response.status).toBe(404);
    expectMatchesContract(notFoundSchema, await response.json());
  });

  it('says what to do next, as every error must (SC-012)', async () => {
    const body = (await (await lookup('a'.repeat(43))).json()) as { nextAction: string };

    expect(body.nextAction.length).toBeGreaterThan(0);
  });
});

describe('an appointment of several services (005, contract 2.0.0)', () => {
  it('lists every service as booked, in catalogue order, with their sum and total price', async () => {
    const response = await lookup(await book([COLOR, CORTE]));
    const body = (await response.clone().json()) as {
      services: { id: string; name: string; priceLabel: string }[];
      durationMinutes: number;
      endsLocalTime: string;
      price: { kind: string; knownCents: number | null; label: string };
    };

    expect(response.status).toBe(200);
    expectMatchesContract(detailSchema, await response.json());
    expect(body.services.map((service) => service.name)).toEqual(['Corte', 'Color']);
    expect(body.durationMinutes).toBe(120);
    expect(body.endsLocalTime).toBe('13:30');
    expect(body.price).toEqual({ kind: 'ALL_PRICED', knownCents: 7300, label: '73,00 €' });
  });

  it('gives an appointment of one service its price too', async () => {
    const body = (await (await lookup(await book())).json()) as {
      services: unknown[];
      price: { kind: string; label: string };
    };

    expect(body.services).toHaveLength(1);
    expect(body.price).toMatchObject({ kind: 'ALL_PRICED', label: '18,00 €' });
  });
});

describe('an appointment without a price (005, FR-019, FR-020)', () => {
  it('shows "Precio a consultar en el salón" for the service and the total, never 0', async () => {
    const response = await lookup(await book(LAVADO));
    const body = (await response.clone().json()) as {
      services: { priceCents: number | null; priceLabel: string }[];
      price: { kind: string; knownCents: number | null; label: string };
    };

    expectMatchesContract(detailSchema, await response.json());
    expect(body.services).toMatchObject([
      { priceCents: null, priceLabel: 'Precio a consultar en el salón' },
    ]);
    expect(body.price).toEqual({
      kind: 'NONE_PRICED',
      knownCents: null,
      label: 'Precio a consultar en el salón',
    });
  });
});

describe('GET /appointments/{token}: who cancelled it (2.1.0, 002 D-037)', () => {
  beforeAll(async () => {
    await seedContractDatabase();
  });

  beforeEach(async () => {
    clock.current = CONTRACT_NOW;
    await truncateAppointments();
  });

  it.each([
    ['nobody, while it is confirmed', null, null],
    ['the client', 'CUSTOMER', 'CUSTOMER'],
    ['the salon', 'OWNER', 'OWNER'],
  ] as const)('says %s', async (_name, by, expected) => {
    const token = await book();
    if (by !== null) {
      await testPool().query(
        "UPDATE appointment SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $1",
        [by],
      );
    }

    const body = await (await lookup(token)).json();

    expectMatchesContract(detailSchema, body);
    expect(body.cancelledBy).toBe(expected);
  });
});
