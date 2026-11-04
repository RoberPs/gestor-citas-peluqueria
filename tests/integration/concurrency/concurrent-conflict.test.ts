import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, ensureSchema, testPool, truncateAll } from '../helpers/test-db';
import { confirmedCount, CORTE, friday, LUIS, ownerAppointments, seedSalon } from '../use-cases/_owner-fixtures';

/**
 * 002, T110: two confirmations that overlap, from two devices at once, over
 * separate connections of a real PostgreSQL. Exactly one wins; the other gets
 * the conflict recalculated on the state the first one left, never a stored
 * overlap (FR-038, SC-004, D-029).
 */

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

describe('two overlapping confirmations at once (escenario 5 de la Historia 6)', () => {
  it('applies exactly one and asks the other again, about the first', async () => {
    const first = ownerAppointments();
    const second = ownerAppointments();
    const marta = { name: 'Marta Ruiz', phone: '622 33 44 55', email: null };

    const results = await Promise.all([
      first.create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer: LUIS }),
      second.create({ serviceIds: [CORTE], startsAt: friday('16:15'), customer: marta }),
    ]);

    const won = results.filter((result) => result.ok);
    const asked = results.filter((result) => !result.ok);
    expect(won).toHaveLength(1);
    expect(asked).toHaveLength(1);

    const winner = won[0];
    const loser = asked[0];
    if (winner?.ok !== true || loser?.ok !== false) throw new Error('unreachable');
    expect(loser.error).toMatchObject({ kind: 'CONFLICT', conflicts: [{ id: winner.value.appointment.id }] });
    expect(await confirmedCount()).toBe(1);
  });

  it('never stores an overlap, however many race (BR-001)', async () => {
    const attempts = ['16:00', '16:15', '16:00', '16:15', '15:45'].map((time, index) =>
      ownerAppointments().create({
        serviceIds: [CORTE],
        startsAt: friday(time),
        customer: { name: `Cliente ${index}`, phone: `61100000${index}`, email: null },
      }),
    );
    await Promise.all(attempts);

    const { rows } = await testPool().query<{ count: string }>(
      `SELECT count(*) FROM appointment a JOIN appointment b ON a.id < b.id
        WHERE a.status = 'CONFIRMED' AND b.status = 'CONFIRMED'
          AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')`,
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});
