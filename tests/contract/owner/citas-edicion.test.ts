import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, insertAppointmentRow, testPool, truncateAppointments } from '../../integration/helpers/test-db';
import { CONTRACT_NOW, CORTE, LAVADO, seedContractDatabase } from '../helpers/seed-contract-db';
import { ownerContract, ownerCookie, provisionOwner } from './helpers';

/** 002, T200: `PATCH /gestion/citas/{id}` against owner-api.yaml (Historia 11). */

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

const cita = await import('@/app/api/gestion/citas/[id]/route');
const cancelacion = await import('@/app/api/gestion/citas/[id]/cancelacion/route');

const { responseSchema, expectMatchesContract } = ownerContract;

let cookie = '';

const ANA = { name: 'Ana López', phone: '600112233', email: 'ana@example.com' };

function send(url: string, body: unknown, withCookie = cookie): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(withCookie === '' ? {} : { Cookie: withCookie }) },
    body: JSON.stringify(body),
  });
}


function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function edit(id: string, body: unknown, withCookie = cookie): Promise<Response> {
  const request = send(`http://localhost/api/gestion/citas/${id}`, body, withCookie);
  return cita.PATCH(new Request(request, { method: 'PATCH' }), params(id));
}

function cancel(id: string, body: unknown = { confirmed: true }, withCookie = cookie): Promise<Response> {
  return cancelacion.POST(send(`http://localhost/api/gestion/citas/${id}/cancelacion`, body, withCookie), params(id));
}

async function bookFriday(from: string, to: string): Promise<string> {
  const id = randomUUID();
  await insertAppointmentRow(
    {
      id,
      status: 'CONFIRMED',
      starts_at: `2026-09-18 ${from}+02`,
      ends_at: `2026-09-18 ${to}+02`,
      customer_name: 'Ana López',
      customer_phone: '600112233',
      customer_email: 'ana@example.com',
      customer_phone_normalized: '+34600112233',
      customer_email_normalized: 'ana@example.com',
      token_hash: randomBytes(32),
    },
    { serviceId: CORTE, name: 'Corte', durationMinutes: 30, priceCents: 1800 },
  );
  return id;
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

describe('PATCH /gestion/citas/{id}', () => {
  const PATH = '/gestion/citas/{id}';

  it('answers 200 with the appointment longer and whom to call (FR-043)', async () => {
    const id = await bookFriday('11:00', '11:30');

    const response = await edit(id, { serviceIds: [CORTE, LAVADO], customer: ANA });

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(responseSchema(PATH, 'patch', '200'), body);
    expect(body).toMatchObject({
      startsAt: { localTime: '11:00' },
      endsAt: { localTime: '12:00' },
      durationMinutes: 60,
      hasManagementLink: true,
      notifyCustomer: { phone: '600112233' },
    });
  });

  it('answers 409 when it grows over another appointment', async () => {
    const id = await bookFriday('11:00', '11:30');
    await bookFriday('11:30', '12:00');

    const response = await edit(id, { serviceIds: [CORTE, LAVADO], customer: ANA });

    expect(response.status).toBe(409);
    expectMatchesContract(responseSchema(PATH, 'patch', '409'), await response.json());
  });

  it.each([
    ['no services', { serviceIds: [], customer: ANA }],
    ['a malformed phone', { serviceIds: [CORTE], customer: { ...ANA, phone: '12' } }],
    ['a service that is not offered', { serviceIds: [CORTE, randomUUID()], customer: ANA }],
  ])('answers 422 to %s', async (_name, body) => {
    const id = await bookFriday('11:00', '11:30');

    const response = await edit(id, body);

    expect(response.status).toBe(422);
    expectMatchesContract(responseSchema(PATH, 'patch', '422'), await response.json());
  });

  it('answers 422 to a cancelled appointment (FR-042)', async () => {
    const id = await bookFriday('11:00', '11:30');
    await cancel(id);

    const response = await edit(id, { serviceIds: [CORTE], customer: ANA });

    expect(response.status).toBe(422);
    expectMatchesContract(responseSchema(PATH, 'patch', '422'), await response.json());
  });

  it('answers 400, 404 and 401', async () => {
    const id = await bookFriday('11:00', '11:30');

    const malformed = await edit(id, { serviceIds: 'corte' });
    expect(malformed.status).toBe(400);
    expectMatchesContract(responseSchema(PATH, 'patch', '400'), await malformed.json());

    const missing = await edit(randomUUID(), { serviceIds: [CORTE], customer: ANA });
    expect(missing.status).toBe(404);
    expectMatchesContract(responseSchema(PATH, 'patch', '404'), await missing.json());

    const anonymous = await edit(id, { serviceIds: [CORTE], customer: ANA }, '');
    expect(anonymous.status).toBe(401);
    expectMatchesContract(responseSchema(PATH, 'patch', '401'), await anonymous.json());
  });
});
