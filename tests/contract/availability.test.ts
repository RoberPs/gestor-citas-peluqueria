import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_NOW, CORTE, seedContractDatabase } from './helpers/seed-contract-db';
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
  range: { start: string; end: string; canGoBack: boolean; canGoForward: boolean };
  days: { date: string; status: string; slotCount: number; weekdayLabel: string; dayLabel: string }[];
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
