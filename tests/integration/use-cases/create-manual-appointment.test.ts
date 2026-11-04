import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { closeTestDb, ensureSchema, testPool, truncateAll } from '../helpers/test-db';
import {
  BARBA,
  bookFriday,
  clock,
  CORTE,
  friday,
  insertPeriod,
  LUIS,
  ownerAppointments,
  RETIRADO,
  seedSalon,
} from './_owner-fixtures';

/**
 * 002, T086 and T087: writing an appointment by hand against a real
 * PostgreSQL (FR-024 to FR-031), and its origin surviving a move (FR-025).
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

async function storedRow(id: string) {
  const { rows } = await testPool().query<{
    origin: string;
    token_hash: Buffer | null;
    customer_email: string | null;
    ends_at: Date;
  }>('SELECT origin, token_hash, customer_email, ends_at FROM appointment WHERE id = $1', [id]);
  return rows[0];
}

describe('writing an appointment by hand (Historia 4)', () => {
  it('creates it without email, with no link and marked as the owner\'s (FR-024, FR-026)', async () => {
    const result = await useCase.create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer: LUIS });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appointment).toMatchObject({ origin: 'OWNER', status: 'CONFIRMED', customer: { email: null } });
    expect(result.value.notifyCustomer).toBeNull();
    expect(await storedRow(result.value.appointment.id)).toMatchObject({
      origin: 'OWNER',
      token_hash: null,
      customer_email: null,
    });
  });

  it.each([
    ['without a name', { ...LUIS, name: '  ' }, 'customer.name'],
    ['without a phone', { ...LUIS, phone: '' }, 'customer.phone'],
    ['with a malformed email', { ...LUIS, email: 'luis@' }, 'customer.email'],
  ])('refuses one %s, naming the field (FR-031)', async (_name, customer, field) => {
    const result = await useCase.create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer });

    expect(result).toMatchObject({ ok: false, error: { kind: 'INVALID_CONTACT', fields: [{ field }] } });
  });

  it('stores several services in catalogue order with their snapshots, lasting their sum (FR-027)', async () => {
    const result = await useCase.create({ serviceIds: [BARBA, CORTE], startsAt: friday('16:00'), customer: LUIS });
    if (!result.ok) throw new Error(result.error.kind);

    const { rows } = await testPool().query(
      `SELECT position, service_id, name, duration_minutes, price_cents
         FROM appointment_service WHERE appointment_id = $1 ORDER BY position`,
      [result.value.appointment.id],
    );
    expect(rows).toEqual([
      { position: 1, service_id: CORTE, name: 'Corte de pelo', duration_minutes: 30, price_cents: 1800 },
      { position: 2, service_id: BARBA, name: 'Diseño y corte de barba', duration_minutes: 30, price_cents: null },
    ]);
    expect((await storedRow(result.value.appointment.id))?.ends_at.getTime()).toBe(
      friday('17:00').epochMilliseconds,
    );
  });

  it.each([
    ['an empty selection', [], 'EMPTY'],
    ['a repeated service', [CORTE, CORTE], 'DUPLICATE'],
    ['a retired service', [RETIRADO], 'UNKNOWN_SERVICE'],
  ])('refuses %s (FR-024)', async (_name, serviceIds, kind) => {
    const result = await useCase.create({ serviceIds, startsAt: friday('16:00'), customer: LUIS });

    expect(result).toMatchObject({ ok: false, error: { kind: 'INVALID_SELECTION', error: { kind } } });
  });

  it('refuses the fourth future appointment of the same phone (FR-029)', async () => {
    for (const time of ['10:00', '11:00', '12:00']) {
      const created = await useCase.create({ serviceIds: [CORTE], startsAt: friday(time), customer: LUIS });
      expect(created.ok).toBe(true);
    }

    const fourth = await useCase.create({ serviceIds: [CORTE], startsAt: friday('13:00'), customer: LUIS });
    expect(fourth).toEqual({ ok: false, error: { kind: 'BLOCKED', reason: 'CONTACT_LIMIT_REACHED' } });
  });

  it('creates inside the minimum lead time without objection (escenario 3)', async () => {
    clock.set(friday('16:40'));

    expect((await useCase.create({ serviceIds: [CORTE], startsAt: friday('17:00'), customer: LUIS })).ok).toBe(true);
  });

  it('refuses a slot already over (FR-030)', async () => {
    clock.set(friday('17:00'));

    expect(await useCase.create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer: LUIS })).toEqual({
      ok: false,
      error: { kind: 'BLOCKED', reason: 'IN_THE_PAST' },
    });
  });

  it('warns outside the opening hours, and creates once acknowledged (escenario 4, FR-028)', async () => {
    const asked = await useCase.create({ serviceIds: [CORTE], startsAt: friday('20:30'), customer: LUIS });
    expect(asked).toMatchObject({
      ok: false,
      error: { kind: 'CONFLICT', conflicts: [], warnings: ['OUTSIDE_OPENING_HOURS'] },
    });

    const created = await useCase.create({
      serviceIds: [CORTE],
      startsAt: friday('20:30'),
      customer: LUIS,
      acknowledgedWarnings: ['OUTSIDE_OPENING_HOURS'],
    });
    expect(created.ok).toBe(true);
  });

  it('names what is in the way and touches nothing until it is resolved (FR-033, FR-036)', async () => {
    const ana = await bookFriday('15:45', '16:15');
    const period = await insertPeriod(friday('16:15'), friday('17:00'));

    const asked = await useCase.create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer: LUIS });
    expect(asked).toMatchObject({
      ok: false,
      error: { kind: 'CONFLICT', conflicts: [{ id: ana, customerName: 'Ana López' }, { id: period }] },
    });
    const { rows } = await testPool().query("SELECT count(*)::int AS n FROM appointment WHERE status = 'CONFIRMED'");
    expect(rows[0]).toEqual({ n: 1 });
  });
});

describe('the origin is permanent (FR-025, T087)', () => {
  it('keeps an appointment written by hand as the owner\'s after moving it', async () => {
    const created = await useCase.create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer: LUIS });
    if (!created.ok) throw new Error(created.error.kind);

    const moved = await useCase.reschedule({ id: created.value.appointment.id, startsAt: friday('18:00') });

    expect(moved).toMatchObject({ ok: true, value: { appointment: { origin: 'OWNER' } } });
    const stored = await createAppointmentRepository(testPool).findById(created.value.appointment.id);
    expect(stored?.origin).toBe('OWNER');
  });
});
