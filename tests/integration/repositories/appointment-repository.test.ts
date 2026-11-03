import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { NewAppointment } from '@/application/ports';
import { validateContact } from '@/domain/contact/contact';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { generate } from '@/infrastructure/security/token';
import { closeTestDb, ensureSchema, testPool, truncateAll } from '../helpers/test-db';

const SERVICE_ID = '00000000-0000-4000-8000-000000000011';
const PEINADO_ID = '00000000-0000-4000-8000-000000000013';

const CORTE_SNAPSHOT = { serviceId: SERVICE_ID, name: 'Corte', durationMinutes: 30, priceCents: 1800 };
const PEINADO_SNAPSHOT = {
  serviceId: PEINADO_ID,
  name: 'Peinado',
  durationMinutes: 45,
  priceCents: null,
};
const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');

function contact(phone = '600112233', email = 'ana@example.com') {
  const validated = validateContact({ name: 'Ana', phone, email });
  if (!validated.ok) throw new Error('fixture contact is invalid');
  return validated.value;
}

function newAppointment(overrides: Partial<NewAppointment> = {}): NewAppointment {
  const startsAt = overrides.startsAt ?? Temporal.Instant.from('2026-09-18T08:00:00Z');
  return {
    id: randomUUID(),
    startsAt,
    endsAt: overrides.endsAt ?? startsAt.add({ minutes: 30 }),
    services: [CORTE_SNAPSHOT],
    contact: overrides.contact ?? contact(),
    tokenHash: overrides.tokenHash ?? generate().hash,
    createdAt: overrides.createdAt ?? NOW,
    ...overrides,
  };
}

const repo = createAppointmentRepository(() => testPool());

/** Records the SQL that reaches the pool, so a second round trip cannot hide. */
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

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll();
  await testPool().query(
    `INSERT INTO salon (id, name, address, phone, timezone)
     VALUES ($1, 'Peluqueria Aurora', 'Calle Mayor 14', '911234567', 'Europe/Madrid')`,
    [randomUUID()],
  );
  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Corte', 30, 1800, true, 1)`,
    [SERVICE_ID],
  );
});

/** A second service, with no price, for the appointments of more than one. */
async function addPeinado(): Promise<void> {
  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Peinado', 45, NULL, true, 3)`,
    [PEINADO_ID],
  );
}

describe('insert', () => {
  it('stores the appointment and returns it as a domain object', async () => {
    const created = await repo.insert(newAppointment());

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');
    expect(created.value.status).toBe('CONFIRMED');
    expect(created.value.services).toEqual([
      {
        serviceId: SERVICE_ID,
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 1800,
      },
    ]);
    expect(created.value.customer).toEqual({
      name: 'Ana',
      phone: '600112233',
      email: 'ana@example.com',
    });
    expect(created.value.cancelledAt).toBeNull();
    expect(created.value.anonymizedAt).toBeNull();
  });

  it('stores the canonical phone and email alongside what the client typed', async () => {
    await repo.insert(newAppointment({ contact: contact('+34 600 11 22 33', 'Ana@Example.COM') }));

    const { rows } = await testPool().query<{
      customer_phone: string;
      customer_phone_normalized: string;
      customer_email: string;
      customer_email_normalized: string;
    }>(
      `SELECT customer_phone, customer_phone_normalized,
              customer_email, customer_email_normalized FROM appointment`,
    );

    expect(rows[0]?.customer_phone).toBe('+34 600 11 22 33');
    expect(rows[0]?.customer_phone_normalized).toBe('+34600112233');
    expect(rows[0]?.customer_email).toBe('Ana@Example.COM');
    expect(rows[0]?.customer_email_normalized).toBe('ana@example.com');
  });

  it('translates the 23P01 exclusion violation into SLOT_TAKEN (FR-012)', async () => {
    const start = Temporal.Instant.from('2026-09-18T08:00:00Z');
    await repo.insert(newAppointment({ startsAt: start, endsAt: start.add({ minutes: 90 }) }));

    const second = await repo.insert(
      newAppointment({ startsAt: start.add({ minutes: 30 }), endsAt: start.add({ minutes: 60 }) }),
    );

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error).toBe('SLOT_TAKEN');
  });

  it('stores one row per service, in the order it was given (005, D-001)', async () => {
    await addPeinado();
    const start = Temporal.Instant.from('2026-09-18T08:00:00Z');
    const created = await repo.insert(
      newAppointment({
        startsAt: start,
        endsAt: start.add({ minutes: 75 }),
        services: [CORTE_SNAPSHOT, PEINADO_SNAPSHOT],
      }),
    );
    if (!created.ok) throw new Error('unreachable');

    const { rows } = await testPool().query<{
      position: number;
      service_id: string;
      price_cents: number | null;
    }>(
      `SELECT position, service_id, price_cents FROM appointment_service
        WHERE appointment_id = $1 ORDER BY position`,
      [created.value.id],
    );

    expect(rows).toEqual([
      { position: 1, service_id: SERVICE_ID, price_cents: 1800 },
      { position: 2, service_id: PEINADO_ID, price_cents: null },
    ]);
    expect(created.value.services).toEqual([CORTE_SNAPSHOT, PEINADO_SNAPSHOT]);
  });

  it('leaves no service row behind when the exclusion constraint refuses the appointment (D-011)', async () => {
    await addPeinado();
    const start = Temporal.Instant.from('2026-09-18T08:00:00Z');
    await repo.insert(newAppointment({ startsAt: start, endsAt: start.add({ minutes: 30 }) }));

    const refused = await repo.insert(
      newAppointment({
        startsAt: start,
        endsAt: start.add({ minutes: 75 }),
        services: [CORTE_SNAPSHOT, PEINADO_SNAPSHOT],
      }),
    );

    expect(refused.ok).toBe(false);
    const { rows } = await testPool().query<{ count: string }>(
      'SELECT count(*) AS count FROM appointment_service',
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('accepts an appointment starting exactly when the previous ends (BR-013)', async () => {
    const start = Temporal.Instant.from('2026-09-18T08:00:00Z');
    await repo.insert(newAppointment({ startsAt: start, endsAt: start.add({ minutes: 90 }) }));

    const second = await repo.insert(
      newAppointment({ startsAt: start.add({ minutes: 90 }), endsAt: start.add({ minutes: 120 }) }),
    );

    expect(second.ok).toBe(true);
  });
});

describe('findByTokenHash', () => {
  it('resolves an appointment by the hash of its token', async () => {
    const { token, hash } = generate();
    const created = await repo.insert(newAppointment({ tokenHash: hash }));
    if (!created.ok) throw new Error('unreachable');

    const found = await repo.findByTokenHash(hash);

    expect(found?.id).toBe(created.value.id);
    expect(token).toHaveLength(43);
  });

  it('reads the appointment and its services in order, in one query (D-011)', async () => {
    await addPeinado();
    const { hash } = generate();
    const start = Temporal.Instant.from('2026-09-18T08:00:00Z');
    await repo.insert(
      newAppointment({
        startsAt: start,
        endsAt: start.add({ minutes: 75 }),
        services: [CORTE_SNAPSHOT, PEINADO_SNAPSHOT],
        tokenHash: hash,
      }),
    );

    const spy = spyingPool(testPool());
    const found = await createAppointmentRepository(() => spy.pool).findByTokenHash(hash);

    expect(found?.services).toEqual([CORTE_SNAPSHOT, PEINADO_SNAPSHOT]);
    expect(spy.statements).toHaveLength(1);
  });

  it('returns null for a hash that matches nothing', async () => {
    await repo.insert(newAppointment());

    expect(await repo.findByTokenHash(generate().hash)).toBeNull();
  });

  it('returns null once the appointment has been anonymised: the link dies with it', async () => {
    const { hash } = generate();
    await repo.insert(newAppointment({ tokenHash: hash }));

    await testPool().query(
      `UPDATE appointment
          SET customer_name = NULL, customer_phone = NULL, customer_email = NULL,
              customer_phone_normalized = NULL, customer_email_normalized = NULL,
              token_hash = NULL, anonymized_at = now()`,
    );

    expect(await repo.findByTokenHash(hash)).toBeNull();
  });
});

describe('findConfirmedInWindow', () => {
  it('returns only the confirmed appointments inside the window', async () => {
    const inside = Temporal.Instant.from('2026-09-18T08:00:00Z');
    const outside = Temporal.Instant.from('2026-12-18T08:00:00Z');

    await repo.insert(newAppointment({ startsAt: inside, endsAt: inside.add({ minutes: 30 }) }));
    await repo.insert(newAppointment({ startsAt: outside, endsAt: outside.add({ minutes: 30 }) }));

    const busy = await repo.findConfirmedInWindow(
      Temporal.Instant.from('2026-09-15T00:00:00Z'),
      Temporal.Instant.from('2026-11-14T00:00:00Z'),
    );

    expect(busy).toHaveLength(1);
    expect(busy[0]?.startsAt.equals(inside)).toBe(true);
    expect(busy[0]?.endsAt.equals(inside.add({ minutes: 30 }))).toBe(true);
  });

  it('leaves out cancelled appointments: the slot is free again (BR-005)', async () => {
    const start = Temporal.Instant.from('2026-09-18T08:00:00Z');
    const created = await repo.insert(
      newAppointment({ startsAt: start, endsAt: start.add({ minutes: 30 }) }),
    );
    if (!created.ok) throw new Error('unreachable');

    await repo.cancel(created.value.id, NOW);

    const busy = await repo.findConfirmedInWindow(
      Temporal.Instant.from('2026-09-15T00:00:00Z'),
      Temporal.Instant.from('2026-11-14T00:00:00Z'),
    );

    expect(busy).toHaveLength(0);
  });
});

describe('countFutureByContact (BR-014)', () => {
  it('counts the phone and the email separately, not their union', async () => {
    const base = Temporal.Instant.from('2026-09-18T08:00:00Z');

    // Two on this phone with one email, two on another phone with this email.
    for (let i = 0; i < 2; i += 1) {
      const start = base.add({ hours: i * 2 });
      await repo.insert(
        newAppointment({
          startsAt: start,
          endsAt: start.add({ minutes: 30 }),
          contact: contact('600112233', 'otro@example.com'),
        }),
      );
    }
    for (let i = 0; i < 2; i += 1) {
      const start = base.add({ hours: 24 + i * 2 });
      await repo.insert(
        newAppointment({
          startsAt: start,
          endsAt: start.add({ minutes: 30 }),
          contact: contact('700112233', 'ana@example.com'),
        }),
      );
    }

    const counts = await repo.countFutureByContact(
      contact('600112233', 'ana@example.com').normalizedPhone,
      contact('600112233', 'ana@example.com').normalizedEmail,
      NOW,
    );

    // Neither reaches the limit on its own, even though the union is four.
    expect(counts).toEqual({ byPhone: 2, byEmail: 2 });
  });

  it('matches the canonical phone form, so a prefix does not dodge the limit', async () => {
    const start = Temporal.Instant.from('2026-09-18T08:00:00Z');
    await repo.insert(
      newAppointment({
        startsAt: start,
        endsAt: start.add({ minutes: 30 }),
        contact: contact('600 11 22 33', 'ana@example.com'),
      }),
    );

    const counts = await repo.countFutureByContact(
      contact('+34600112233', 'ana@example.com').normalizedPhone,
      contact('+34600112233', 'ANA@example.com').normalizedEmail,
      NOW,
    );

    expect(counts.byPhone).toBe(1);
    expect(counts.byEmail).toBe(1);
  });

  it('ignores past and cancelled appointments', async () => {
    const past = Temporal.Instant.from('2026-09-01T08:00:00Z');
    const future = Temporal.Instant.from('2026-09-18T08:00:00Z');

    await repo.insert(newAppointment({ startsAt: past, endsAt: past.add({ minutes: 30 }) }));
    const cancelled = await repo.insert(
      newAppointment({ startsAt: future, endsAt: future.add({ minutes: 30 }) }),
    );
    if (!cancelled.ok) throw new Error('unreachable');
    await repo.cancel(cancelled.value.id, NOW);

    const counts = await repo.countFutureByContact(
      contact().normalizedPhone,
      contact().normalizedEmail,
      NOW,
    );

    expect(counts).toEqual({ byPhone: 0, byEmail: 0 });
  });
});

describe('updateSchedule (FR-025, BR-006)', () => {
  it('moves the appointment keeping its id and its token', async () => {
    const { hash } = generate();
    const start = Temporal.Instant.from('2026-09-18T08:00:00Z');
    const created = await repo.insert(
      newAppointment({ startsAt: start, endsAt: start.add({ minutes: 30 }), tokenHash: hash }),
    );
    if (!created.ok) throw new Error('unreachable');

    const newStart = Temporal.Instant.from('2026-09-19T08:00:00Z');
    const moved = await repo.updateSchedule(created.value.id, newStart, newStart.add({ minutes: 30 }));

    expect(moved.ok).toBe(true);
    if (!moved.ok) throw new Error('unreachable');
    expect(moved.value.id).toBe(created.value.id);
    expect(moved.value.startsAt.equals(newStart)).toBe(true);
    expect((await repo.findByTokenHash(hash))?.startsAt.equals(newStart)).toBe(true);
  });

  it('leaves the original untouched when the new slot is taken', async () => {
    const mine = Temporal.Instant.from('2026-09-18T08:00:00Z');
    const theirs = Temporal.Instant.from('2026-09-19T08:00:00Z');

    const created = await repo.insert(
      newAppointment({ startsAt: mine, endsAt: mine.add({ minutes: 30 }) }),
    );
    if (!created.ok) throw new Error('unreachable');
    await repo.insert(
      newAppointment({
        startsAt: theirs,
        endsAt: theirs.add({ minutes: 30 }),
        contact: contact('700112233', 'otro@example.com'),
      }),
    );

    const moved = await repo.updateSchedule(created.value.id, theirs, theirs.add({ minutes: 30 }));

    expect(moved.ok).toBe(false);
    if (moved.ok) throw new Error('unreachable');
    expect(moved.error).toBe('SLOT_TAKEN');

    const { rows } = await testPool().query<{ starts_at: Date }>(
      'SELECT starts_at FROM appointment WHERE id = $1',
      [created.value.id],
    );
    expect(rows[0]?.starts_at.getTime()).toBe(mine.epochMilliseconds);
  });
});

describe('cancel', () => {
  it('cancels a confirmed appointment and records the moment', async () => {
    const created = await repo.insert(newAppointment());
    if (!created.ok) throw new Error('unreachable');

    const cancelled = await repo.cancel(created.value.id, NOW);

    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) throw new Error('unreachable');
    expect(cancelled.value.status).toBe('CANCELLED');
    expect(cancelled.value.cancelledAt?.equals(NOW)).toBe(true);
  });

  it('rejects a second cancellation: cancelled is terminal (BR-007)', async () => {
    const created = await repo.insert(newAppointment());
    if (!created.ok) throw new Error('unreachable');
    await repo.cancel(created.value.id, NOW);

    const again = await repo.cancel(created.value.id, NOW);

    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('unreachable');
    expect(again.error).toBe('ALREADY_CANCELLED');
  });
});

describe('SalonConfigRepository', () => {
  it('loads salon, schedule, closures and the active catalogue', async () => {
    await testPool().query(
      `INSERT INTO opening_interval (id, weekday, starts_at, ends_at)
       VALUES ($1, 6, '10:00', '14:00'), ($2, 6, '16:00', '20:00'), ($3, 1, '10:00', '20:00')`,
      [randomUUID(), randomUUID(), randomUUID()],
    );
    await testPool().query(
      `INSERT INTO closure (id, date, reason) VALUES ($1, '2026-09-22', 'Festivo')`,
      [randomUUID()],
    );
    await testPool().query(
      `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
       VALUES ($1, 'Retirado', 60, 3000, false, 9)`,
      [randomUUID()],
    );

    const config = await createSalonConfigRepository(() => testPool()).load();

    expect(config.salon.timezone).toBe('Europe/Madrid');
    expect(config.salon.phone).toBe('911234567');
    expect(config.schedule.get(6)).toHaveLength(2);
    expect(config.schedule.get(7)).toBeUndefined();
    expect(config.closures.has('2026-09-22')).toBe(true);
    // A retired service stops being offered; appointments referencing it stay whole.
    expect(config.services.map((s) => s.name)).toEqual(['Corte']);
  });

  it('caches the configuration in memory rather than re-reading it per request', async () => {
    const repository = createSalonConfigRepository(() => testPool());
    await repository.load();

    await testPool().query(`UPDATE salon SET name = 'Cambiado'`);

    expect((await repository.load()).salon.name).toBe('Peluqueria Aurora');
  });
});
