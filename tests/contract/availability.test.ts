import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLOR,
  CONTRACT_NOW,
  CORTE,
  LAVADO,
  seedContractDatabase,
} from './helpers/seed-contract-db';
import { expectMatchesContract, responseSchema } from './helpers/openapi';
import { closeTestDb, truncateAppointments } from '../integration/helpers/test-db';

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

const { GET } = await import('@/app/api/availability/route');

const okSchema = responseSchema('/availability', 'get', '200');
const errorSchema = responseSchema('/availability', 'get', '400');

function request(query: Record<string, string>): Request {
  const url = new URL('http://localhost/api/availability');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url);
}

type AvailabilityBody = {
  serviceIds: string[];
  services: { id: string; name: string; priceLabel: string }[];
  durationMinutes: number;
  price: { kind: string; knownCents: number | null; label: string };
  fitsOpeningHours: boolean;
  range: { start: string; end: string; canGoBack: boolean; canGoForward: boolean };
  days: {
    date: string;
    status: string;
    slotCount: number;
    weekdayLabel: string;
    dayLabel: string;
  }[];
  selectedDate: string;
  slots: { startsAt: string; localTime: string; endsLocalTime: string }[];
  nextAvailableDate: string | null;
  cancellationPolicyHours: number;
};

async function availability(query: Record<string, string>): Promise<{
  status: number;
  body: AvailabilityBody;
}> {
  const response = await GET(request(query));
  return { status: response.status, body: (await response.json()) as AvailabilityBody };
}

beforeAll(async () => {
  await seedContractDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
});

describe('GET /api/availability — the shape of AvailabilityResponse', () => {
  it('answers 200 with a body shaped like the contract', async () => {
    const response = await GET(request({ serviceIds: CORTE }));

    expect(response.status).toBe(200);
    expectMatchesContract(okSchema, await response.json());
  });

  it('answers range, days and slots in one response (FR-005, FR-005a, FR-006)', async () => {
    const { body } = await availability({ serviceIds: CORTE });

    expect(body.days).toHaveLength(14);
    expect(body.range.start).toBe('2026-09-15');
    expect(body.range.end).toBe('2026-09-28');
    expect(body.selectedDate).toBe('2026-09-15');
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.cancellationPolicyHours).toBe(24);
  });

  it('labels each day so the client does no date arithmetic (FR-033)', async () => {
    const { body } = await availability({ serviceIds: CORTE });
    const friday = body.days.find((day) => day.date === '2026-09-18');

    expect(friday?.dayLabel).toBe('18');
    expect(friday?.weekdayLabel.length).toBeGreaterThan(0);
  });

  it('marks Sunday CLOSED and never FULL', async () => {
    const { body } = await availability({ serviceIds: CORTE });

    expect(body.days.find((day) => day.date === '2026-09-20')?.status).toBe('CLOSED');
  });

  it('formats slot times as HH:mm in the salon clock', async () => {
    const { body } = await availability({ serviceIds: CORTE, selectedDate: '2026-09-18' });

    expect(body.slots[0]?.localTime).toBe('10:00');
    expect(body.slots[0]?.endsLocalTime).toBe('10:30');
    expect(body.slots.at(-1)?.localTime).toBe('19:30');
  });
});

describe('canGoBack and canGoForward at the ends (escenarios 9 y 10)', () => {
  it('cannot go back from the first range, which starts today', async () => {
    const { body } = await availability({ serviceIds: CORTE });

    expect(body.range.canGoBack).toBe(false);
    expect(body.range.canGoForward).toBe(true);
  });

  it('cannot go forward from the range that reaches the horizon', async () => {
    const { body } = await availability({ serviceIds: CORTE, rangeStart: '2026-11-10' });

    expect(body.range.end).toBe('2026-11-14');
    expect(body.range.canGoForward).toBe(false);
    expect(body.range.canGoBack).toBe(true);
  });

  it('trims the last range to day 60 instead of overrunning it', async () => {
    const { body } = await availability({ serviceIds: CORTE, rangeStart: '2026-11-10' });

    expect(body.days).toHaveLength(5);
  });
});

describe('400 responses', () => {
  it('rejects a service that does not exist, with an Error shaped like the contract', async () => {
    const response = await GET(request({ serviceIds: randomUUID() }));

    expect(response.status).toBe(400);
    expectMatchesContract(errorSchema, await response.json());
  });

  it('rejects a missing serviceIds', async () => {
    const response = await GET(request({}));

    expect(response.status).toBe(400);
    expectMatchesContract(errorSchema, await response.json());
  });

  it('rejects a range that starts before today', async () => {
    const response = await GET(request({ serviceIds: CORTE, rangeStart: '2026-09-14' }));

    expect(response.status).toBe(400);
  });

  it('rejects a range beyond the 60 day horizon', async () => {
    const response = await GET(request({ serviceIds: CORTE, rangeStart: '2026-11-15' }));

    expect(response.status).toBe(400);
  });

  it('rejects a malformed date rather than guessing at it', async () => {
    const response = await GET(request({ serviceIds: CORTE, rangeStart: 'mañana' }));

    expect(response.status).toBe(400);
  });

  it('says what to do next, as every error must (SC-012)', async () => {
    const body = (await (await GET(request({}))).json()) as { nextAction: string };

    expect(body.nextAction.length).toBeGreaterThan(0);
  });
});

describe('several services (005, contract 2.0.0)', () => {
  it('lasts the sum, lists the services in catalogue order and prices them all', async () => {
    const response = await GET(request({ serviceIds: `${COLOR},${CORTE}` }));
    const body = (await response.clone().json()) as AvailabilityBody;

    expect(response.status).toBe(200);
    expectMatchesContract(okSchema, await response.json());
    expect(body.durationMinutes).toBe(120);
    expect(body.serviceIds).toEqual([CORTE, COLOR]);
    expect(body.services.map((service) => service.name)).toEqual(['Corte', 'Color']);
    expect(body.price).toEqual({ kind: 'ALL_PRICED', knownCents: 7300, label: '73,00 €' });
    expect(body.fitsOpeningHours).toBe(true);
  });

  it('drops a repeated id and answers as if it had come once', async () => {
    const once = await availability({ serviceIds: `${CORTE},${COLOR}` });
    const twice = await availability({ serviceIds: `${CORTE},${COLOR},${CORTE}` });

    expect(twice.status).toBe(200);
    expect(twice.body).toEqual(once.body);
  });

  it('asks for at least one service when the selection is empty (FR-004)', async () => {
    const response = await GET(request({ serviceIds: '' }));
    const body = (await response.clone().json()) as { code: string; nextAction: string };

    expect(response.status).toBe(400);
    expectMatchesContract(errorSchema, await response.json());
    expect(body.code).toBe('EMPTY_SELECTION');
    expect(body.nextAction.length).toBeGreaterThan(0);
  });
});

describe('a selection that is only partly priced (005, FR-020)', () => {
  it('adds what is known and says the rest is asked at the salon', async () => {
    const response = await GET(request({ serviceIds: `${CORTE},${LAVADO}` }));
    const body = (await response.clone().json()) as AvailabilityBody;

    expectMatchesContract(okSchema, await response.json());
    expect(body.price).toEqual({
      kind: 'PARTIALLY_PRICED',
      knownCents: 1800,
      label: '18,00 € + precio a consultar en el salón',
    });
    expect(body.services.map((service) => service.priceLabel)).toEqual([
      '18,00 €',
      'Precio a consultar en el salón',
    ]);
  });

  it('has no price at all when no service has one', async () => {
    const { body } = await availability({ serviceIds: LAVADO });

    expect(body.price).toEqual({
      kind: 'NONE_PRICED',
      knownCents: null,
      label: 'Precio a consultar en el salón',
    });
  });
});
