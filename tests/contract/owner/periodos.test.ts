import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, insertAppointmentRow, testPool, truncateAppointments } from '../../integration/helpers/test-db';
import { CONTRACT_NOW, CORTE, seedContractDatabase } from '../helpers/seed-contract-db';
import { ownerContract, ownerCookie, ownerGet, provisionOwner } from './helpers';

/**
 * 002, T071: `GET`/`POST /gestion/periodos` and `PATCH`/`DELETE
 * /gestion/periodos/{id}` against owner-api.yaml, with the warning a block
 * over confirmed appointments gives before it is saved (FR-022).
 */

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

const periods = await import('@/app/api/gestion/periodos/route');
const period = await import('@/app/api/gestion/periodos/[id]/route');

const { responseSchema, expectMatchesContract } = ownerContract;

let cookie = '';

const LUNCH = { startsAt: '2026-09-18T13:00:00+02:00', endsAt: '2026-09-18T14:00:00+02:00', reason: 'Comida' };

function send(method: string, url: string, body: unknown, withCookie = cookie): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(withCookie === '' ? {} : { Cookie: withCookie }) },
    body: JSON.stringify(body),
  });
}

function create(body: unknown, withCookie = cookie): Promise<Response> {
  return periods.POST(send('POST', 'http://localhost/api/gestion/periodos', body, withCookie));
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function list(from: string, to: string, withCookie = cookie): Promise<Response> {
  const query = new URLSearchParams({ desde: from, hasta: to });
  return periods.GET(ownerGet(`http://localhost/api/gestion/periodos?${query}`, withCookie));
}

async function createdId(body: unknown = LUNCH): Promise<string> {
  const response = await create(body);
  if (response.status !== 201) throw new Error(`the fixture block answered ${response.status}`);
  return ((await response.json()) as { id: string }).id;
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

describe('POST /gestion/periodos', () => {
  it('answers 201 with the period, its wall times and its reason', async () => {
    const response = await create(LUNCH);

    expect(response.status).toBe(201);
    const body = await response.json();
    expectMatchesContract(responseSchema('/gestion/periodos', 'post', '201'), body);
    expect(body).toMatchObject({
      startsAt: { localTime: '13:00', localDate: '2026-09-18' },
      endsAt: { localTime: '14:00' },
      reason: 'Comida',
    });
  });

  it.each([
    ['an end before the start (FR-023)', { startsAt: LUNCH.endsAt, endsAt: LUNCH.startsAt }],
    ['a start off the 15 minute grid', { startsAt: '2026-09-18T13:05:00+02:00', endsAt: LUNCH.endsAt }],
    ['a period already over', { startsAt: '2026-09-14T13:00:00+02:00', endsAt: '2026-09-14T14:00:00+02:00' }],
    ['a date that is not one', { startsAt: 'mañana', endsAt: LUNCH.endsAt }],
    ['a reason longer than 200 characters', { ...LUNCH, reason: 'x'.repeat(201) }],
  ])('answers 422 to %s', async (_name, body) => {
    const response = await create(body);

    expect(response.status).toBe(422);
    expectMatchesContract(responseSchema('/gestion/periodos', 'post', '422'), await response.json());
  });

  it('answers 409 naming the appointment in the way, and saves only once it is acknowledged', async () => {
    const id = await bookFriday('13:30', '14:00');

    const warned = await create(LUNCH);

    expect(warned.status).toBe(409);
    const report = await warned.json();
    expectMatchesContract(responseSchema('/gestion/periodos', 'post', '409'), report);
    expect(report.conflicts).toEqual([
      expect.objectContaining({ kind: 'APPOINTMENT', id, customerName: 'Ana López', serviceNames: ['Corte'] }),
    ]);
    const empty = await (await list('2026-09-18T00:00:00+02:00', '2026-09-19T00:00:00+02:00')).json();
    expect(empty.periods).toEqual([]);

    const confirmed = await create({
      ...LUNCH,
      stateToken: report.stateToken,
      resolution: { acknowledgeAppointments: [id] },
    });

    expect(confirmed.status).toBe(201);
    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment WHERE id = $1', [id]);
    expect(rows[0]?.status).toBe('CONFIRMED');
  });

  it('answers 401 without a session and blocks nothing', async () => {
    const response = await create(LUNCH, '');

    expect(response.status).toBe(401);
    expectMatchesContract(responseSchema('/gestion/periodos', 'post', '401'), await response.json());
    const { rows } = await testPool().query('SELECT 1 FROM unavailable_period');
    expect(rows).toEqual([]);
  });
});

describe('GET /gestion/periodos', () => {
  it('returns the periods that touch the window, a long one that began before it included', async () => {
    await createdId(LUNCH);
    await createdId({ startsAt: '2026-09-16T00:00:00+02:00', endsAt: '2026-09-19T00:00:00+02:00', reason: null });
    await createdId({ startsAt: '2026-09-21T10:00:00+02:00', endsAt: '2026-09-21T11:00:00+02:00' });

    const response = await list('2026-09-18T00:00:00+02:00', '2026-09-19T00:00:00+02:00');

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(responseSchema('/gestion/periodos', 'get', '200'), body);
    expect(body.periods.map((item: { reason: string | null }) => item.reason)).toEqual([null, 'Comida']);
  });

  it.each([
    ['a missing end', { desde: '2026-09-18T00:00:00+02:00' }],
    ['an end before the start', { desde: '2026-09-19T00:00:00+02:00', hasta: '2026-09-18T00:00:00+02:00' }],
    ['a date that is not one', { desde: 'ayer', hasta: '2026-09-18T00:00:00+02:00' }],
  ])('answers 400 to %s', async (_name, query) => {
    const response = await periods.GET(
      ownerGet(`http://localhost/api/gestion/periodos?${new URLSearchParams(query)}`, cookie),
    );

    expect(response.status).toBe(400);
    expectMatchesContract(responseSchema('/gestion/periodos', 'get', '400'), await response.json());
  });

  it('answers 401 without a session', async () => {
    const response = await list('2026-09-18T00:00:00+02:00', '2026-09-19T00:00:00+02:00', '');

    expect(response.status).toBe(401);
    expectMatchesContract(responseSchema('/gestion/periodos', 'get', '401'), await response.json());
  });
});

describe('PATCH /gestion/periodos/{id}', () => {
  it('answers 200 with the shortened period (FR-019)', async () => {
    const id = await createdId();

    const response = await period.PATCH(
      send('PATCH', `http://localhost/api/gestion/periodos/${id}`, {
        startsAt: '2026-09-18T13:00:00+02:00',
        endsAt: '2026-09-18T13:30:00+02:00',
      }),
      params(id),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expectMatchesContract(responseSchema('/gestion/periodos/{id}', 'patch', '200'), body);
    expect(body).toMatchObject({ id, endsAt: { localTime: '13:30' }, reason: 'Comida' });
  });

  it('answers 422 to a span that is not inside the old one', async () => {
    const id = await createdId();

    const response = await period.PATCH(
      send('PATCH', `http://localhost/api/gestion/periodos/${id}`, {
        startsAt: '2026-09-18T12:00:00+02:00',
        endsAt: '2026-09-18T14:00:00+02:00',
      }),
      params(id),
    );

    expect(response.status).toBe(422);
    expectMatchesContract(responseSchema('/gestion/periodos/{id}', 'patch', '422'), await response.json());
  });

  it('answers 404 to a period that does not exist', async () => {
    const id = randomUUID();

    const response = await period.PATCH(
      send('PATCH', `http://localhost/api/gestion/periodos/${id}`, { startsAt: LUNCH.startsAt, endsAt: LUNCH.endsAt }),
      params(id),
    );

    expect(response.status).toBe(404);
    expectMatchesContract(responseSchema('/gestion/periodos/{id}', 'patch', '404'), await response.json());
  });
});

describe('DELETE /gestion/periodos/{id}', () => {
  it('answers 204 and the period is gone', async () => {
    const id = await createdId();

    const response = await period.DELETE(
      new Request(`http://localhost/api/gestion/periodos/${id}`, { method: 'DELETE', headers: { Cookie: cookie } }),
      params(id),
    );

    expect(response.status).toBe(204);
    const { rows } = await testPool().query('SELECT 1 FROM unavailable_period WHERE id = $1', [id]);
    expect(rows).toEqual([]);
  });

  it('answers 404 to a period that does not exist, or an id that is not one', async () => {
    for (const id of [randomUUID(), 'no-es-un-id']) {
      const response = await period.DELETE(
        new Request(`http://localhost/api/gestion/periodos/${id}`, { method: 'DELETE', headers: { Cookie: cookie } }),
        params(id),
      );

      expect(response.status).toBe(404);
      expectMatchesContract(responseSchema('/gestion/periodos/{id}', 'delete', '404'), await response.json());
    }
  });

  it('answers 401 without a session and releases nothing', async () => {
    const id = await createdId();

    const response = await period.DELETE(
      new Request(`http://localhost/api/gestion/periodos/${id}`, { method: 'DELETE' }),
      params(id),
    );

    expect(response.status).toBe(401);
    expectMatchesContract(responseSchema('/gestion/periodos/{id}', 'delete', '401'), await response.json());
    const { rows } = await testPool().query('SELECT 1 FROM unavailable_period WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);
  });
});
