import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { closeTestDb, ensureSchema, testPool } from '../helpers/test-db';

/** 002, T027 and D-027: which periods touch a window, read through their range. */

const repository = createUnavailablePeriodRepository(testPool);

function instant(value: string): Temporal.Instant {
  return Temporal.Instant.from(value);
}

async function insertPeriod(startsAt: string, endsAt: string, reason: string | null): Promise<string> {
  const id = randomUUID();
  await testPool().query(
    'INSERT INTO unavailable_period (id, starts_at, ends_at, reason) VALUES ($1, $2, $3, $4)',
    [id, startsAt, endsAt, reason],
  );
  return id;
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await testPool().query('TRUNCATE unavailable_period');
});

afterAll(async () => {
  await closeTestDb();
});

describe('findOverlapping', () => {
  it('returns the periods that touch the window, in order, with their reason', async () => {
    const lunch = await insertPeriod('2026-09-18T13:00+02:00', '2026-09-18T14:00+02:00', 'Comida');
    const late = await insertPeriod('2026-09-18T18:00+02:00', '2026-09-18T19:00+02:00', null);
    await insertPeriod('2026-09-19T13:00+02:00', '2026-09-19T14:00+02:00', 'Otro día');

    const periods = await repository.findOverlapping(
      instant('2026-09-18T00:00+02:00'),
      instant('2026-09-19T00:00+02:00'),
    );

    expect(periods.map((period) => period.id)).toEqual([lunch, late]);
    expect(periods[0]).toMatchObject({
      startsAt: instant('2026-09-18T13:00+02:00'),
      endsAt: instant('2026-09-18T14:00+02:00'),
      reason: 'Comida',
    });
    expect(periods[1]?.reason).toBeNull();
  });

  it('finds a long period by its range, even when it began well before the window', async () => {
    const holidays = await insertPeriod('2026-09-01T00:00+02:00', '2026-09-30T00:00+02:00', null);

    const periods = await repository.findOverlapping(
      instant('2026-09-18T00:00+02:00'),
      instant('2026-09-19T00:00+02:00'),
    );

    expect(periods.map((period) => period.id)).toEqual([holidays]);
  });

  it('leaves out a period that only touches the window at an edge: half-open (BR-013)', async () => {
    await insertPeriod('2026-09-17T20:00+02:00', '2026-09-18T00:00+02:00', null);
    await insertPeriod('2026-09-19T00:00+02:00', '2026-09-19T02:00+02:00', null);

    const periods = await repository.findOverlapping(
      instant('2026-09-18T00:00+02:00'),
      instant('2026-09-19T00:00+02:00'),
    );

    expect(periods).toEqual([]);
  });
});
