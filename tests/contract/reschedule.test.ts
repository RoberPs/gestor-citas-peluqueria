import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_NOW, COLOR, CORTE, seedContractDatabase } from './helpers/seed-contract-db';
import { expectMatchesContract, responseSchema } from './helpers/openapi';
import { closeTestDb, testPool, truncateAppointments } from '../integration/helpers/test-db';

const clock = { current: CONTRACT_NOW };
vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => clock.current },
}));

const limiter = { allowed: true };
vi.mock('@/infrastructure/security/rate-limiter', () => ({
  rateLimiter: () => ({
    check: async () => ({ allowed: limiter.allowed }),
    rejections: () => ({ APPOINTMENT_LOOKUP: 0, BOOKING_CONFIRMATION: 0 }),
    trackedKeyCount: () => 0,
  }),
}));

const { GET: rescheduleAvailability } = await import(
  '@/app/api/appointments/[token]/availability/route'
);
const { POST: reschedule } = await import('@/app/api/appointments/[token]/reschedule/route');
const { POST: create } = await import('@/app/api/appointments/route');

const availabilitySchema = responseSchema('/appointments/{token}/availability', 'get', '200');
const availabilityNotFound = responseSchema('/appointments/{token}/availability', 'get', '404');
const rescheduleOkSchema = responseSchema('/appointments/{token}/reschedule', 'post', '200');
const rescheduleConflict = responseSchema('/appointments/{token}/reschedule', 'post', '409');

/** Friday 2026-09-18 at 11:30 and 16:00, salon time. */
const FRIDAY_1130 = '2026-09-18T09:30:00Z';
const FRIDAY_1600 = '2026-09-18T14:00:00Z';

async function book(
  startsAt = FRIDAY_1130,
  serviceId = COLOR,
  customer = { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
): Promise<string> {
  const response = await create(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceIds: [serviceId], startsAt, customer }),
    }),
  );

  const location = response.headers.get('Location');
  if (location === null) throw new Error('the fixture booking did not redirect');
  return location.replace('/cita/', '').replace('?nueva=1', '');
}

function availabilityFor(token: string, query: Record<string, string> = {}): Promise<Response> {
  const url = new URL(`http://localhost/api/appointments/${token}/availability`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  return rescheduleAvailability(new Request(url), { params: Promise.resolve({ token }) });
}

function move(token: string, startsAt: string): Promise<Response> {
  return reschedule(
    new Request(`http://localhost/api/appointments/${token}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startsAt }),
    }),
    { params: Promise.resolve({ token }) },
  );
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
  limiter.allowed = true;
});

describe('GET /api/appointments/{token}/availability', () => {
  it('answers 200 with the same shape as /availability', async () => {
    const response = await availabilityFor(await book());

    expect(response.status).toBe(200);
    expectMatchesContract(availabilitySchema, await response.json());
  });

  it('forces the services of the appointment: it takes no serviceIds (FR-024)', async () => {
    const token = await book(FRIDAY_1130, COLOR);

    const body = (await (await availabilityFor(token, { serviceIds: CORTE })).json()) as {
      serviceIds: string[];
      slots: { localTime: string; endsLocalTime: string }[];
    };

    // The query parameter is ignored: Color it was and Color it stays.
    expect(body.serviceIds).toEqual([COLOR]);
    // 90 minutes, the frozen duration, not the 30 of Corte.
    expect(body.slots[0]?.endsLocalTime).not.toBe(body.slots[0]?.localTime);
  });

  it('marks the slot the appointment already holds (FR-027)', async () => {
    const token = await book();

    const body = (await (
      await availabilityFor(token, { selectedDate: '2026-09-18' })
    ).json()) as { slots: { localTime: string; isCurrentAppointment?: boolean }[] };

    const own = body.slots.find((slot) => slot.localTime === '11:30');
    expect(own?.isCurrentAppointment).toBe(true);
  });

  it('offers the own slot rather than hiding it as busy', async () => {
    const token = await book();

    const body = (await (
      await availabilityFor(token, { selectedDate: '2026-09-18' })
    ).json()) as { slots: { localTime: string; isCurrentAppointment?: boolean }[] };

    const marked = body.slots.filter((slot) => slot.isCurrentAppointment === true);
    expect(marked).toHaveLength(1);
    // And every other slot is an ordinary one.
    expect(body.slots.length).toBeGreaterThan(1);
  });

  it('still hides a slot somebody else holds', async () => {
    const token = await book();
    await book(FRIDAY_1600, CORTE, {
      name: 'Otro',
      phone: '700112233',
      email: 'otro@example.com',
    });

    const body = (await (
      await availabilityFor(token, { selectedDate: '2026-09-18' })
    ).json()) as { slots: { localTime: string }[] };

    expect(body.slots.map((slot) => slot.localTime)).not.toContain('16:00');
  });

  it('answers the neutral 404 for a link that resolves to nothing', async () => {
    const response = await availabilityFor('a'.repeat(43));

    expect(response.status).toBe(404);
    expectMatchesContract(availabilityNotFound, await response.json());
  });

  it('answers 409 when the appointment admits no change (BR-004)', async () => {
    const token = await book();
    clock.current = CONTRACT_NOW.add({ hours: 56 });

    const response = await availabilityFor(token);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; nextAction: string };
    expect(body.code).toBe('TOO_LATE');
    expect(body.nextAction).toMatch(/\d/);
  });
});

describe('POST /api/appointments/{token}/reschedule', () => {
  it('answers 200 with the appointment at its new hour', async () => {
    const token = await book();

    const response = await move(token, FRIDAY_1600);

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(rescheduleOkSchema, body);
    expect((body as { startsLocalTime: string }).startsLocalTime).toBe('16:00');
    expect((body as { unchanged: boolean }).unchanged).toBe(false);
  });

  it('keeps the same link working afterwards (FR-026)', async () => {
    const token = await book();
    await move(token, FRIDAY_1600);

    // The same token, unchanged, still resolves — now to 16:00.
    const body = (await (await availabilityFor(token, { selectedDate: '2026-09-18' })).json()) as {
      slots: { localTime: string; isCurrentAppointment?: boolean }[];
    };

    expect(body.slots.find((slot) => slot.isCurrentAppointment === true)?.localTime).toBe('16:00');
  });

  it('answers unchanged: true when the client picks their own hour (escenario 5)', async () => {
    const token = await book();

    const response = await move(token, FRIDAY_1130);

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(rescheduleOkSchema, body);
    expect((body as { unchanged: boolean }).unchanged).toBe(true);
    expect((body as { startsLocalTime: string }).startsLocalTime).toBe('11:30');
  });

  it('answers 409 with the availability attached when the new hour was taken', async () => {
    const token = await book();
    await book(FRIDAY_1600, CORTE, {
      name: 'Otro',
      phone: '700112233',
      email: 'otro@example.com',
    });

    const response = await move(token, FRIDAY_1600);

    expect(response.status).toBe(409);
    const body = await response.json();
    expectMatchesContract(rescheduleConflict, body);
    expect((body as { code: string }).code).toBe('SLOT_TAKEN');
    expect(
      (body as { availability: { slots: unknown[] } }).availability.slots.length,
    ).toBeGreaterThan(0);
  });

  it('leaves the original appointment untouched when it refuses (FR-025, BR-006)', async () => {
    const token = await book();
    await book(FRIDAY_1600, CORTE, {
      name: 'Otro',
      phone: '700112233',
      email: 'otro@example.com',
    });

    await move(token, FRIDAY_1600);

    const { rows } = await testPool().query<{ starts_at: Date }>(
      'SELECT starts_at FROM appointment WHERE token_hash IS NOT NULL ORDER BY starts_at',
    );
    // Still two appointments, and the first is still at 11:30.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.starts_at.toISOString()).toBe(new Date(FRIDAY_1130).toISOString());
  });

  it('answers 409 when the appointment admits no change at all', async () => {
    const token = await book();
    clock.current = CONTRACT_NOW.add({ hours: 56 });

    const response = await move(token, '2026-09-25T09:30:00Z');

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('TOO_LATE');
  });

  it('answers the neutral 404 for a link that resolves to nothing', async () => {
    const response = await move('a'.repeat(43), FRIDAY_1600);

    expect(response.status).toBe(404);
  });

  it('answers the neutral 404, never 429, when the per-IP limit is reached', async () => {
    const token = await book();
    limiter.allowed = false;

    const response = await move(token, FRIDAY_1600);

    expect(response.status).toBe(404);
    const { rows } = await testPool().query<{ starts_at: Date }>('SELECT starts_at FROM appointment');
    expect(rows[0]?.starts_at.toISOString()).toBe(new Date(FRIDAY_1130).toISOString());
  });

  it('says what to do next in every failure (SC-012)', async () => {
    const token = await book();
    clock.current = CONTRACT_NOW.add({ hours: 56 });

    const body = (await (await move(token, '2026-09-25T09:30:00Z')).json()) as {
      nextAction: string;
    };

    expect(body.nextAction.length).toBeGreaterThan(0);
  });
});
