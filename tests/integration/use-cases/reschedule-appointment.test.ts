import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConfirmBooking } from '@/application/use-cases/confirm-booking';
import { createGetAvailability } from '@/application/use-cases/get-availability';
import { createRescheduleAppointment } from '@/application/use-cases/reschedule-appointment';
import { createViewAppointment } from '@/application/use-cases/view-appointment';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { tokenGenerator } from '@/infrastructure/security/token';
import { closeTestDb, ensureSchema, testPool, truncateAppointments } from '../helpers/test-db';
import { COLOR, CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * FR-025 and BR-006: the move is atomic, and the failing case is the one that
 * matters — the client must never end up with neither the old hour nor the new.
 */

const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');
let currentNow = NOW;
const clock: Clock = { now: () => currentNow };

/** Friday 2026-09-18 at 11:30 and 16:00, salon time. */
const FRIDAY_1130 = '2026-09-18T09:30:00Z';
const FRIDAY_1600 = '2026-09-18T14:00:00Z';

/** No price, 30 minutes: with Corte, an appointment of one hour. */
const LAVADO = '00000000-0000-4000-8000-000000000014';

function build() {
  const config = createSalonConfigRepository(() => testPool());
  const appointments = createAppointmentRepository(() => testPool());

  return {
    confirmBooking: createConfirmBooking({ config, appointments, tokens: tokenGenerator, clock }),
    viewAppointment: createViewAppointment({ config, appointments, tokens: tokenGenerator, clock }),
    getAvailability: createGetAvailability({ config, appointments, clock }),
    rescheduleAppointment: createRescheduleAppointment({
      config,
      appointments,
      tokens: tokenGenerator,
      clock,
    }),
  };
}

let useCases: ReturnType<typeof build>;

async function book(
  startsAt = FRIDAY_1130,
  serviceId: string = COLOR,
  phone = '600112233',
  email = 'ana@example.com',
): Promise<string> {
  const result = await useCases.confirmBooking({
    serviceIds: [serviceId],
    startsAt,
    contact: { name: 'Ana López', phone, email },
  });
  if (!result.ok) throw new Error('the fixture booking was rejected');
  return result.value.token;
}

async function startOf(token: string): Promise<string | undefined> {
  return (await useCases.viewAppointment(token))?.appointment.startsAt.toString();
}

beforeAll(async () => {
  await ensureSchema();
  await seedContractDatabase();
  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Lavado', 30, NULL, true, 4)`,
    [LAVADO],
  );
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  currentNow = NOW;
  useCases = build();
});

describe('a move that goes through', () => {
  it('puts the appointment at its new hour', async () => {
    const token = await book();

    const result = await useCases.rescheduleAppointment(token, FRIDAY_1600);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.unchanged).toBe(false);
    expect(result.value.detail.appointment.startsAt.toString()).toBe(FRIDAY_1600);
  });

  it('keeps the same link (FR-026)', async () => {
    const token = await book();

    await useCases.rescheduleAppointment(token, FRIDAY_1600);

    // The very same token still resolves, now to the new hour.
    expect(await startOf(token)).toBe(FRIDAY_1600);
  });

  it('frees the old hour immediately', async () => {
    const token = await book();
    await useCases.rescheduleAppointment(token, FRIDAY_1600);

    const other = await useCases.confirmBooking({
      serviceIds: [COLOR],
      startsAt: FRIDAY_1130,
      contact: { name: 'Otro', phone: '700112233', email: 'otro@example.com' },
    });

    expect(other.ok).toBe(true);
  });

  it('updates the row instead of creating a second one', async () => {
    const token = await book();

    await useCases.rescheduleAppointment(token, FRIDAY_1600);

    const { rows } = await testPool().query<{ count: string }>(
      'SELECT count(*) AS count FROM appointment',
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('keeps the frozen service and its duration (FR-024, D-011)', async () => {
    const token = await book();

    await testPool().query(
      `UPDATE service SET duration_minutes = 30, name = 'Color express' WHERE id = $1`,
      [COLOR],
    );

    const result = await build().rescheduleAppointment(token, FRIDAY_1600);

    if (!result.ok) throw new Error('unreachable');
    const { appointment } = result.value.detail;
    expect(appointment.services[0].name).toBe('Color');
    expect(appointment.endsAt.since(appointment.startsAt).total('minutes')).toBe(90);
  });
});

describe('picking the hour already held (escenario 5)', () => {
  it('reports no change and writes nothing', async () => {
    const token = await book();

    const result = await useCases.rescheduleAppointment(token, FRIDAY_1130);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.unchanged).toBe(true);
    expect(await startOf(token)).toBe(FRIDAY_1130);
  });
});

describe('the new slot is taken in between (FR-025, BR-006)', () => {
  it('leaves the original appointment intact in its original hour', async () => {
    const token = await book();

    // Somebody else takes 16:00 while the client is still choosing.
    const other = await useCases.confirmBooking({
      serviceIds: [CORTE],
      startsAt: FRIDAY_1600,
      contact: { name: 'Otro', phone: '700112233', email: 'otro@example.com' },
    });
    expect(other.ok).toBe(true);

    const result = await useCases.rescheduleAppointment(token, FRIDAY_1600);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'REJECTED', rejection: { kind: 'SLOT_TAKEN' } });

    // The client still has their appointment, exactly where it was.
    expect(await startOf(token)).toBe(FRIDAY_1130);
    const { rows } = await testPool().query<{ status: string }>(
      'SELECT status FROM appointment WHERE starts_at = $1',
      [new Date(FRIDAY_1130)],
    );
    expect(rows[0]?.status).toBe('CONFIRMED');
  });

  it('loses the race rather than double-booking when two moves target one slot', async () => {
    const mine = await book(FRIDAY_1130, COLOR, '600112233', 'ana@example.com');
    const theirs = await book('2026-09-18T08:00:00Z', COLOR, '700112233', 'otro@example.com');

    const [first, second] = await Promise.all([
      useCases.rescheduleAppointment(mine, FRIDAY_1600),
      useCases.rescheduleAppointment(theirs, FRIDAY_1600),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);

    const { rows } = await testPool().query<{ count: string }>(
      "SELECT count(*) AS count FROM appointment WHERE status = 'CONFIRMED'",
    );
    // Both appointments still exist: the loser kept its own hour.
    expect(Number(rows[0]?.count)).toBe(2);
  });
});

describe('moves that are refused outright', () => {
  it('refuses once less than 24 hours remain (BR-004)', async () => {
    const token = await book();
    currentNow = Temporal.Instant.from('2026-09-17T16:00:00Z');

    const result = await useCases.rescheduleAppointment(token, '2026-09-25T09:30:00Z');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('BLOCKED');
    if (result.error.kind !== 'BLOCKED') throw new Error('unreachable');
    expect(result.error.block.kind).toBe('TOO_LATE');
  });

  it('refuses an hour the salon is not open for', async () => {
    const token = await book();

    // Sunday, which the seed leaves without opening stretches.
    const result = await useCases.rescheduleAppointment(token, '2026-09-20T09:30:00Z');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('REJECTED');
  });

  it('answers NOT_FOUND for a token that resolves to nothing', async () => {
    const result = await useCases.rescheduleAppointment('a'.repeat(43), FRIDAY_1600);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('NOT_FOUND');
  });

  it('answers INVALID_START for an instant it cannot read', async () => {
    const token = await book();

    const result = await useCases.rescheduleAppointment(token, 'mañana');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('INVALID_START');
  });
});

describe('an appointment of several services (005, Historia 2)', () => {
  async function bookOneHour(): Promise<string> {
    const result = await useCases.confirmBooking({
      serviceIds: [LAVADO, CORTE],
      startsAt: FRIDAY_1130,
      contact: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    });
    if (!result.ok) throw new Error('the fixture booking was rejected');
    return result.value.token;
  }

  it('moves keeping its link, its services and its hour of length (FR-017, FR-026)', async () => {
    const token = await bookOneHour();

    const result = await useCases.rescheduleAppointment(token, FRIDAY_1600);

    if (!result.ok) throw new Error('unreachable');
    const moved = (await useCases.viewAppointment(token))?.appointment;
    expect(moved?.startsAt.toString()).toBe(FRIDAY_1600);
    expect(moved?.services.map((service) => service.serviceId)).toEqual([CORTE, LAVADO]);
    expect(moved?.endsAt.since(moved.startsAt).total('minutes')).toBe(60);
  });

  it('offers only the starts where the whole hour fits, its own marked (escenario 3)', async () => {
    const token = await bookOneHour();
    const detail = await useCases.viewAppointment(token);
    if (detail === null) throw new Error('unreachable');

    const availability = await useCases.getAvailability({
      selectedDate: '2026-09-18',
      currentAppointment: {
        services: detail.appointment.services,
        startsAt: detail.appointment.startsAt,
      },
    });

    if (!availability.ok) throw new Error('unreachable');
    expect(availability.value.selection.durationMinutes).toBe(60);
    // 19:00 is the last start of a 10:00 to 20:00 day that holds an hour.
    expect(availability.value.slots.at(-1)?.localTime).toBe('19:00');
    const own = availability.value.slots.find((slot) => slot.isCurrentAppointment);
    expect(own?.localTime).toBe('11:30');
  });
});
