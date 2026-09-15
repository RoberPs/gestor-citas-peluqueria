import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { ensureSchema, testPool, truncateAll } from '../../integration/helpers/test-db';

/**
 * The configuration the contract suites run against.
 *
 * It is loaded once, like the real thing: services, opening hours and closures
 * are preloaded data this feature only ever reads (FR-007). Between tests only
 * `appointment` is emptied.
 */

export const CORTE = '00000000-0000-4000-8000-000000000011';
export const COLOR = '00000000-0000-4000-8000-000000000012';

/** Tuesday 2026-09-15, 10:00 in Madrid. Every contract suite pins the clock here. */
export const CONTRACT_NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');

export const SALON_PHONE = '911 23 45 67';

export async function seedContractDatabase(): Promise<void> {
  await ensureSchema();
  await truncateAll();

  await testPool().query(
    `INSERT INTO salon (id, name, address, phone, timezone)
     VALUES ($1, 'Peluqueria Aurora', 'Calle Mayor 14, Madrid', $2, 'Europe/Madrid')`,
    [randomUUID(), SALON_PHONE],
  );

  for (const weekday of [1, 2, 3, 4, 5]) {
    await testPool().query(
      `INSERT INTO opening_interval (id, weekday, starts_at, ends_at)
       VALUES ($1, $2, '10:00', '20:00')`,
      [randomUUID(), weekday],
    );
  }
  await testPool().query(
    `INSERT INTO opening_interval (id, weekday, starts_at, ends_at)
     VALUES ($1, 6, '10:00', '14:00'), ($2, 6, '16:00', '20:00')`,
    [randomUUID(), randomUUID()],
  );

  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Corte', 30, 1800, true, 1), ($2, 'Color', 90, 5500, true, 2)`,
    [CORTE, COLOR],
  );
}
