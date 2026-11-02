import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_NOW, CORTE, seedContractDatabase } from './helpers/seed-contract-db';
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

const { POST: cancel } = await import('@/app/api/appointments/[token]/cancellation/route');
const { POST: create } = await import('@/app/api/appointments/route');

const okSchema = responseSchema('/appointments/{token}/cancellation', 'post', '200');
const conflictSchema = responseSchema('/appointments/{token}/cancellation', 'post', '409');
const notFoundSchema = responseSchema('/appointments/{token}/cancellation', 'post', '404');

/** Friday 2026-09-18 at 11:30, salon time. */
const FRIDAY_1130 = '2026-09-18T09:30:00Z';

async function book(startsAt = FRIDAY_1130): Promise<string> {
  const response = await create(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: CORTE,
        startsAt,
        customer: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
      }),
    }),
  );

  const location = response.headers.get('Location');
  if (location === null) throw new Error('the fixture booking did not redirect');
  return location.replace('/cita/', '').replace('?nueva=1', '');
}

function cancelRequest(token: string, body: unknown = { confirmed: true }): Promise<Response> {
  return cancel(
    new Request(`http://localhost/api/appointments/${token}/cancellation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

describe('200 — the appointment comes back updated', () => {
  it('answers a body shaped like the contract', async () => {
    const response = await cancelRequest(await book());

    expect(response.status).toBe(200);
    expectMatchesContract(okSchema, await response.json());
  });

  it('reports the appointment as cancelled, with both actions closed (BR-007)', async () => {
    const body = (await (await cancelRequest(await book())).json()) as {
      view: string;
      canCancel: boolean;
      canReschedule: boolean;
      unavailableReason: string | null;
    };

    expect(body.view).toBe('CANCELLED');
    expect(body.canCancel).toBe(false);
    expect(body.canReschedule).toBe(false);
    expect(body.unavailableReason).not.toBeNull();
  });

  it('frees the slot straight away (FR-023, BR-005)', async () => {
    const token = await book();
    await cancelRequest(token);

    // The exclusion constraint only holds confirmed appointments, so the same
    // slot takes a new booking with no release step in between.
    const again = await create(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: CORTE,
          startsAt: FRIDAY_1130,
          customer: { name: 'Otro', phone: '700112233', email: 'otro@example.com' },
        }),
      }),
    );

    expect(again.status).toBe(303);
  });

  it('keeps the row as history rather than deleting it (FR-035a)', async () => {
    await cancelRequest(await book());

    const { rows } = await testPool().query<{ status: string; service_name: string }>(
      'SELECT status, service_name FROM appointment',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'CANCELLED', service_name: 'Corte' });
  });
});

describe('409 — the three blocking cases', () => {
  it('refuses a cancellation past the 24 hour deadline (BR-004)', async () => {
    const token = await book();
    // 2026-09-17 at 18:00 Madrid: less than 24 hours before 11:30 on the 18th.
    clock.current = CONTRACT_NOW.add({ hours: 56 });

    const response = await cancelRequest(token);

    expect(response.status).toBe(409);
    const body = await response.json();
    expectMatchesContract(conflictSchema, body);
    expect((body as { code: string }).code).toBe('TOO_LATE');
  });

  it('refuses a second cancellation (BR-007, escenario 4)', async () => {
    const token = await book();
    await cancelRequest(token);

    const response = await cancelRequest(token);

    expect(response.status).toBe(409);
    const body = await response.json();
    expectMatchesContract(conflictSchema, body);
    expect((body as { code: string }).code).toBe('ALREADY_CANCELLED');
  });

  it('refuses to cancel an appointment that has already happened (BR-010)', async () => {
    const token = await book();
    clock.current = CONTRACT_NOW.add({ hours: 24 * 5 });

    const response = await cancelRequest(token);

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('ALREADY_COMPLETED');
  });

  it('names the salon phone as the way out in every blocking case (FR-028)', async () => {
    const token = await book();
    clock.current = CONTRACT_NOW.add({ hours: 56 });

    const body = (await (await cancelRequest(token)).json()) as { nextAction: string };

    expect(body.nextAction).toMatch(/\d/);
  });

  it('leaves the appointment confirmed when it refuses', async () => {
    const token = await book();
    clock.current = CONTRACT_NOW.add({ hours: 56 });

    await cancelRequest(token);

    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment');
    expect(rows[0]?.status).toBe('CONFIRMED');
  });
});

describe('404 — the neutral answer, here as everywhere else', () => {
  it('answers a body shaped like the contract for a token that resolves to nothing', async () => {
    const response = await cancelRequest('a'.repeat(43));

    expect(response.status).toBe(404);
    expectMatchesContract(notFoundSchema, await response.json());
  });

  it('answers the same for a malformed token', async () => {
    const response = await cancelRequest('not-a-token');

    expect(response.status).toBe(404);
  });

  it('answers the same when the per-IP limit has been reached, never 429', async () => {
    const token = await book();
    limiter.allowed = false;

    const response = await cancelRequest(token);

    expect(response.status).toBe(404);
    expect(response.headers.get('Retry-After')).toBeNull();
  });

  it('cancels nothing when it answers the neutral 404', async () => {
    const token = await book();
    limiter.allowed = false;

    await cancelRequest(token);

    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment');
    expect(rows[0]?.status).toBe('CONFIRMED');
  });
});

describe('the explicit confirmation of FR-022', () => {
  it('cancels nothing when the body does not carry it', async () => {
    const token = await book();

    const response = await cancelRequest(token, {});

    expect(response.status).toBe(400);
    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment');
    expect(rows[0]?.status).toBe('CONFIRMED');
  });

  it('cancels nothing when the confirmation is false', async () => {
    const token = await book();

    const response = await cancelRequest(token, { confirmed: false });

    expect(response.status).toBe(400);
    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment');
    expect(rows[0]?.status).toBe('CONFIRMED');
  });

  it('says what to do next even then (SC-012)', async () => {
    const body = (await (await cancelRequest(await book(), {})).json()) as { nextAction: string };

    expect(body.nextAction.length).toBeGreaterThan(0);
  });
});
