import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGetAvailability } from '@/application/use-cases/get-availability';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { closeTestDb, ensureSchema, testPool, truncateAppointments } from '../helpers/test-db';
import {
  CONTRACT_NOW,
  CORTE,
  seedContractDatabase,
} from '../../contract/helpers/seed-contract-db';

/**
 * 002, T013, FR-056 and D-021: whatever the owner saves rules in the client's
 * very next query, with no deploy and no restart.
 *
 * The use case is built once and reused across the change, as the running
 * process reuses its container: a cache reintroduced anywhere under it would
 * answer with the old value here. And the statements are counted, so that
 * reading the configuration live cannot quietly become a query per day.
 */

const clock: Clock = { now: () => CONTRACT_NOW };

/** Records the SQL that reaches the pool. */
function spyingPool(pool: Pool): { pool: Pool; statements: string[] } {
  const statements: string[] = [];

  const proxy = new Proxy(pool, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);

      return (...args: unknown[]) => {
        const first = args[0];
        statements.push(
          typeof first === 'string' ? first : String((first as { text?: string })?.text ?? ''),
        );
        return (target.query as (...rest: unknown[]) => unknown)(...args);
      };
    },
  });

  return { pool: proxy, statements };
}

function build(pool: Pool) {
  return createGetAvailability({
    config: createSalonConfigRepository(() => pool),
    appointments: createAppointmentRepository(() => pool),
    periods: createUnavailablePeriodRepository(() => pool),
    clock,
  });
}

async function firstSlotToday(getAvailability: ReturnType<typeof build>): Promise<string> {
  const result = await getAvailability({ serviceIds: [CORTE], selectedDate: '2026-09-15' });
  if (!result.ok) throw new Error('availability was rejected');
  return result.value.slots[0]?.localTime ?? 'none';
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await seedContractDatabase();
  await truncateAppointments();
});

afterAll(async () => {
  await closeTestDb();
});

describe('a configuration change rules in the next query (FR-056)', () => {
  it('applies a new minimum lead time to the next availability query (SC-009)', async () => {
    const getAvailability = build(testPool());
    // Tuesday 10:00 in the salon, two hours of lead time: noon is the first start.
    expect(await firstSlotToday(getAvailability)).toBe('12:00');

    await testPool().query('UPDATE salon SET minimum_lead_time_minutes = 240');

    expect(await firstSlotToday(getAvailability)).toBe('14:00');
  });

  it('offers a new service in the next query (SC-007)', async () => {
    const getAvailability = build(testPool());
    const mechas = randomUUID();

    await testPool().query(
      `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
       VALUES ($1, 'Mechas', 90, NULL, true, 9)`,
      [mechas],
    );

    const result = await getAvailability({ serviceIds: [mechas] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.selection.durationMinutes).toBe(90);
  });

  it('takes the hours of a new period out in the next query (SC-003)', async () => {
    const getAvailability = build(testPool());
    expect(await firstSlotToday(getAvailability)).toBe('12:00');

    await testPool().query(
      `INSERT INTO unavailable_period (id, starts_at, ends_at, reason)
       VALUES ($1, '2026-09-15 12:00 Europe/Madrid', '2026-09-15 13:00 Europe/Madrid', 'Comida')`,
      [randomUUID()],
    );

    expect(await firstSlotToday(getAvailability)).toBe('13:00');
  });
});

describe('what reading the configuration live costs (Principio VIII, D-021)', () => {
  it('spends the same fixed number of statements on every query, whatever is in the window', async () => {
    const spy = spyingPool(testPool());
    const getAvailability = build(spy.pool);

    await firstSlotToday(getAvailability);
    const first = spy.statements.length;

    for (const hours of [12, 13, 14]) {
      await testPool().query(
        `INSERT INTO unavailable_period (id, starts_at, ends_at, reason)
         VALUES ($1, $2::timestamptz, $2::timestamptz + interval '30 minutes', NULL)`,
        [randomUUID(), `2026-09-16 ${hours}:00 Europe/Madrid`],
      );
    }
    spy.statements.length = 0;
    await firstSlotToday(getAvailability);

    // Salon, opening stretches, services, the horizon's appointments, its periods.
    expect(first).toBe(5);
    expect(spy.statements).toHaveLength(first);
  });
});
