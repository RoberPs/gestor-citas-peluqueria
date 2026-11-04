import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, ensureSchema, testPool, truncateAll } from '../helpers/test-db';
import { bookFriday, clock, CORTE, friday, LUIS, ownerAppointments, seedSalon } from './_owner-fixtures';

/**
 * 002, T098: the owner cancels inside the deadline the client has, the
 * cancellation says it was her, and it is final (FR-040, FR-040a, FR-042).
 */

const useCase = ownerAppointments();

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

describe('cancelling as the owner (Historia 5)', () => {
  it('cancels an hour before, inside the client\'s 24 h deadline, as the owner (escenario 2)', async () => {
    const id = await bookFriday('12:00', '12:30');
    clock.set(friday('11:00'));

    const cancelled = await useCase.cancel(id);

    expect(cancelled).toMatchObject({
      ok: true,
      value: { appointment: { status: 'CANCELLED', cancelledBy: 'OWNER' }, notifyCustomer: { phone: '600112233' } },
    });
    const { rows } = await testPool().query('SELECT status, cancelled_by FROM appointment WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ status: 'CANCELLED', cancelled_by: 'OWNER' });
  });

  it('has nobody to call for one written by hand', async () => {
    const created = await useCase.create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer: LUIS });
    if (!created.ok) throw new Error(created.error.kind);

    expect(await useCase.cancel(created.value.appointment.id)).toMatchObject({ ok: true, value: { notifyCustomer: null } });
  });

  it('does not cancel twice, nor bring it back (FR-042, BR-008)', async () => {
    const id = await bookFriday('12:00', '12:30');
    await useCase.cancel(id);

    expect(await useCase.cancel(id)).toEqual({ ok: false, error: { kind: 'BLOCKED', reason: 'ALREADY_CANCELLED' } });
  });

  it('does not cancel one already over (FR-016)', async () => {
    const id = await bookFriday('10:00', '10:30');
    clock.set(friday('11:00'));

    expect(await useCase.cancel(id)).toEqual({ ok: false, error: { kind: 'BLOCKED', reason: 'IN_THE_PAST' } });
  });

  it('frees the slot at once (BR-005)', async () => {
    const id = await bookFriday('12:00', '12:30');
    await useCase.cancel(id);

    expect((await useCase.create({ serviceIds: [CORTE], startsAt: friday('12:00'), customer: LUIS })).ok).toBe(true);
  });
});
