import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLOR, CONTRACT_NOW, CORTE, seedContractDatabase } from './helpers/seed-contract-db';
import { testPool } from '../integration/helpers/test-db';
import { expectMatchesContract, responseSchema } from './helpers/openapi';
import { closeTestDb, truncateAppointments } from '../integration/helpers/test-db';

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

/**
 * The per-IP limit is driven from the test rather than exhausted for real:
 * every request in this file shares one client IP, so a real window would make
 * the order of the tests decide their outcome.
 */
const limiter = { allowed: true };
vi.mock('@/infrastructure/security/rate-limiter', () => ({
  rateLimiter: () => ({
    check: async () => ({ allowed: limiter.allowed }),
    rejections: () => ({ APPOINTMENT_LOOKUP: 0, BOOKING_CONFIRMATION: 0 }),
    trackedKeyCount: () => 0,
  }),
}));

const { POST } = await import('@/app/api/appointments/route');

const validationSchema = responseSchema('/appointments', 'post', '400');
const conflictSchema = responseSchema('/appointments', 'post', '409');
const limitSchema = responseSchema('/appointments', 'post', '422');
const rateLimitSchema = responseSchema('/appointments', 'post', '429');

/** Friday 2026-09-18 at 11:30, salon time. */
const FRIDAY_1130 = '2026-09-18T09:30:00Z';

function bookingRequest(body: unknown): Request {
  return new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    serviceIds: [CORTE],
    startsAt: FRIDAY_1130,
    customer: { name: 'Ana López', phone: '600 11 22 33', email: 'ana@example.com' },
    ...overrides,
  };
}

/** In the catalogue, but no longer offered (FR-015). */
const RETIRED = '00000000-0000-4000-8000-000000000016';

beforeAll(async () => {
  await seedContractDatabase();
  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Retirado', 30, 1000, false, 9)`,
    [RETIRED],
  );
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  limiter.allowed = true;
});

describe('303 — the confirmation is a redirect, not a created resource (D-010)', () => {
  it('answers 303 with a Location carrying the token', async () => {
    const response = await POST(bookingRequest(validBody()));

    expect(response.status).toBe(303);

    const location = response.headers.get('Location');
    expect(location).toMatch(/^\/cita\/[A-Za-z0-9_-]{43}\?nueva=1$/);
  });

  it('returns no body that could leak the token into a log or a cache', async () => {
    const response = await POST(bookingRequest(validBody()));

    expect(await response.text()).toBe('');
  });
});

describe('400 — contact data to correct (FR-009)', () => {
  it('answers a ValidationError shaped like the contract', async () => {
    const response = await POST(
      bookingRequest(
        validBody({ customer: { name: 'Ana', phone: '12345', email: 'ana@example.com' } }),
      ),
    );

    expect(response.status).toBe(400);
    expectMatchesContract(validationSchema, await response.json());
  });

  it('names the field to correct and how', async () => {
    const response = await POST(
      bookingRequest(
        validBody({ customer: { name: 'Ana', phone: '12345', email: 'ana@example.com' } }),
      ),
    );
    const body = (await response.json()) as { fields: { field: string; message: string }[] };

    expect(body.fields.map((field) => field.field)).toEqual(['customer.phone']);
    expect(body.fields[0]?.message.length).toBeGreaterThan(0);
  });

  it('reports every offending field at once', async () => {
    const response = await POST(
      bookingRequest(validBody({ customer: { name: '', phone: '12345', email: 'nope' } })),
    );
    const body = (await response.json()) as { fields: { field: string }[] };

    expect(body.fields.map((field) => field.field)).toEqual([
      'customer.name',
      'customer.phone',
      'customer.email',
    ]);
  });

  it('refuses a fourth personal field (FR-008, Principio III)', async () => {
    const response = await POST(
      bookingRequest(
        validBody({
          customer: {
            name: 'Ana',
            phone: '600112233',
            email: 'ana@example.com',
            birthday: '1990-01-01',
          },
        }),
      ),
    );

    expect(response.status).toBe(400);
  });

  it('rejects an empty selection (FR-004)', async () => {
    const response = await POST(bookingRequest(validBody({ serviceIds: [] })));

    expect(response.status).toBe(400);
    expectMatchesContract(validationSchema, await response.json());
  });

  it('rejects the same service twice (FR-003)', async () => {
    const response = await POST(bookingRequest(validBody({ serviceIds: [CORTE, CORTE] })));

    expect(response.status).toBe(400);
    expectMatchesContract(validationSchema, await response.json());
  });
});

describe('409 — the slot is no longer bookable', () => {
  it('answers SLOT_TAKEN with the day availability attached (escenario 5)', async () => {
    await POST(bookingRequest(validBody()));

    const response = await POST(
      bookingRequest(
        validBody({
          customer: { name: 'Otro', phone: '700112233', email: 'otro@example.com' },
        }),
      ),
    );

    expect(response.status).toBe(409);

    const body = await response.json();
    expectMatchesContract(conflictSchema, body);
    expect((body as { code: string }).code).toBe('SLOT_TAKEN');
    expect(
      (body as { availability: { slots: unknown[] } }).availability.slots.length,
    ).toBeGreaterThan(0);
  });

  it('answers TOO_LATE_TO_BOOK when the start fell inside the two hour lead time', async () => {
    const response = await POST(bookingRequest(validBody({ startsAt: '2026-09-15T09:00:00Z' })));

    expect(response.status).toBe(409);
    const body = await response.json();
    expectMatchesContract(conflictSchema, body);
    expect((body as { code: string }).code).toBe('TOO_LATE_TO_BOOK');
  });

  it('answers OUTSIDE_OPENING_HOURS for a start the salon does not offer', async () => {
    // Sunday: the seed leaves it without opening stretches.
    const response = await POST(bookingRequest(validBody({ startsAt: '2026-09-20T09:30:00Z' })));

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('OUTSIDE_OPENING_HOURS');
  });

  it('lets the client pick again without going back: the availability comes with it', async () => {
    await POST(bookingRequest(validBody()));

    const response = await POST(
      bookingRequest(
        validBody({ customer: { name: 'Otro', phone: '700112233', email: 'otro@example.com' } }),
      ),
    );
    const body = (await response.json()) as {
      availability: { selectedDate: string; slots: { localTime: string }[] };
    };

    expect(body.availability.selectedDate).toBe('2026-09-18');
    // The hour just taken is gone from what is offered.
    expect(body.availability.slots.map((slot) => slot.localTime)).not.toContain('11:30');
  });
});

describe('several services in one appointment (005)', () => {
  it('confirms two services as one appointment with one link', async () => {
    const response = await POST(bookingRequest(validBody({ serviceIds: [COLOR, CORTE] })));

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toMatch(/^\/cita\/[A-Za-z0-9_-]{43}\?nueva=1$/);
  });

  it('answers SERVICE_UNAVAILABLE naming the service no longer offered (FR-015)', async () => {
    const response = await POST(bookingRequest(validBody({ serviceIds: [CORTE, RETIRED] })));
    const body = (await response.clone().json()) as {
      code: string;
      unavailableServiceIds: string[];
      nextAction: string;
    };

    expect(response.status).toBe(409);
    expectMatchesContract(conflictSchema, await response.json());
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.unavailableServiceIds).toEqual([RETIRED]);
    expect(body.nextAction.length).toBeGreaterThan(0);
  });

  it('treats a service that never existed the same way', async () => {
    const unknown = randomUUID();
    const response = await POST(bookingRequest(validBody({ serviceIds: [unknown] })));
    const body = (await response.json()) as { code: string; unavailableServiceIds: string[] };

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: 'SERVICE_UNAVAILABLE', unavailableServiceIds: [unknown] });
  });
});

describe('422 — three confirmed future appointments already (FR-013, BR-014)', () => {
  it('answers an Error shaped like the contract', async () => {
    const starts = ['2026-09-18T08:00:00Z', '2026-09-18T09:00:00Z', '2026-09-18T10:00:00Z'];
    for (const startsAt of starts) {
      const created = await POST(bookingRequest(validBody({ startsAt })));
      expect(created.status).toBe(303);
    }

    const response = await POST(bookingRequest(validBody({ startsAt: FRIDAY_1130 })));

    expect(response.status).toBe(422);

    const body = await response.json();
    expectMatchesContract(limitSchema, body);
    // The way out is named: cancel one, or call the salon.
    expect((body as { nextAction: string }).nextAction.length).toBeGreaterThan(0);
  });
});

describe('429 — the per-IP confirmation limit (FR-039)', () => {
  it('answers an Error that explains the situation, unlike the link limit', async () => {
    limiter.allowed = false;

    const response = await POST(bookingRequest(validBody()));

    expect(response.status).toBe(429);

    const body = await response.json();
    expectMatchesContract(rateLimitSchema, body);
    // FR-039: this one is explained, and carries the salon phone.
    expect((body as { nextAction: string }).nextAction).toMatch(/\d/);
  });

  it('writes nothing when the limit is hit', async () => {
    limiter.allowed = false;

    await POST(bookingRequest(validBody()));
    limiter.allowed = true;

    const retry = await POST(bookingRequest(validBody()));
    expect(retry.status).toBe(303);
  });
});
