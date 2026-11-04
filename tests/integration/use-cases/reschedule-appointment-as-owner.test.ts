import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { closeTestDb, ensureSchema, testPool, truncateAll } from '../helpers/test-db';
import { bookFriday, clock, friday, insertPeriod, ownerAppointments, seedSalon } from './_owner-fixtures';

/**
 * 002, T097 and T099: the owner moves an appointment against a real
 * PostgreSQL. It keeps its services, their total duration, its data and its
 * link (FR-039, FR-041, BR-020); nothing lands in the past (FR-030).
 */

const useCase = ownerAppointments();
const repository = createAppointmentRepository(testPool);

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll();
  await seedSalon();
});

/** Ana's appointment of 11:00 with two services of 30 minutes, booked online. */
async function twoServiceBooking(): Promise<string> {
  const id = await bookFriday('11:00', '12:00');
  await testPool().query(
    `INSERT INTO appointment_service (appointment_id, position, service_id, name, duration_minutes, price_cents)
     VALUES ($1, 2, '00000000-0000-4000-8000-000000000012', 'Diseño y corte de barba', 30, NULL)`,
    [id],
  );
  return id;
}

async function tokenHashOf(id: string): Promise<string | null> {
  const { rows } = await testPool().query<{ token_hash: Buffer | null }>(
    'SELECT token_hash FROM appointment WHERE id = $1',
    [id],
  );
  return rows[0]?.token_hash?.toString('hex') ?? null;
}

describe('moving as the owner (Historia 5)', () => {
  it('keeps its services, its total duration, its data and its link (escenario 1)', async () => {
    const id = await twoServiceBooking();
    const before = await repository.findById(id);
    const link = await tokenHashOf(id);

    const moved = await useCase.reschedule({ id, startsAt: friday('11:30') });

    expect(moved.ok).toBe(true);
    const after = await repository.findById(id);
    expect(after).toEqual({ ...before, startsAt: friday('11:30'), endsAt: friday('12:30') });
    expect(await tokenHashOf(id)).toBe(link);
    expect(moved.ok && moved.value.notifyCustomer).toEqual({ phone: '600112233' });
  });

  it('lasts the sum of its snapshots even after the catalogue changed or retired a service (BR-020)', async () => {
    const id = await twoServiceBooking();
    await testPool().query(
      `UPDATE service SET duration_minutes = 90 WHERE id = '00000000-0000-4000-8000-000000000011';
       UPDATE service SET is_active = false WHERE id = '00000000-0000-4000-8000-000000000012'`,
    );

    const moved = await useCase.reschedule({ id, startsAt: friday('15:00') });

    expect(moved.ok && moved.value.appointment.endsAt).toEqual(friday('16:00'));
  });

  it('names what is in the way of the new slot, but not the appointment itself', async () => {
    const id = await bookFriday('11:00', '11:30');
    const other = await bookFriday('11:45', '12:15', { name: 'Marta Ruiz', phone: '622334455', email: 'm@x.es' });

    const asked = await useCase.reschedule({ id, startsAt: friday('11:30') });

    expect(asked).toMatchObject({ ok: false, error: { kind: 'CONFLICT', conflicts: [{ id: other }] } });
  });

  it('moves into a period only once the period is resolved', async () => {
    const id = await bookFriday('11:00', '11:30');
    const period = await insertPeriod(friday('13:00'), friday('14:00'), 'Comida');

    const asked = await useCase.reschedule({ id, startsAt: friday('13:00') });
    if (asked.ok || asked.error.kind !== 'CONFLICT') throw new Error('expected a conflict');

    const moved = await useCase.reschedule({
      id,
      startsAt: friday('13:00'),
      stateToken: asked.error.stateToken,
      resolution: { shortenPeriods: [{ id: period, startsAt: friday('13:30'), endsAt: friday('14:00') }] },
    });

    expect(moved.ok).toBe(true);
    const { rows } = await testPool().query('SELECT starts_at FROM unavailable_period WHERE id = $1', [period]);
    expect((rows[0] as { starts_at: Date }).starts_at.getTime()).toBe(friday('13:30').epochMilliseconds);
  });

  it('refuses a cancelled one: cancelling is final (FR-042)', async () => {
    const id = await bookFriday('11:00', '11:30');
    await useCase.cancel(id);

    expect(await useCase.reschedule({ id, startsAt: friday('12:00') })).toEqual({
      ok: false,
      error: { kind: 'BLOCKED', reason: 'ALREADY_CANCELLED' },
    });
  });

  it('answers NOT_FOUND for an id that does not exist', async () => {
    expect(await useCase.reschedule({ id: '00000000-0000-4000-8000-0000000000ff', startsAt: friday('12:00') })).toEqual({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });
});

describe('nothing is moved into or out of the past (FR-030, BR-009, T099)', () => {
  it('refuses a destination already over', async () => {
    const id = await bookFriday('17:00', '17:30');
    clock.set(friday('12:00'));

    expect(await useCase.reschedule({ id, startsAt: friday('11:00') })).toEqual({
      ok: false,
      error: { kind: 'BLOCKED', reason: 'IN_THE_PAST' },
    });
  });

  it('refuses one already over', async () => {
    const id = await bookFriday('10:00', '10:30');
    clock.set(friday('11:00'));

    expect(await useCase.reschedule({ id, startsAt: friday('12:00') })).toEqual({
      ok: false,
      error: { kind: 'BLOCKED', reason: 'IN_THE_PAST' },
    });
  });

  it('moves one under way', async () => {
    const id = await bookFriday('11:00', '11:30');
    clock.set(friday('11:10'));

    expect((await useCase.reschedule({ id, startsAt: friday('11:15') })).ok).toBe(true);
  });
});
