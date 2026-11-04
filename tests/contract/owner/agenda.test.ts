import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, insertEmailConfirmation, testPool, truncateAppointments } from '../../integration/helpers/test-db';
import { CONTRACT_NOW, CORTE, LAVADO, seedContractDatabase } from '../helpers/seed-contract-db';
import { ownerContract, ownerCookie, ownerGet, provisionOwner } from './helpers';

/** 002, T061: `GET /gestion/agenda` against owner-api.yaml. */

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

vi.mock('@/infrastructure/security/rate-limiter', () => ({
  rateLimiter: () => ({
    check: async () => ({ allowed: true }),
    rejections: () => ({ APPOINTMENT_LOOKUP: 0, BOOKING_CONFIRMATION: 0 }),
    trackedKeyCount: () => 0,
  }),
}));

const { GET: agenda } = await import('@/app/api/gestion/agenda/route');
const { POST: book } = await import('@/app/api/appointments/route');
const { POST: cancel } = await import('@/app/api/appointments/[token]/cancellation/route');

const { responseSchema, expectMatchesContract } = ownerContract;
const okSchema = responseSchema('/gestion/agenda', 'get', '200');

let cookie = '';

async function bookOnFriday(startsAt: string, serviceIds: string[]): Promise<string> {
  const response = await book(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceIds,
        startsAt,
        customer: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
      }),
    }),
  );
  return (response.headers.get('Location') ?? '').replace('/cita/', '').replace('?nueva=1', '');
}

beforeAll(async () => {
  await seedContractDatabase();
  await provisionOwner();
  cookie = await ownerCookie();
});

beforeEach(async () => {
  await truncateAppointments();
  await testPool().query('TRUNCATE unavailable_period');
});

afterAll(async () => {
  await testPool().query('TRUNCATE owner_account CASCADE');
  await closeTestDb();
});

describe('GET /gestion/agenda', () => {
  it('returns the whole day, appointments of several services, periods and free time', async () => {
    await bookOnFriday('2026-09-18T08:00:00Z', [CORTE, LAVADO]);
    await testPool().query(
      `INSERT INTO unavailable_period (id, starts_at, ends_at, reason)
       VALUES ($1, '2026-09-18 13:00 Europe/Madrid', '2026-09-18 14:00 Europe/Madrid', 'Comida')`,
      [randomUUID()],
    );

    const response = await agenda(ownerGet('http://localhost/api/gestion/agenda?fecha=2026-09-18', cookie));

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(okSchema, body);
    // Opening at 10:00 with the appointment at 10:00: no free time before it.
    expect(body.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      'APPOINTMENT',
      'FREE',
      'UNAVAILABLE',
      'FREE',
    ]);
    const appointment = body.entries[0].appointment;
    expect(appointment.services.map((service: { name: string }) => service.name)).toEqual([
      'Corte',
      'Lavado',
    ]);
    expect(appointment.startsAt.localTime).toBe('10:00');
    expect(appointment.hasManagementLink).toBe(true);
    expect(body.entries[2].period.reason).toBe('Comida');
  });

  it('leaves cancelled appointments out unless asked, and then says who cancelled', async () => {
    const token = await bookOnFriday('2026-09-18T08:00:00Z', [CORTE]);
    await cancel(
      new Request(`http://localhost/api/appointments/${token}/cancellation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      }),
      { params: Promise.resolve({ token }) },
    );

    const hidden = await (
      await agenda(ownerGet('http://localhost/api/gestion/agenda?fecha=2026-09-18', cookie))
    ).json();
    const shown = await (
      await agenda(
        ownerGet('http://localhost/api/gestion/agenda?fecha=2026-09-18&incluirCanceladas=true', cookie),
      )
    ).json();

    expect(hidden.entries.some((entry: { kind: string }) => entry.kind === 'APPOINTMENT')).toBe(false);
    expectMatchesContract(okSchema, shown);
    expect(shown.entries[0].appointment.cancelledBy).toBe('CUSTOMER');
  });

  it('says a Sunday is closed and has no entries (FR-017)', async () => {
    const body = await (
      await agenda(ownerGet('http://localhost/api/gestion/agenda?fecha=2026-09-20', cookie))
    ).json();

    expectMatchesContract(okSchema, body);
    expect(body).toMatchObject({ isClosed: true, entries: [] });
  });

  it.each([['fecha=18-09-2026'], ['fecha=2026-02-30'], ['']])('answers 400 to %j', async (query) => {
    const response = await agenda(ownerGet(`http://localhost/api/gestion/agenda?${query}`, cookie));

    expect(response.status).toBe(400);
    expectMatchesContract(responseSchema('/gestion/agenda', 'get', '400'), await response.json());
  });

  it('answers 401 without a session', async () => {
    const response = await agenda(ownerGet('http://localhost/api/gestion/agenda?fecha=2026-09-18', ''));

    expect(response.status).toBe(401);
    expectMatchesContract(responseSchema('/gestion/agenda', 'get', '401'), await response.json());
  });
});

describe('confirmationEmailFailed (004, 1.3.0, FR-020a)', () => {
  async function appointmentIdAt(startsAt: string): Promise<string> {
    const { rows } = await testPool().query<{ id: string }>('SELECT id FROM appointment WHERE starts_at = $1', [startsAt]);
    return rows[0]?.id ?? '';
  }

  type AgendaBody = {
    entries: { kind: string; appointment?: { startsAt: { localTime: string }; confirmationEmailFailed: boolean } }[];
  };

  async function flags(): Promise<Record<string, boolean>> {
    const response = await agenda(
      ownerGet('http://localhost/api/gestion/agenda?fecha=2026-09-18&incluirCanceladas=true', cookie),
    );
    const body = (await response.json()) as AgendaBody;
    expectMatchesContract(okSchema, body);
    return Object.fromEntries(
      body.entries.flatMap((entry) =>
        entry.appointment === undefined ? [] : [[entry.appointment.startsAt.localTime, entry.appointment.confirmationEmailFailed]],
      ),
    );
  }

  it('is the 1.3.0 contract that is checked', () => {
    expect(ownerContract.version()).toBe('1.3.0');
  });

  it('is there on every appointment, true only where the confirmation failed for good', async () => {
    await bookOnFriday('2026-09-18T08:00:00Z', [CORTE]);
    await bookOnFriday('2026-09-18T09:00:00Z', [CORTE]);
    await bookOnFriday('2026-09-18T10:00:00Z', [CORTE]);
    await insertEmailConfirmation(await appointmentIdAt('2026-09-18T08:00:00Z'), {
      unsubscribeTokenHash: randomBytes(32),
      status: 'FAILED',
    });
    await insertEmailConfirmation(await appointmentIdAt('2026-09-18T09:00:00Z'), {
      unsubscribeTokenHash: randomBytes(32),
      status: 'SENT',
    });

    expect(await flags()).toEqual({ '10:00': true, '11:00': false, '12:00': false });
  });

  it('is false once the appointment is cancelled', async () => {
    const token = await bookOnFriday('2026-09-18T08:00:00Z', [CORTE]);
    await insertEmailConfirmation(await appointmentIdAt('2026-09-18T08:00:00Z'), {
      unsubscribeTokenHash: randomBytes(32),
      status: 'FAILED',
    });
    await cancel(
      new Request(`http://localhost/api/appointments/${token}/cancellation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      }),
      { params: Promise.resolve({ token }) },
    );

    expect(await flags()).toEqual({ '10:00': false });
  });
});
