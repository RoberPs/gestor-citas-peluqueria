import { randomBytes, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SalonConfigRepository } from '@/application/ports';
import { createGetAvailability } from '@/application/use-cases/get-availability';
import type { OpeningInterval, Weekday } from '@/domain/catalog/salon';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import {
  closeTestDb,
  ensureSchema,
  insertAppointmentRow,
  testPool,
  truncateAll,
} from '../helpers/test-db';

/**
 * FR-005b and SC-005: loading a range fires **one** appointment query, and the
 * time does not move as the past history grows.
 *
 * Both are checked against a real database. The second one is the reason the
 * index is partial: without `WHERE status = 'CONFIRMED'` the history joins the
 * index and the promise quietly stops holding.
 */

const CORTE = '00000000-0000-4000-8000-000000000011';
const COLOR = '00000000-0000-4000-8000-000000000012';
const PEINADO = '00000000-0000-4000-8000-000000000013';
/** A second 30 minute service, for escenario 4 of 005. */
const BARBA = '00000000-0000-4000-8000-000000000015';

/** Tuesday 2026-09-15, 10:00 in Madrid. */
const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');
const clock: Clock = { now: () => NOW };

/** Records the SQL that reaches the pool, so an N+1 cannot hide. */
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

function appointmentSelects(statements: readonly string[]): readonly string[] {
  return statements.filter((sql) => /from\s+"?appointment"?/i.test(sql) && /^\s*select/i.test(sql));
}

async function seedConfiguration(): Promise<void> {
  await testPool().query(
    `INSERT INTO salon (id, name, address, phone, timezone)
     VALUES ($1, 'Peluqueria Aurora', 'Calle Mayor 14', '911234567', 'Europe/Madrid')`,
    [randomUUID()],
  );

  const weekdays = [1, 2, 3, 4, 5];
  for (const weekday of weekdays) {
    await testPool().query(
      `INSERT INTO opening_interval (id, weekday, starts_at, ends_at)
       VALUES ($1, $2, '10:00', '20:00')`,
      [randomUUID(), weekday],
    );
  }
  await testPool().query(
    `INSERT INTO opening_interval (id, weekday, starts_at, ends_at)
     VALUES ($1, 6, '10:00', '14:00'), ($2, 6, '16:00', '20:00')`,
    [randomUUID(), randomUUID()],
  );

  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Corte', 30, 1800, true, 1), ($2, 'Color', 90, 5500, true, 2),
            ($3, 'Peinado', 45, 2500, true, 3), ($4, 'Barba', 30, 1200, true, 5)`,
    [CORTE, COLOR, PEINADO, BARBA],
  );
}

/** Non-overlapping appointments far in the past, inserted in one statement. */
async function seedPastHistory(count: number): Promise<void> {
  await testPool().query(
    `WITH inserted AS (
       INSERT INTO appointment (
         id, status, starts_at, ends_at,
         customer_name, customer_phone, customer_email,
         customer_phone_normalized, customer_email_normalized, token_hash, created_at
       )
       SELECT gen_random_uuid(), 'CONFIRMED',
              timestamptz '2020-01-01 09:00+01' + (n * interval '2 hours'),
              timestamptz '2020-01-01 09:00+01' + (n * interval '2 hours') + interval '30 minutes',
              'Cliente', '600112233', 'cliente@example.com',
              '+34600112233', 'cliente@example.com',
              decode(md5(n::text), 'hex') || decode(md5(n::text), 'hex'),
              timestamptz '2020-01-01 09:00+01'
         FROM generate_series(1, $2) AS n
       RETURNING id
     )
     INSERT INTO appointment_service
       (appointment_id, position, service_id, name, duration_minutes, price_cents)
     SELECT id, 1, $1, 'Corte', 30, 1800 FROM inserted`,
    [CORTE, count],
  );
}

function buildUseCase(pool: Pool) {
  return createGetAvailability({
    config: createSalonConfigRepository(() => pool),
    appointments: createAppointmentRepository(() => pool),
    periods: createUnavailablePeriodRepository(() => pool),
    clock,
  });
}

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll();
  await seedConfiguration();
});

describe('one query per range load (FR-005b, Principio VIII)', () => {
  it('reads the appointments exactly once for a 14 day range', async () => {
    const spy = spyingPool(testPool());
    const getAvailability = buildUseCase(spy.pool);

    const result = await getAvailability({ serviceIds: [CORTE] });

    expect(result.ok).toBe(true);
    expect(appointmentSelects(spy.statements)).toHaveLength(1);
  });

  it('still reads them once when the whole range is full and it has to look further', async () => {
    // Fill every open day of the first range, forcing the jump of FR-006.
    for (let offset = 0; offset < 14; offset += 1) {
      const date = Temporal.PlainDate.from('2026-09-15').add({ days: offset });
      if (date.dayOfWeek === 7) continue;
      await insertAppointmentRow(
        {
          id: randomUUID(),
          status: 'CONFIRMED',
          starts_at: `${date.toString()} 10:00+02`,
          ends_at: `${date.toString()} 20:00+02`,
          customer_name: 'Cliente',
          customer_phone: '600112233',
          customer_email: 'c@example.com',
          customer_phone_normalized: '+34600112233',
          customer_email_normalized: 'c@example.com',
          token_hash: randomBytes(32),
        },
        { serviceId: CORTE, name: 'Corte', durationMinutes: 600, priceCents: 1800 },
      );
    }

    const spy = spyingPool(testPool());
    const result = await buildUseCase(spy.pool)({ serviceIds: [CORTE] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.nextAvailableDate).not.toBeNull();
    expect(appointmentSelects(spy.statements)).toHaveLength(1);
  });

  it('reads them once whatever the service and the selected day', async () => {
    const spy = spyingPool(testPool());

    await buildUseCase(spy.pool)({
      serviceIds: [COLOR],
      rangeStart: '2026-09-22',
      selectedDate: '2026-09-26',
    });

    expect(appointmentSelects(spy.statements)).toHaveLength(1);
  });
});

describe('the past history does not slow the query down (SC-005)', () => {
  it('answers in the same time with 10.000 past appointments as with none', async () => {
    const getAvailability = buildUseCase(testPool());

    // Warm up: the first call pays for connection setup and the config cache.
    await getAvailability({ serviceIds: [CORTE] });

    const emptyAgenda = await measure(() => getAvailability({ serviceIds: [CORTE] }));

    await seedPastHistory(10_000);

    const { rows } = await testPool().query<{ count: string }>(
      'SELECT count(*) AS count FROM appointment',
    );
    expect(Number(rows[0]?.count)).toBe(10_000);

    const withHistory = await measure(() => getAvailability({ serviceIds: [CORTE] }));

    // Equivalent, with enough headroom that a loaded machine does not make this
    // flaky. What it would catch is a non-partial index, which is not a 20 %
    // regression but an order of magnitude.
    expect(withHistory).toBeLessThan(emptyAgenda * 3 + 100);
  });

  it('leaves the past history out of the result', async () => {
    await seedPastHistory(500);

    const result = await buildUseCase(testPool())({ serviceIds: [CORTE] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // 2026-09-18 is a Friday with nothing booked: the whole day is on offer.
    expect(result.value.days.find((day) => day.date === '2026-09-18')?.slotCount).toBe(20);
  });
});

async function measure(run: () => Promise<unknown>): Promise<number> {
  const runs = 5;
  const started = performance.now();
  for (let i = 0; i < runs; i += 1) await run();
  return (performance.now() - started) / runs;
}

describe('what the range answers', () => {
  it('starts today, cannot go back, and can go forward', async () => {
    const result = await buildUseCase(testPool())({ serviceIds: [CORTE] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.range.start).toBe('2026-09-15');
    expect(result.value.range.end).toBe('2026-09-28');
    expect(result.value.range.canGoBack).toBe(false);
    expect(result.value.range.canGoForward).toBe(true);
  });

  it('cannot go forward from the range that reaches the horizon', async () => {
    const result = await buildUseCase(testPool())({
      serviceIds: [CORTE],
      rangeStart: '2026-11-10',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.range.end).toBe('2026-11-14');
    expect(result.value.range.canGoForward).toBe(false);
    expect(result.value.range.canGoBack).toBe(true);
  });

  it('rejects an unknown service', async () => {
    const result = await buildUseCase(testPool())({ serviceIds: [randomUUID()] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('UNKNOWN_SERVICE');
  });

  it('rejects a range before today and one beyond the horizon', async () => {
    const before = await buildUseCase(testPool())({
      serviceIds: [CORTE],
      rangeStart: '2026-09-14',
    });
    const beyond = await buildUseCase(testPool())({
      serviceIds: [CORTE],
      rangeStart: '2026-11-15',
    });

    expect(before.ok).toBe(false);
    expect(beyond.ok).toBe(false);
  });

  it('rejects a selected day outside the range it was asked for', async () => {
    const result = await buildUseCase(testPool())({
      serviceIds: [CORTE],
      rangeStart: '2026-09-15',
      selectedDate: '2026-10-15',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('RANGE_OUT_OF_BOUNDS');
  });

  it('lands on the first day with room when none is asked for', async () => {
    const result = await buildUseCase(testPool())({ serviceIds: [CORTE] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // Today at 10:00 with a two hour lead time still leaves the afternoon.
    expect(result.value.selectedDate).toBe('2026-09-15');
    expect(result.value.slots[0]?.localTime).toBe('12:00');
  });
});

describe('several services in one appointment (005, Historia 1)', () => {
  const FRIDAY = '2026-09-18';

  it('offers only the starts where the whole selection fits (escenario 3, FR-008)', async () => {
    const result = await buildUseCase(testPool())({
      serviceIds: [CORTE, PEINADO],
      selectedDate: FRIDAY,
    });

    if (!result.ok) throw new Error('unreachable');
    // 75 minutes in a 10:00 to 20:00 day: 18:30 ends at 19:45, 19:00 would not fit.
    expect(result.value.selection.durationMinutes).toBe(75);
    expect(result.value.slots.at(-1)?.localTime).toBe('18:30');
    expect(result.value.slots.map((slot) => slot.localTime)).not.toContain('19:00');
    expect(result.value.price).toEqual({ kind: 'ALL_PRICED', cents: 4300 });
  });

  it('keeps clear of an appointment for the whole selection (escenario 4, BR-013)', async () => {
    await insertAppointmentRow(
      {
        id: randomUUID(),
        status: 'CONFIRMED',
        starts_at: `${FRIDAY} 11:00+02`,
        ends_at: `${FRIDAY} 11:30+02`,
        customer_name: 'Cliente',
        customer_phone: '600112233',
        customer_email: 'c@example.com',
        customer_phone_normalized: '+34600112233',
        customer_email_normalized: 'c@example.com',
        token_hash: randomBytes(32),
      },
      { serviceId: CORTE, name: 'Corte', durationMinutes: 30, priceCents: 1800 },
    );

    const result = await buildUseCase(testPool())({
      serviceIds: [CORTE, BARBA],
      selectedDate: FRIDAY,
    });

    if (!result.ok) throw new Error('unreachable');
    const starts = result.value.slots.map((slot) => slot.localTime);
    expect(starts).not.toContain('10:30');
    expect(starts).not.toContain('11:00');
    expect(starts).toContain('10:00');
    expect(starts).toContain('11:30');
  });

  it('answers the same whatever order the services were picked in (FR-006)', async () => {
    const forwards = await buildUseCase(testPool())({
      serviceIds: [CORTE, PEINADO],
      selectedDate: FRIDAY,
    });
    const backwards = await buildUseCase(testPool())({
      serviceIds: [PEINADO, CORTE],
      selectedDate: FRIDAY,
    });

    if (!forwards.ok || !backwards.ok) throw new Error('unreachable');
    expect(backwards.value.selection).toEqual(forwards.value.selection);
    expect(backwards.value.slots).toEqual(forwards.value.slots);
    expect(backwards.value.days).toEqual(forwards.value.days);
  });

  it('says a selection longer than every opening stretch can never fit (FR-010, D-007)', async () => {
    const real = createSalonConfigRepository(() => testPool());
    const twoHourStretches: SalonConfigRepository = {
      async load() {
        const configuration = await real.load();
        const stretch = (weekday: Weekday): OpeningInterval => ({
          weekday,
          startsAt: Temporal.PlainTime.from('10:00'),
          endsAt: Temporal.PlainTime.from('12:00'),
        });
        return {
          ...configuration,
          schedule: new Map(
            [1, 2, 3, 4, 5, 6].map((day) => [day as Weekday, [stretch(day as Weekday)]]),
          ),
        };
      },
    };

    const getAvailability = createGetAvailability({
      config: twoHourStretches,
      appointments: createAppointmentRepository(() => testPool()),
      periods: createUnavailablePeriodRepository(() => testPool()),
      clock,
    });

    // Color, Corte and Barba: 2 h 30 min, half an hour more than any stretch.
    const result = await getAvailability({
      serviceIds: [COLOR, CORTE, BARBA],
      selectedDate: FRIDAY,
    });

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.fitsOpeningHours).toBe(false);
    expect(result.value.slots).toEqual([]);
    expect(result.value.days.every((day) => day.slotCount === 0)).toBe(true);
  });

  it('says it fits when it does', async () => {
    const result = await buildUseCase(testPool())({ serviceIds: [CORTE, PEINADO] });

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.fitsOpeningHours).toBe(true);
  });
});
