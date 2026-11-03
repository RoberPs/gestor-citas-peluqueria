import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGetAvailability } from '@/application/use-cases/get-availability';
import { createViewAppointment } from '@/application/use-cases/view-appointment';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { generate, tokenGenerator } from '@/infrastructure/security/token';
import {
  closeTestDb,
  ensureSchema,
  insertAppointmentRow,
  testPool,
  truncateAppointments,
} from '../helpers/test-db';
import { CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * FR-007b, FR-007c and BR-016b: a confirmed appointment outranks a change to
 * the configuration. The change affects what is offered from then on and
 * nothing else.
 *
 * There is no implementation behind this test, and that is the point. The
 * design already guarantees it — configuration and appointments are separate
 * tables and availability is derived, so there is no code path that could
 * cancel an appointment when a period blocks its day. This test exists so that it
 * cannot stop being true without somebody noticing.
 */

/** A whole-day unavailable period on that Thursday: what a closure is since 002 (D-019). */
async function blockThursday(): Promise<void> {
  await testPool().query(
    `INSERT INTO unavailable_period (id, starts_at, ends_at, reason)
     VALUES ($1, '2026-09-17 00:00 Europe/Madrid', '2026-09-18 00:00 Europe/Madrid', 'Ausencia')`,
    [randomUUID()],
  );
}

/** Thursday 2026-09-17, 11:00 salon time. */
const THURSDAY_1100 = '2026-09-17T09:00:00Z';
const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');
const clock: Clock = { now: () => NOW };

function build(pool: Pool = testPool()) {
  const config = createSalonConfigRepository(() => pool);
  const appointments = createAppointmentRepository(() => pool);
  const periods = createUnavailablePeriodRepository(() => pool);

  return {
    appointments,
    getAvailability: createGetAvailability({ config, appointments, periods, clock }),
    viewAppointment: createViewAppointment({ config, appointments, tokens: tokenGenerator, clock }),
  };
}

/** Records every statement, so a hidden write cannot pass unnoticed. */
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

async function insertThursdayAppointment(): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const { token, hash } = generate();

  const startsAt = new Date(THURSDAY_1100);
  await insertAppointmentRow(
    {
      id,
      status: 'CONFIRMED',
      starts_at: startsAt,
      ends_at: new Date(startsAt.getTime() + 30 * 60_000),
      customer_name: 'Ana López',
      customer_phone: '600112233',
      customer_email: 'ana@example.com',
      customer_phone_normalized: '+34600112233',
      customer_email_normalized: 'ana@example.com',
      token_hash: Buffer.from(hash),
    },
    { serviceId: CORTE, name: 'Corte', durationMinutes: 30, priceCents: 1800 },
  );

  return { id, token };
}

type AppointmentState = {
  status: string;
  cancelled_at: Date | null;
  token_hash: Buffer | null;
  starts_at: Date;
  service_name: string;
};

async function stateOf(id: string): Promise<AppointmentState | undefined> {
  const { rows } = await testPool().query<AppointmentState>(
    `SELECT a.status, a.cancelled_at, a.token_hash, a.starts_at, s.name AS service_name
       FROM appointment a JOIN appointment_service s ON s.appointment_id = a.id
      WHERE a.id = $1`,
    [id],
  );
  return rows[0];
}

async function countAppointments(): Promise<number> {
  const { rows } = await testPool().query<{ count: string }>(
    'SELECT count(*) AS count FROM appointment',
  );
  return Number(rows[0]?.count ?? 0);
}

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  // The whole configuration is rebuilt per test, because these tests change it.
  await seedContractDatabase();
  await truncateAppointments();
});

describe('(a) a whole-day period blocks the day of a confirmed appointment (FR-007b)', () => {
  it('leaves the appointment confirmed, uncancelled and still reachable', async () => {
    const { id, token } = await insertThursdayAppointment();
    const before = await stateOf(id);

    await blockThursday();

    const after = await stateOf(id);
    expect(after?.status).toBe('CONFIRMED');
    expect(after?.cancelled_at).toBeNull();
    expect(after?.token_hash).toEqual(before?.token_hash);

    // FR-007c: the client still sees their appointment exactly as booked.
    const detail = await build().viewAppointment(token);
    expect(detail?.appointment.services).toEqual([
      {
        serviceId: CORTE,
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 1800,
      },
    ]);
    expect(detail?.appointment.startsAt.toString()).toBe(THURSDAY_1100);
    expect(detail?.view).toBe('CONFIRMED');
  });

  it('stops offering that day and nothing more', async () => {
    await insertThursdayAppointment();

    await blockThursday();

    const result = await build().getAvailability({ serviceIds: [CORTE] });
    if (!result.ok) throw new Error('unreachable');

    expect(result.value.days.find((day) => day.date === '2026-09-17')?.status).toBe('CLOSED');
    // The day before is untouched.
    expect(result.value.days.find((day) => day.date === '2026-09-16')?.status).toBe('AVAILABLE');
  });
});

describe('(b) the opening stretch holding the appointment is withdrawn (BR-016b)', () => {
  it('reports the day closed and offers no start at all', async () => {
    await insertThursdayAppointment();

    await testPool().query('DELETE FROM opening_interval WHERE weekday = 4');

    const result = await build().getAvailability({
      serviceIds: [CORTE],
      selectedDate: '2026-09-17',
    });
    if (!result.ok) throw new Error('unreachable');

    expect(result.value.days.find((day) => day.date === '2026-09-17')?.status).toBe('CLOSED');
    expect(result.value.slots).toEqual([]);
  });

  it('still reports the appointment as busy, so a restored stretch cannot be booked over', async () => {
    await insertThursdayAppointment();
    await testPool().query('DELETE FROM opening_interval WHERE weekday = 4');

    const busy = await build().appointments.findConfirmedInWindow(
      Temporal.Instant.from('2026-09-17T00:00:00Z'),
      Temporal.Instant.from('2026-09-18T00:00:00Z'),
    );

    expect(busy).toHaveLength(1);
    expect(busy[0]?.startsAt.toString()).toBe(THURSDAY_1100);

    // Put the stretch back: the hour is still taken, by the appointment that
    // never went anywhere.
    await testPool().query(
      `INSERT INTO opening_interval (id, weekday, starts_at, ends_at)
       VALUES ($1, 4, '10:00', '20:00')`,
      [randomUUID()],
    );

    const restored = await build().getAvailability({
      serviceIds: [CORTE],
      selectedDate: '2026-09-17',
    });
    if (!restored.ok) throw new Error('unreachable');

    expect(restored.value.slots.map((slot) => slot.localTime)).not.toContain('11:00');
    expect(restored.value.slots.map((slot) => slot.localTime)).toContain('11:30');
  });
});

describe('(c) neither change writes to the appointment table', () => {
  it('runs no UPDATE and no DELETE against appointment, and loses no row', async () => {
    const { id } = await insertThursdayAppointment();
    const before = await stateOf(id);
    const countBefore = await countAppointments();

    const spy = spyingPool(testPool());

    await blockThursday();
    await testPool().query('DELETE FROM opening_interval WHERE weekday = 4');

    // Reload the configuration through the application, twice over.
    await build(spy.pool).getAvailability({ serviceIds: [CORTE] });
    await build(spy.pool).getAvailability({ serviceIds: [CORTE], rangeStart: '2026-09-17' });

    const writes = spy.statements.filter((sql) =>
      /^\s*(update|delete)\s/i.test(sql) && /appointment/i.test(sql),
    );

    expect(writes).toEqual([]);
    expect(await countAppointments()).toBe(countBefore);
    expect(await stateOf(id)).toEqual(before);
  });
});
