import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, testPool, truncateAppointments } from '../../integration/helpers/test-db';
import { CONTRACT_NOW, CORTE, LAVADO, seedContractDatabase } from '../helpers/seed-contract-db';
import { ownerContract, ownerCookie, ownerGet, provisionOwner } from './helpers';

/** 002, T172: `GET /gestion/reservas` against owner-api.yaml. */

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

const { GET: list } = await import('@/app/api/gestion/reservas/route');
const { POST: book } = await import('@/app/api/appointments/route');

const { responseSchema, expectMatchesContract } = ownerContract;
const okSchema = responseSchema('/gestion/reservas', 'get', '200');
const badSchema = responseSchema('/gestion/reservas', 'get', '400');

let cookie = '';

async function bookAt(startsAt: string, serviceIds: string[] = [CORTE], phone = '600112233'): Promise<void> {
  const response = await book(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceIds,
        startsAt,
        customer: { name: 'José Núñez', phone, email: `${phone}@example.com` },
      }),
    }),
  );
  if (response.status !== 303 && response.status !== 201) throw new Error(`booking answered ${response.status}`);
}

function get(query: string): Promise<Response> {
  return list(ownerGet(`http://localhost/api/gestion/reservas${query}`, cookie));
}

beforeAll(async () => {
  await seedContractDatabase();
  await provisionOwner();
  cookie = await ownerCookie();
});

beforeEach(async () => {
  await truncateAppointments();
});

afterAll(async () => {
  await testPool().query('TRUNCATE owner_account CASCADE');
  await closeTestDb();
});

describe('GET /gestion/reservas', () => {
  it('returns a page with the query as the domain decided it, defaults filled in', async () => {
    await bookAt('2026-09-18T08:00:00Z', [CORTE, LAVADO]);

    const response = await get('');

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(okSchema, body);
    expect(body.query).toEqual({
      orden: 'proximas',
      estado: 'confirmadas',
      origen: 'todos',
      desde: null,
      hasta: null,
      buscar: null,
    });
    expect(body.rows[0].services).toHaveLength(2);
    expect(body.next).toBeNull();
  });

  it('echoes the search as typed, trimmed, and finds by it', async () => {
    await bookAt('2026-09-18T08:00:00Z');

    const body = await (await get('?buscar=%20nu%C3%B1ez%20&orden=recientes')).json();

    expectMatchesContract(okSchema, body);
    expect(body.query).toMatchObject({ orden: 'recientes', buscar: 'nuñez' });
    expect(body.rows).toHaveLength(1);
  });

  it('pages with an opaque cursor that is returned as is', async () => {
    for (let day = 0; day < 21; day += 1) {
      await bookAt(`2026-09-${String(16 + Math.floor(day / 7)).padStart(2, '0')}T${String(8 + (day % 7)).padStart(2, '0')}:00:00Z`, [CORTE], `6001122${String(day).padStart(2, '0')}`);
    }

    const first = await (await get('')).json();
    expect(first.rows).toHaveLength(20);
    expect(typeof first.next).toBe('string');

    const second = await (await get(`?despues=${first.next}`)).json();
    expectMatchesContract(okSchema, second);
    expect(second.rows).toHaveLength(1);
    expect(second.next).toBeNull();
  });

  it.each([
    ['?estado=hechas', 'INVALID_FILTER'],
    ['?desde=2026-09-20&hasta=2026-09-18', 'RANGE_REVERSED'],
    ['?buscar=600%2011', 'INCOMPLETE_PHONE'],
    ['?despues=no-es-un-cursor', 'INVALID_FILTER'],
    ['?otro=1', 'INVALID_FILTER'],
  ])('answers 400 with nextAction to %s', async (query, code) => {
    const response = await get(query);

    expect(response.status).toBe(400);
    const body = await response.json();
    expectMatchesContract(badSchema, body);
    expect(body.code).toBe(code);
  });

  it('refuses a cursor of one order used with the other', async () => {
    for (let day = 0; day < 21; day += 1) {
      await bookAt(`2026-09-${String(16 + Math.floor(day / 7)).padStart(2, '0')}T${String(8 + (day % 7)).padStart(2, '0')}:00:00Z`, [CORTE], `6001122${String(day).padStart(2, '0')}`);
    }
    const first = await (await get('')).json();

    const response = await get(`?orden=recientes&despues=${first.next}`);

    expect(response.status).toBe(400);
  });

  it('answers 401 without a session', async () => {
    const response = await list(ownerGet('http://localhost/api/gestion/reservas', ''));

    expect(response.status).toBe(401);
    expectMatchesContract(responseSchema('/gestion/reservas', 'get', '401'), await response.json());
  });
});
