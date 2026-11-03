import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCancelAppointment } from '@/application/use-cases/cancel-appointment';
import { createConfirmBooking } from '@/application/use-cases/confirm-booking';
import { createGetAvailability } from '@/application/use-cases/get-availability';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { tokenGenerator } from '@/infrastructure/security/token';
import { closeTestDb, ensureSchema, testPool, truncateAppointments } from '../helpers/test-db';
import { CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * FR-023 and BR-005: the slot is free again immediately, in the same commit,
 * and a second cancellation loses.
 */

const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');
let currentNow = NOW;
const clock: Clock = { now: () => currentNow };

const FRIDAY_1130 = '2026-09-18T09:30:00Z';

function build() {
  const config = createSalonConfigRepository(() => testPool());
  const appointments = createAppointmentRepository(() => testPool());
  const periods = createUnavailablePeriodRepository(() => testPool());

  return {
    confirmBooking: createConfirmBooking({ config, appointments, periods, tokens: tokenGenerator, clock }),
    cancelAppointment: createCancelAppointment({
      config,
      appointments,
      tokens: tokenGenerator,
      clock,
    }),
    getAvailability: createGetAvailability({ config, appointments, periods, clock }),
  };
}

let useCases: ReturnType<typeof build>;

async function book(): Promise<string> {
  const result = await useCases.confirmBooking({
    serviceIds: [CORTE],
    startsAt: FRIDAY_1130,
    contact: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
  });
  if (!result.ok) throw new Error('the fixture booking was rejected');
  return result.value.token;
}

async function slotsOnFriday(): Promise<readonly string[]> {
  const availability = await useCases.getAvailability({
    serviceIds: [CORTE],
    selectedDate: '2026-09-18',
  });
  if (!availability.ok) throw new Error('availability was rejected');
  return availability.value.slots.map((slot) => slot.localTime);
}

beforeAll(async () => {
  await ensureSchema();
  await seedContractDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  currentNow = NOW;
  useCases = build();
});

describe('cancelling', () => {
  it('cancels the appointment and records the moment', async () => {
    const token = await book();

    const result = await useCases.cancelAppointment(token);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.view).toBe('CANCELLED');
    expect(result.value.appointment.cancelledAt?.equals(NOW)).toBe(true);
  });

  it('records that the client cancelled it, in the same row (002, FR-040a, D-032)', async () => {
    const token = await book();

    const result = await useCases.cancelAppointment(token);
    if (!result.ok) throw new Error('unreachable');

    expect(result.value.appointment.cancelledBy).toBe('CUSTOMER');
    const { rows } = await testPool().query<{ cancelled_by: string | null }>(
      'SELECT cancelled_by FROM appointment WHERE id = $1',
      [result.value.appointment.id],
    );
    expect(rows[0]?.cancelled_by).toBe('CUSTOMER');
  });

  it('frees the slot in the same commit (FR-023, BR-005)', async () => {
    const token = await book();
    expect(await slotsOnFriday()).not.toContain('11:30');

    await useCases.cancelAppointment(token);

    expect(await slotsOnFriday()).toContain('11:30');
  });

  it('lets another client take the freed slot straight away (escenario 5)', async () => {
    const token = await book();
    await useCases.cancelAppointment(token);

    const other = await useCases.confirmBooking({
      serviceIds: [CORTE],
      startsAt: FRIDAY_1130,
      contact: { name: 'Otro', phone: '700112233', email: 'otro@example.com' },
    });

    expect(other.ok).toBe(true);
  });

  it('keeps the cancelled appointment in the history rather than deleting it', async () => {
    const token = await book();
    await useCases.cancelAppointment(token);

    const { rows } = await testPool().query<{ status: string; service_name: string }>(
      `SELECT a.status, s.name AS service_name
         FROM appointment a JOIN appointment_service s ON s.appointment_id = a.id`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('CANCELLED');
    expect(rows[0]?.service_name).toBe('Corte');
  });

  it('leaves both actions closed afterwards: cancelled is terminal (BR-007)', async () => {
    const token = await book();

    const result = await useCases.cancelAppointment(token);

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.canCancel).toBe(false);
    expect(result.value.canReschedule).toBe(false);
  });
});

describe('cancellations that are refused', () => {
  it('refuses a second cancellation with ALREADY_CANCELLED (escenario 4)', async () => {
    const token = await book();
    await useCases.cancelAppointment(token);

    const again = await useCases.cancelAppointment(token);

    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('unreachable');
    expect(again.error).toEqual({ kind: 'BLOCKED', block: { kind: 'ALREADY_CANCELLED' } });
  });

  it('refuses a cancellation past the 24 hour deadline (BR-004)', async () => {
    const token = await book();
    // 2026-09-17 at 18:00 Madrid: less than 24 hours before 11:30 on the 18th.
    currentNow = Temporal.Instant.from('2026-09-17T16:00:00Z');

    const result = await useCases.cancelAppointment(token);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('BLOCKED');
    if (result.error.kind !== 'BLOCKED') throw new Error('unreachable');
    expect(result.error.block.kind).toBe('TOO_LATE');
  });

  it('leaves the appointment confirmed when it refuses', async () => {
    const token = await book();
    currentNow = Temporal.Instant.from('2026-09-17T16:00:00Z');

    await useCases.cancelAppointment(token);

    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment');
    expect(rows[0]?.status).toBe('CONFIRMED');
  });

  it('answers NOT_FOUND for a token that resolves to nothing', async () => {
    const result = await useCases.cancelAppointment('a'.repeat(43));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('NOT_FOUND');
  });
});
