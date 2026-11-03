import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGetAgendaDay } from '@/application/use-cases/get-agenda-day';
import { validateContact } from '@/domain/contact/contact';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { tokenGenerator } from '@/infrastructure/security/token';
import { seedHistory } from '../../../db/seed/history';
import { closeTestDb, testPool, truncateAppointments } from '../helpers/test-db';
import {
  COLOR,
  CONTRACT_NOW,
  CORTE,
  LAVADO,
  seedContractDatabase,
} from '../../contract/helpers/seed-contract-db';

/**
 * 002, T062, SC-010 and D-027: opening a day costs a FIXED number of queries —
 * the same with an empty history as with ten thousand appointments, and the
 * same with one service per appointment as with several. A query per
 * appointment for its services is the natural trap of a timeline, and this is
 * what catches it.
 */

const clock: Clock = { now: () => CONTRACT_NOW };
const FRIDAY = '2026-09-18';

function spyingPool(pool: Pool): { pool: Pool; statements: string[] } {
  const statements: string[] = [];
  const proxy = new Proxy(pool, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        statements.push(String(args[0]));
        return (target.query as (...rest: unknown[]) => unknown)(...args);
      };
    },
  });
  return { pool: proxy, statements };
}

async function statementsToOpenFriday(): Promise<number> {
  const spy = spyingPool(testPool());
  const getAgendaDay = createGetAgendaDay({
    config: createSalonConfigRepository(() => spy.pool),
    appointments: createAppointmentRepository(() => spy.pool),
    periods: createUnavailablePeriodRepository(() => spy.pool),
    clock,
  });

  const result = await getAgendaDay({ date: FRIDAY, includeCancelled: true });
  if (!result.ok) throw new Error('unreachable');
  return spy.statements.length;
}

/** Four appointments on Friday, each with all three services of the catalogue. */
async function fillFriday(): Promise<void> {
  const repository = createAppointmentRepository(testPool);
  const contact = validateContact(
    { name: 'Ana', phone: '600112233', email: 'ana@example.com' },
    { email: 'REQUIRED' },
  );
  if (!contact.ok) throw new Error('unreachable');

  for (const hour of [10, 13, 16, 19]) {
    const startsAt = Temporal.Instant.from(`${FRIDAY}T${String(hour - 2).padStart(2, '0')}:00:00Z`);
    await repository.insert({
      id: randomUUID(),
      startsAt,
      endsAt: startsAt.add({ minutes: 150 }),
      services: [
        { serviceId: CORTE, name: 'Corte', durationMinutes: 30, priceCents: 1800 },
        { serviceId: COLOR, name: 'Color', durationMinutes: 90, priceCents: 5500 },
        { serviceId: LAVADO, name: 'Lavado', durationMinutes: 30, priceCents: null },
      ],
      contact: contact.value,
      tokenHash: tokenGenerator.generate().hash,
      createdAt: CONTRACT_NOW,
    });
  }
}

beforeAll(async () => {
  await seedContractDatabase();
});

beforeEach(async () => {
  await truncateAppointments();
});

afterAll(async () => {
  await closeTestDb();
});

describe('opening a day of the agenda (SC-010, D-027)', () => {
  it('costs the same statements with an empty day as with four appointments of three services', async () => {
    const empty = await statementsToOpenFriday();

    await fillFriday();

    // Salon, stretches, services, the day's appointments with their services, its periods.
    expect(empty).toBe(5);
    expect(await statementsToOpenFriday()).toBe(empty);
  });

  it('costs the same statements with ten thousand appointments in the history', async () => {
    await fillFriday();
    const before = await statementsToOpenFriday();

    await seedHistory(
      process.env['DATABASE_URL_TEST'] ?? '',
      10_000,
      new Date(CONTRACT_NOW.epochMilliseconds),
    );

    expect(await statementsToOpenFriday()).toBe(before);
  });
});
