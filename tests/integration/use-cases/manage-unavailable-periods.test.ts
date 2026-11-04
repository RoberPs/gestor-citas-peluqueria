import { randomBytes, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createManageUnavailablePeriods } from '@/application/use-cases/manage-unavailable-periods';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createOwnerAppointmentWriter } from '@/infrastructure/db/owner-appointment-writer';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { stateHash } from '@/infrastructure/security/state-hash';
import { closeTestDb, ensureSchema, insertAppointmentRow, testPool, truncateAll } from '../helpers/test-db';

/**
 * 002, T072 and T075: blocking, shortening and releasing time against a real
 * PostgreSQL (FR-018, FR-019, FR-022, FR-023), and the warning when a block
 * lands on confirmed appointments — which it lists and never cancels.
 */

const CORTE = '00000000-0000-4000-8000-000000000011';

/** Tuesday 2026-09-15, 10:00 in Madrid. */
const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');
const clock: Clock = { now: () => NOW };

/** Friday 2026-09-18 in Madrid, summer time. */
function friday(time: string): Temporal.Instant {
  return Temporal.Instant.from(`2026-09-18T${time}:00+02:00`);
}

const useCase = createManageUnavailablePeriods({
  config: createSalonConfigRepository(testPool),
  appointments: createAppointmentRepository(testPool),
  periods: createUnavailablePeriodRepository(testPool),
  writer: createOwnerAppointmentWriter(testPool),
  stateHash,
  clock,
});

async function seedSalon(): Promise<void> {
  await testPool().query(
    `INSERT INTO salon (id, name, address, phone, timezone)
     VALUES ($1, 'Peluqueria Aurora', 'Calle Mayor 14', '911234567', 'Europe/Madrid')`,
    [randomUUID()],
  );
  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Corte', 30, 1800, true, 1)`,
    [CORTE],
  );
}

async function bookFriday(from: string, to: string, name = 'Ana López'): Promise<string> {
  const id = randomUUID();
  await insertAppointmentRow(
    {
      id,
      status: 'CONFIRMED',
      starts_at: `2026-09-18 ${from}+02`,
      ends_at: `2026-09-18 ${to}+02`,
      customer_name: name,
      customer_phone: '600112233',
      customer_email: 'ana@example.com',
      customer_phone_normalized: '+34600112233',
      customer_email_normalized: 'ana@example.com',
      token_hash: randomBytes(32),
    },
    { serviceId: CORTE, name: 'Corte', durationMinutes: 30, priceCents: 1800 },
  );
  return id;
}

async function storedPeriods(): Promise<number> {
  const { rows } = await testPool().query<{ count: string }>('SELECT count(*) FROM unavailable_period');
  return Number(rows[0]?.count);
}

const LUNCH = { startsAt: friday('13:00'), endsAt: friday('14:00'), reason: 'Comida' };

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

describe('blocking, shortening and releasing time (FR-018, FR-019)', () => {
  it('blocks a lunch hour and lists it with its reason', async () => {
    const created = await useCase.create(LUNCH);
    if (!created.ok) throw new Error(`rejected: ${JSON.stringify(created.error)}`);

    const listed = await useCase.list({ from: friday('00:00'), to: friday('23:45') });

    if (!listed.ok) throw new Error('unreachable');
    expect(listed.value.timezone).toBe('Europe/Madrid');
    expect(listed.value.periods).toEqual([
      { id: created.value.period.id, startsAt: friday('13:00'), endsAt: friday('14:00'), reason: 'Comida' },
    ]);
  });

  it('keeps a blank reason as none', async () => {
    const created = await useCase.create({ ...LUNCH, reason: '   ' });

    expect(created.ok && created.value.period.reason).toBeNull();
  });

  it('shortens a period, which stays the same period', async () => {
    const created = await useCase.create(LUNCH);
    if (!created.ok) throw new Error('unreachable');

    const shortened = await useCase.shorten({
      id: created.value.period.id,
      startsAt: friday('13:00'),
      endsAt: friday('13:30'),
    });

    expect(shortened).toMatchObject({
      ok: true,
      value: { period: { id: created.value.period.id, endsAt: friday('13:30'), reason: 'Comida' } },
    });
  });

  it('refuses to lengthen a period through shortening', async () => {
    const created = await useCase.create(LUNCH);
    if (!created.ok) throw new Error('unreachable');

    const result = await useCase.shorten({ id: created.value.period.id, startsAt: friday('12:00'), endsAt: friday('14:00') });

    expect(result).toEqual({ ok: false, error: { kind: 'INVALID', reason: 'NOT_CONTAINED' } });
  });

  it('releases a period', async () => {
    const created = await useCase.create(LUNCH);
    if (!created.ok) throw new Error('unreachable');

    expect(await useCase.remove(created.value.period.id)).toEqual({ ok: true, value: null });
    expect(await storedPeriods()).toBe(0);
  });

  it('says a period that does not exist is not found', async () => {
    const missing = randomUUID();

    expect(await useCase.remove(missing)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await useCase.shorten({ id: missing, startsAt: friday('13:00'), endsAt: friday('13:30') })).toEqual({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });

  it.each([
    ['an end that does not follow the start (FR-023)', { startsAt: friday('14:00'), endsAt: friday('13:00') }, 'END_NOT_AFTER_START'],
    ['a start off the 15 minute grid (FR-018)', { startsAt: friday('13:10'), endsAt: friday('14:00') }, 'INVALID_GRANULARITY'],
    [
      'a period that is already over (BR-009)',
      { startsAt: Temporal.Instant.from('2026-09-14T11:00:00Z'), endsAt: Temporal.Instant.from('2026-09-14T12:00:00Z') },
      'ALREADY_OVER',
    ],
  ])('rejects %s and stores nothing', async (_name, span, reason) => {
    const result = await useCase.create({ ...span, reason: null });

    expect(result).toEqual({ ok: false, error: { kind: 'INVALID', reason } });
    expect(await storedPeriods()).toBe(0);
  });
});

describe('blocking time over confirmed appointments (FR-022, T075)', () => {
  it('lists an appointment that overlaps by one minute and stores nothing yet', async () => {
    const id = await bookFriday('12:31', '13:01');

    const result = await useCase.create(LUNCH);

    if (result.ok || result.error.kind !== 'CONFLICT') throw new Error('expected a conflict');
    expect(result.error.conflicts).toEqual([
      {
        kind: 'APPOINTMENT',
        id,
        customerName: 'Ana López',
        serviceNames: ['Corte'],
        startsAt: friday('12:31'),
        endsAt: friday('13:01'),
      },
    ]);
    expect(result.error.stateToken).not.toBe('');
    expect(await storedPeriods()).toBe(0);
  });

  it('blocks once the owner acknowledges it, and cancels nobody', async () => {
    const id = await bookFriday('13:00', '13:30');
    const first = await useCase.create(LUNCH);
    if (first.ok || first.error.kind !== 'CONFLICT') throw new Error('expected a conflict');

    const second = await useCase.create({
      ...LUNCH,
      stateToken: first.error.stateToken,
      acknowledgeAppointments: [id],
    });

    expect(second.ok).toBe(true);
    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment WHERE id = $1', [id]);
    expect(rows[0]?.status).toBe('CONFIRMED');
    expect(await storedPeriods()).toBe(1);
  });

  it('asks again when an acknowledgement leaves one out', async () => {
    const id = await bookFriday('13:00', '13:30');
    await bookFriday('13:30', '14:00', 'Luis Pérez');
    const first = await useCase.create(LUNCH);
    if (first.ok || first.error.kind !== 'CONFLICT') throw new Error('expected a conflict');

    const second = await useCase.create({ ...LUNCH, stateToken: first.error.stateToken, acknowledgeAppointments: [id] });

    expect(second).toMatchObject({ ok: false, error: { kind: 'CONFLICT', stateToken: first.error.stateToken } });
    expect(await storedPeriods()).toBe(0);
  });

  it('recalculates the warning when what was in the way changed meanwhile (FR-038)', async () => {
    const id = await bookFriday('13:00', '13:30');
    const first = await useCase.create(LUNCH);
    if (first.ok || first.error.kind !== 'CONFLICT') throw new Error('expected a conflict');
    const newcomer = await bookFriday('13:30', '14:00', 'Luis Pérez');

    const second = await useCase.create({ ...LUNCH, stateToken: first.error.stateToken, acknowledgeAppointments: [id] });

    if (second.ok || second.error.kind !== 'CONFLICT') throw new Error('expected a conflict');
    expect(second.error.conflicts.map((conflict) => conflict.id)).toEqual([id, newcomer]);
    expect(second.error.stateToken).not.toBe(first.error.stateToken);
    expect(await storedPeriods()).toBe(0);
  });

  it('ignores cancelled appointments', async () => {
    const id = await bookFriday('13:00', '13:30');
    await testPool().query(
      "UPDATE appointment SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'CUSTOMER' WHERE id = $1",
      [id],
    );

    expect((await useCase.create(LUNCH)).ok).toBe(true);
  });
});

describe('blocking and cancelling in one operation (FR-022, FR-037, T116)', () => {
  it('cancels the appointment under the block, as the owner, in the same transaction', async () => {
    const id = await bookFriday('13:30', '14:00');
    const warned = await useCase.create(LUNCH);
    if (warned.ok || warned.error.kind !== 'CONFLICT') throw new Error('expected the warning');

    const saved = await useCase.create({ ...LUNCH, stateToken: warned.error.stateToken, cancelAppointments: [id] });

    expect(saved.ok).toBe(true);
    const { rows } = await testPool().query('SELECT status, cancelled_by FROM appointment WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ status: 'CANCELLED', cancelled_by: 'OWNER' });
    expect(await storedPeriods()).toBe(1);
  });

  it('asks again while an appointment is neither acknowledged nor cancelled', async () => {
    await bookFriday('13:00', '13:30');
    const second = await bookFriday('13:30', '14:00', 'Marta Ruiz');
    const warned = await useCase.create(LUNCH);
    if (warned.ok || warned.error.kind !== 'CONFLICT') throw new Error('expected the warning');

    const again = await useCase.create({ ...LUNCH, stateToken: warned.error.stateToken, cancelAppointments: [second] });

    expect(again).toMatchObject({ ok: false, error: { kind: 'CONFLICT' } });
    expect(await storedPeriods()).toBe(0);
  });
});
