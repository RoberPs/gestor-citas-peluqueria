import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConfirmBooking } from '@/application/use-cases/confirm-booking';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { tokenGenerator } from '@/infrastructure/security/token';
import { closeTestDb, ensureSchema, testPool, truncateAppointments } from '../helpers/test-db';
import {
  seedContractDatabase,
  CORTE,
  COLOR,
  LAVADO,
} from '../../contract/helpers/seed-contract-db';

/**
 * FR-011, FR-012, FR-013 and BR-014 against a real database.
 *
 * The concurrency case is two genuine parallel confirmations, not a simulated
 * race: the guarantee being tested is a database constraint (D-002), and a
 * simulation would be testing the simulation.
 */

const PEINADO = '00000000-0000-4000-8000-000000000013';
/** Offered when the client looked, withdrawn before they confirmed (FR-015). */
const RETIRADO = '00000000-0000-4000-8000-000000000016';

/** Tuesday 2026-09-15, 10:00 in Madrid. */
const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');
const clock: Clock = { now: () => NOW };

/** Friday 2026-09-18 at 11:30, salon time. */
const FRIDAY_1130 = '2026-09-18T09:30:00Z';

function contactOf(phone = '600112233', email = 'ana@example.com') {
  return { name: 'Ana López', phone, email };
}

function buildUseCase() {
  return createConfirmBooking({
    config: createSalonConfigRepository(() => testPool()),
    appointments: createAppointmentRepository(() => testPool()),
    periods: createUnavailablePeriodRepository(() => testPool()),
    tokens: tokenGenerator,
    clock,
  });
}

let confirmBooking: ReturnType<typeof buildUseCase>;

beforeAll(async () => {
  await ensureSchema();
  await seedContractDatabase();
  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Peinado', 45, 2500, true, 3), ($2, 'Retirado', 30, 1000, true, 6)`,
    [PEINADO, RETIRADO],
  );
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  confirmBooking = buildUseCase();
});

describe('a booking that goes through', () => {
  it('stores the appointment and hands back the token exactly once', async () => {
    const result = await confirmBooking({
      serviceIds: [CORTE],
      startsAt: FRIDAY_1130,
      contact: contactOf(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.value.appointment.status).toBe('CONFIRMED');
    expect(result.value.appointment.services[0].name).toBe('Corte');
  });

  it('freezes the service into the appointment (FR-016, D-011)', async () => {
    const result = await confirmBooking({
      serviceIds: [COLOR],
      startsAt: FRIDAY_1130,
      contact: contactOf(),
    });

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.appointment.services).toEqual([
      {
        serviceId: COLOR,
        name: 'Color',
        durationMinutes: 90,
        priceCents: 5500,
      },
    ]);
    // The end comes from the snapshot duration, not from the request.
    expect(
      result.value.appointment.endsAt.since(result.value.appointment.startsAt).total('minutes'),
    ).toBe(90);
  });

  it('stores only the hash of the token, never the token itself (D-005)', async () => {
    const result = await confirmBooking({
      serviceIds: [CORTE],
      startsAt: FRIDAY_1130,
      contact: contactOf(),
    });
    if (!result.ok) throw new Error('unreachable');

    const { rows } = await testPool().query<{ token_hash: Buffer }>(
      'SELECT token_hash FROM appointment',
    );

    expect(rows[0]?.token_hash).toHaveLength(32);
    expect(rows[0]?.token_hash.toString('utf8')).not.toContain(result.value.token);
  });
});

describe('revalidation at the moment of confirming (FR-011)', () => {
  it('rejects a slot that was taken while the form was being filled in', async () => {
    await confirmBooking({ serviceIds: [CORTE], startsAt: FRIDAY_1130, contact: contactOf() });

    const second = await confirmBooking({
      serviceIds: [CORTE],
      startsAt: FRIDAY_1130,
      contact: contactOf('700112233', 'otro@example.com'),
    });

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error).toEqual({ kind: 'REJECTED', rejection: { kind: 'SLOT_TAKEN' } });
  });

  it('rejects a start that has fallen inside the two hour lead time', async () => {
    const result = await confirmBooking({
      serviceIds: [CORTE],
      // 11:00 Madrid today, with the clock at 10:00.
      startsAt: '2026-09-15T09:00:00Z',
      contact: contactOf(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('REJECTED');
    if (result.error.kind !== 'REJECTED') throw new Error('unreachable');
    expect(result.error.rejection.kind).toBe('TOO_LATE_TO_BOOK');
  });

  it('rejects a start the salon is not open for, however it was reached', async () => {
    const result = await confirmBooking({
      serviceIds: [CORTE],
      // Sunday, which the seed leaves without opening stretches.
      startsAt: '2026-09-20T09:30:00Z',
      contact: contactOf(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('REJECTED');
  });

  it('rejects an unknown service', async () => {
    const result = await confirmBooking({
      serviceIds: [randomUUID()],
      startsAt: FRIDAY_1130,
      contact: contactOf(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('SERVICE_UNAVAILABLE');
  });

  it('rejects contact data the interface should have caught (FR-034)', async () => {
    const result = await confirmBooking({
      serviceIds: [CORTE],
      startsAt: FRIDAY_1130,
      contact: contactOf('12345', 'not-an-email'),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('REJECTED');
    if (result.error.kind !== 'REJECTED') throw new Error('unreachable');
    expect(result.error.rejection.kind).toBe('INVALID_CONTACT');
  });
});

describe('three confirmed future appointments per contact (BR-014, FR-013)', () => {
  const slots = [
    '2026-09-18T08:00:00Z',
    '2026-09-18T09:00:00Z',
    '2026-09-18T10:00:00Z',
    '2026-09-18T11:00:00Z',
  ];

  async function bookAt(index: number, phone: string, email: string) {
    const startsAt = slots[index];
    if (startsAt === undefined) throw new Error('no such slot in the fixture');
    return confirmBooking({ serviceIds: [CORTE], startsAt, contact: contactOf(phone, email) });
  }

  it('rejects the fourth appointment of the same phone', async () => {
    for (let i = 0; i < 3; i += 1) {
      const result = await bookAt(i, '600112233', `ana${i}@example.com`);
      expect(result.ok).toBe(true);
    }

    const fourth = await bookAt(3, '600112233', 'ana3@example.com');

    expect(fourth.ok).toBe(false);
    if (fourth.ok) throw new Error('unreachable');
    expect(fourth.error).toEqual({ kind: 'CONTACT_LIMIT_REACHED', limit: 3 });
  });

  it('rejects the fourth appointment of the same email', async () => {
    for (let i = 0; i < 3; i += 1) {
      const result = await bookAt(i, `60011223${i}`, 'ana@example.com');
      expect(result.ok).toBe(true);
    }

    const fourth = await bookAt(3, '600112239', 'ana@example.com');

    expect(fourth.ok).toBe(false);
    if (fourth.ok) throw new Error('unreachable');
    expect(fourth.error).toEqual({ kind: 'CONTACT_LIMIT_REACHED', limit: 3 });
  });

  it('accepts two by phone plus two by email: neither contact reaches the limit', async () => {
    // Two on this phone with other emails…
    expect((await bookAt(0, '600112233', 'otro1@example.com')).ok).toBe(true);
    expect((await bookAt(1, '600112233', 'otro2@example.com')).ok).toBe(true);
    // …and two on this email with other phones.
    expect((await bookAt(2, '700112231', 'ana@example.com')).ok).toBe(true);

    const fourth = await bookAt(3, '700112232', 'ana@example.com');

    // The union is four, but the rule counts each contact separately: a
    // `phone = $1 OR email = $2` count would wrongly reject this.
    expect(fourth.ok).toBe(true);
  });

  it('does not count cancelled or past appointments towards the limit', async () => {
    await testPool().query(
      `WITH inserted AS (
         INSERT INTO appointment (
           id, status, starts_at, ends_at,
           customer_name, customer_phone, customer_email,
           customer_phone_normalized, customer_email_normalized, token_hash,
           created_at, cancelled_at
         )
         SELECT gen_random_uuid(), 'CANCELLED',
                timestamptz '2026-09-25 10:00+02' + (n * interval '2 hours'),
                timestamptz '2026-09-25 10:30+02' + (n * interval '2 hours'),
                'Ana', '600112233', 'ana@example.com',
                '+34600112233', 'ana@example.com',
                decode(md5(n::text), 'hex') || decode(md5(n::text), 'hex'),
                now(), now()
           FROM generate_series(1, 5) AS n
         RETURNING id
       )
       INSERT INTO appointment_service
         (appointment_id, position, service_id, name, duration_minutes, price_cents)
       SELECT id, 1, $1, 'Corte', 30, 1800 FROM inserted`,
      [CORTE],
    );

    expect((await bookAt(0, '600112233', 'ana@example.com')).ok).toBe(true);
  });
});

describe('two simultaneous confirmations on the same slot (FR-012)', () => {
  it('lets exactly one through and tells the other the slot is taken', async () => {
    const [first, second] = await Promise.all([
      confirmBooking({
        serviceIds: [CORTE],
        startsAt: FRIDAY_1130,
        contact: contactOf('600112233', 'ana@example.com'),
      }),
      confirmBooking({
        serviceIds: [CORTE],
        startsAt: FRIDAY_1130,
        contact: contactOf('700112233', 'otro@example.com'),
      }),
    ]);

    const succeeded = [first, second].filter((result) => result.ok);
    const failed = [first, second].filter((result) => !result.ok);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const { rows } = await testPool().query<{ count: string }>(
      "SELECT count(*) AS count FROM appointment WHERE status = 'CONFIRMED'",
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('lets both through when the slots only touch (BR-013)', async () => {
    const [first, second] = await Promise.all([
      confirmBooking({
        serviceIds: [CORTE],
        startsAt: '2026-09-18T08:00:00Z',
        contact: contactOf('600112233', 'ana@example.com'),
      }),
      confirmBooking({
        serviceIds: [CORTE],
        startsAt: '2026-09-18T08:30:00Z',
        contact: contactOf('700112233', 'otro@example.com'),
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});

describe('several services in one appointment (005, Historia 1)', () => {
  it('creates one appointment with a row per service, as long as their sum (FR-007, FR-012)', async () => {
    const result = await confirmBooking({
      serviceIds: [PEINADO, CORTE],
      startsAt: FRIDAY_1130,
      contact: contactOf(),
    });

    if (!result.ok) throw new Error('unreachable');
    const { appointment } = result.value;
    expect(appointment.services.map((service) => service.serviceId)).toEqual([CORTE, PEINADO]);
    expect(appointment.endsAt.since(appointment.startsAt).total('minutes')).toBe(75);

    const { rows } = await testPool().query<{ appointments: string; services: string }>(
      `SELECT (SELECT count(*) FROM appointment) AS appointments,
              (SELECT count(*) FROM appointment_service) AS services`,
    );
    expect(Number(rows[0]?.appointments)).toBe(1);
    expect(Number(rows[0]?.services)).toBe(2);
  });

  it('refuses a service withdrawn since the client looked, naming it, and writes nothing (FR-015)', async () => {
    // The client saw it offered; it is withdrawn before they confirm. Every
    // confirmation reads the catalogue afresh, so a new use case sees it gone.
    await testPool().query('UPDATE service SET is_active = false WHERE id = $1', [RETIRADO]);

    const result = await buildUseCase()({
      serviceIds: [CORTE, RETIRADO],
      startsAt: FRIDAY_1130,
      contact: contactOf(),
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'SERVICE_UNAVAILABLE', serviceIds: [RETIRADO] },
    });
    const { rows } = await testPool().query<{ count: string }>(
      'SELECT count(*) AS count FROM appointment',
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('lets exactly one of two overlapping confirmations through, when they overlap only in part (FR-016)', async () => {
    // Color from 10:00 to 11:30 and Corte from 11:00 to 11:30: they share half an hour.
    const [long, short] = await Promise.all([
      confirmBooking({
        serviceIds: [COLOR],
        startsAt: '2026-09-18T08:00:00Z',
        contact: contactOf('600112233', 'ana@example.com'),
      }),
      confirmBooking({
        serviceIds: [CORTE],
        startsAt: '2026-09-18T09:00:00Z',
        contact: contactOf('700112233', 'otro@example.com'),
      }),
    ]);

    expect([long, short].filter((result) => result.ok)).toHaveLength(1);
    const failed = [long, short].find((result) => !result.ok);
    expect(failed).toEqual({
      ok: false,
      error: { kind: 'REJECTED', rejection: { kind: 'SLOT_TAKEN' } },
    });
  });

  it('counts appointments, not services, towards the limit of three (BR-014)', async () => {
    const four = await confirmBooking({
      serviceIds: [CORTE, COLOR, PEINADO, LAVADO],
      startsAt: '2026-09-18T08:00:00Z',
      contact: contactOf(),
    });
    expect(four.ok).toBe(true);

    // A four service appointment is one: two more still fit under the limit.
    for (const startsAt of ['2026-09-18T12:00:00Z', '2026-09-18T13:00:00Z']) {
      const next = await confirmBooking({ serviceIds: [CORTE], startsAt, contact: contactOf() });
      expect(next.ok).toBe(true);
    }

    const fourth = await confirmBooking({
      serviceIds: [CORTE],
      startsAt: '2026-09-18T14:00:00Z',
      contact: contactOf(),
    });
    expect(fourth).toEqual({ ok: false, error: { kind: 'CONTACT_LIMIT_REACHED', limit: 3 } });
  });
});
