import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, insertAppointmentRow, testPool, truncateAppointments } from '../../integration/helpers/test-db';
import { CONTRACT_NOW, CORTE, LAVADO, seedContractDatabase } from '../helpers/seed-contract-db';
import { ownerContract, ownerCookie, provisionOwner } from './helpers';

/**
 * 002, T085 and T096: `POST /gestion/citas`, `POST /gestion/citas/{id}/
 * reprogramacion` and `POST /gestion/citas/{id}/cancelacion` against
 * owner-api.yaml, with the two-step answer when something is in the way.
 */

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

const citas = await import('@/app/api/gestion/citas/route');
const reprogramacion = await import('@/app/api/gestion/citas/[id]/reprogramacion/route');
const cancelacion = await import('@/app/api/gestion/citas/[id]/cancelacion/route');

const { responseSchema, expectMatchesContract } = ownerContract;

let cookie = '';

const LUIS = { name: 'Luis Pérez', phone: '611 22 33 44' };
const NEW = { serviceIds: [CORTE, LAVADO], startsAt: '2026-09-18T16:00:00+02:00', customer: LUIS };

function send(url: string, body: unknown, withCookie = cookie): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(withCookie === '' ? {} : { Cookie: withCookie }) },
    body: JSON.stringify(body),
  });
}

function create(body: unknown, withCookie = cookie): Promise<Response> {
  return citas.POST(send('http://localhost/api/gestion/citas', body, withCookie));
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function move(id: string, body: unknown, withCookie = cookie): Promise<Response> {
  return reprogramacion.POST(send(`http://localhost/api/gestion/citas/${id}/reprogramacion`, body, withCookie), params(id));
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

describe('POST /gestion/citas', () => {
  it('answers 201 with the appointment, written by hand and without a link', async () => {
    const response = await create(NEW);

    expect(response.status).toBe(201);
    const body = await response.json();
    expectMatchesContract(responseSchema('/gestion/citas', 'post', '201'), body);
    expect(body).toMatchObject({
      origin: 'OWNER',
      hasManagementLink: false,
      durationMinutes: 60,
      startsAt: { localTime: '16:00' },
      endsAt: { localTime: '17:00' },
      customer: { email: null },
    });
    expect(body).not.toHaveProperty('notifyCustomer');
  });

  it('answers 409 naming the appointment in the way, and 201 once it is resolved', async () => {
    const ana = await bookFriday('15:45', '16:15');

    const asked = await create(NEW);
    expect(asked.status).toBe(409);
    const conflict = await asked.json();
    expectMatchesContract(responseSchema('/gestion/citas', 'post', '409'), conflict);
    expect(conflict).toMatchObject({
      code: 'CONFLICT',
      conflicts: [{ kind: 'APPOINTMENT', id: ana, customerName: 'Ana López', serviceNames: ['Corte'] }],
    });

    const resolved = await create({ ...NEW, stateToken: conflict.stateToken, resolution: { cancelAppointments: [ana] } });
    expect(resolved.status).toBe(201);
  });

  it('answers 409 with a warning outside the opening hours, and 201 once acknowledged', async () => {
    const late = { ...NEW, startsAt: '2026-09-18T20:30:00+02:00' };

    const asked = await create(late);
    expect(asked.status).toBe(409);
    const warning = await asked.json();
    expectMatchesContract(responseSchema('/gestion/citas', 'post', '409'), warning);
    expect(warning).toMatchObject({ code: 'WARNING', conflicts: [], warnings: [{ code: 'OUTSIDE_OPENING_HOURS' }] });

    expect((await create({ ...late, acknowledgedWarnings: ['OUTSIDE_OPENING_HOURS'] })).status).toBe(201);
  });

  it.each([
    ['a start in the past', { ...NEW, startsAt: '2026-09-14T16:00:00+02:00' }],
    ['a start off the 15 minute grid', { ...NEW, startsAt: '2026-09-18T16:10:00+02:00' }],
    ['a malformed phone', { ...NEW, customer: { ...LUIS, phone: '123' } }],
    ['no services', { ...NEW, serviceIds: [] }],
    ['a service repeated', { ...NEW, serviceIds: [CORTE, CORTE] }],
    ['a service that is not offered', { ...NEW, serviceIds: [randomUUID()] }],
  ])('answers 422 to %s', async (_name, body) => {
    const response = await create(body);

    expect(response.status).toBe(422);
    expectMatchesContract(responseSchema('/gestion/citas', 'post', '422'), await response.json());
  });

  it('answers 400 to a body that is not one', async () => {
    const response = await create({ startsAt: 'mañana' });

    expect(response.status).toBe(400);
    expectMatchesContract(responseSchema('/gestion/citas', 'post', '400'), await response.json());
  });

  it('answers 401 without a session, and saves nothing', async () => {
    const response = await create(NEW, '');

    expect(response.status).toBe(401);
    expectMatchesContract(responseSchema('/gestion/citas', 'post', '401'), await response.json());
    const { rows } = await testPool().query<{ count: string }>('SELECT count(*) FROM appointment');
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe('POST /gestion/citas/{id}/reprogramacion', () => {
  const PATH = '/gestion/citas/{id}/reprogramacion';

  it('answers 200 with the appointment moved and whom to call (FR-043)', async () => {
    const id = await bookFriday('11:00', '11:30');

    const response = await move(id, { startsAt: '2026-09-18T11:30:00+02:00' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(responseSchema(PATH, 'post', '200'), body);
    expect(body).toMatchObject({ startsAt: { localTime: '11:30' }, hasManagementLink: true, notifyCustomer: { phone: '600112233' } });
  });

  it('answers 409 when the new slot is taken', async () => {
    const id = await bookFriday('11:00', '11:30');
    await bookFriday('12:00', '12:30');

    const response = await move(id, { startsAt: '2026-09-18T12:00:00+02:00' });

    expect(response.status).toBe(409);
    expectMatchesContract(responseSchema(PATH, 'post', '409'), await response.json());
  });

  it('answers 422 to a cancelled appointment', async () => {
    const id = await bookFriday('11:00', '11:30');
    await cancel(id);

    const response = await move(id, { startsAt: '2026-09-18T12:00:00+02:00' });

    expect(response.status).toBe(422);
    expectMatchesContract(responseSchema(PATH, 'post', '422'), await response.json());
  });

  it('answers 404 to an appointment that does not exist, and 401 without a session', async () => {
    const missing = await move(randomUUID(), { startsAt: '2026-09-18T12:00:00+02:00' });
    expect(missing.status).toBe(404);
    expectMatchesContract(responseSchema(PATH, 'post', '404'), await missing.json());

    const anonymous = await move(randomUUID(), { startsAt: '2026-09-18T12:00:00+02:00' }, '');
    expect(anonymous.status).toBe(401);
    expectMatchesContract(responseSchema(PATH, 'post', '401'), await anonymous.json());
  });
});

describe('POST /gestion/citas/{id}/cancelacion', () => {
  const PATH = '/gestion/citas/{id}/cancelacion';

  it('answers 200 with the appointment cancelled by the owner, with no deadline (BR-007)', async () => {
    const id = await bookFriday('11:00', '11:30');

    const response = await cancel(id);

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(responseSchema(PATH, 'post', '200'), body);
    expect(body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'OWNER', notifyCustomer: { phone: '600112233' } });
  });

  it('answers 422 the second time: cancelling is final (FR-042)', async () => {
    const id = await bookFriday('11:00', '11:30');
    await cancel(id);

    const response = await cancel(id);

    expect(response.status).toBe(422);
    expectMatchesContract(responseSchema(PATH, 'post', '422'), await response.json());
  });

  it('answers 400 without the explicit confirmation (FR-040)', async () => {
    const id = await bookFriday('11:00', '11:30');

    expect((await cancel(id, {})).status).toBe(400);
  });

  it('answers 404 and 401', async () => {
    expect((await cancel(randomUUID())).status).toBe(404);
    expect((await cancel(randomUUID(), { confirmed: true }, '')).status).toBe(401);
  });
});
