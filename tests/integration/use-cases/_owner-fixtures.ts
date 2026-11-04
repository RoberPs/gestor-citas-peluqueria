import { randomBytes, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { createManageOwnerAppointments } from '@/application/use-cases/manage-owner-appointments';
import type { OwnerAppointmentWriter } from '@/application/ports';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createOwnerAppointmentWriter } from '@/infrastructure/db/owner-appointment-writer';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { stateHash } from '@/infrastructure/security/state-hash';
import { insertAppointmentRow, testPool } from '../helpers/test-db';

/**
 * What the suites of the owner's appointments share (002, Historias 4, 5, 6
 * y 11): one salon open Monday to Saturday 10:00–20:00, three services — one
 * of them retired — and a clock the test controls.
 */

export const CORTE = '00000000-0000-4000-8000-000000000011';
export const BARBA = '00000000-0000-4000-8000-000000000012';
export const RETIRADO = '00000000-0000-4000-8000-000000000013';

/** Tuesday 2026-09-15, 10:00 in Madrid. */
export const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');

export const clock: { now: () => Temporal.Instant; set(instant: Temporal.Instant): void } & Clock = (() => {
  let current = NOW;
  return {
    now: () => current,
    set(instant: Temporal.Instant) {
      current = instant;
    },
  };
})();

/** Friday 2026-09-18 in Madrid, summer time. */
export function friday(time: string): Temporal.Instant {
  return Temporal.Instant.from(`2026-09-18T${time}:00+02:00`);
}

export function ownerAppointments(writer: OwnerAppointmentWriter = createOwnerAppointmentWriter(testPool)) {
  return createManageOwnerAppointments({
    config: createSalonConfigRepository(testPool),
    appointments: createAppointmentRepository(testPool),
    periods: createUnavailablePeriodRepository(testPool),
    writer,
    stateHash,
    clock,
  });
}

export async function seedSalon(): Promise<void> {
  clock.set(NOW);
  await testPool().query(
    `INSERT INTO salon (id, name, address, phone, timezone)
     VALUES ($1, 'Peluqueria Aurora', 'Calle Mayor 14', '911234567', 'Europe/Madrid')`,
    [randomUUID()],
  );
  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order) VALUES
       ($1, 'Corte de pelo', 30, 1800, true, 1),
       ($2, 'Diseño y corte de barba', 30, NULL, true, 2),
       ($3, 'Tinte', 60, 4000, false, 3)`,
    [CORTE, BARBA, RETIRADO],
  );
  for (const weekday of [1, 2, 3, 4, 5, 6]) {
    await testPool().query(
      `INSERT INTO opening_interval (id, weekday, starts_at, ends_at) VALUES ($1, $2, '10:00', '20:00')`,
      [randomUUID(), weekday],
    );
  }
}

/** An online booking on Friday, with its link, as 001 writes them. */
export async function bookFriday(
  from: string,
  to: string,
  customer: { name?: string; phone?: string; email?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const phone = customer.phone ?? '600112233';
  await insertAppointmentRow(
    {
      id,
      status: 'CONFIRMED',
      starts_at: `2026-09-18 ${from}+02`,
      ends_at: `2026-09-18 ${to}+02`,
      customer_name: customer.name ?? 'Ana López',
      customer_phone: phone,
      customer_email: customer.email ?? 'ana@example.com',
      customer_phone_normalized: `+34${phone}`,
      customer_email_normalized: customer.email ?? 'ana@example.com',
      token_hash: randomBytes(32),
    },
    { serviceId: CORTE, name: 'Corte de pelo', durationMinutes: 30, priceCents: 1500 },
  );
  return id;
}

export async function insertPeriod(from: Temporal.Instant, to: Temporal.Instant, reason: string | null = 'Recado') {
  const id = randomUUID();
  await testPool().query('INSERT INTO unavailable_period (id, starts_at, ends_at, reason) VALUES ($1, $2, $3, $4)', [
    id,
    new Date(from.epochMilliseconds),
    new Date(to.epochMilliseconds),
    reason,
  ]);
  return id;
}

export async function confirmedCount(): Promise<number> {
  const { rows } = await testPool().query<{ count: string }>(
    "SELECT count(*) FROM appointment WHERE status = 'CONFIRMED'",
  );
  return Number(rows[0]?.count);
}

export const LUIS = { name: 'Luis Pérez', phone: '611 22 33 44', email: null };
