import { Client } from 'pg';

/**
 * Writes a whole salon configuration: the salon, its weekly opening stretches,
 * its closures and its catalogue. Shared by the fixture the tests rely on
 * (`seed.ts`) and the data shown in demos (`demo.ts`), so switching a database
 * from one to the other is a matter of running the other script.
 *
 * Re-running is safe. Services are upserted by fixed id and never deleted:
 * appointments keep referencing the service they were booked with. Services
 * that are not in the new catalogue are deactivated instead, so they stop
 * being offered. Opening stretches and closures are replaced wholesale, since
 * nothing references them.
 */

export type SalonConfiguration = {
  readonly salon: {
    readonly id: string;
    readonly name: string;
    readonly address: string;
    readonly phone: string;
  };
  readonly opening: readonly { readonly weekday: number; readonly from: string; readonly to: string }[];
  readonly services: readonly {
    readonly id: string;
    readonly name: string;
    readonly minutes: number;
    readonly cents: number;
    readonly order: number;
  }[];
  readonly closures: readonly { readonly id: string; readonly date: string; readonly reason: string }[];
};

export async function writeConfiguration(
  connectionString: string,
  timezone: string,
  configuration: SalonConfiguration,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    const { salon } = configuration;
    await client.query(
      `INSERT INTO salon (id, name, address, phone, timezone)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ((true)) DO UPDATE
         SET id = EXCLUDED.id, name = EXCLUDED.name, address = EXCLUDED.address,
             phone = EXCLUDED.phone, timezone = EXCLUDED.timezone`,
      [salon.id, salon.name, salon.address, salon.phone, timezone],
    );

    await client.query('DELETE FROM opening_interval');
    for (const [index, interval] of configuration.opening.entries()) {
      await client.query(
        `INSERT INTO opening_interval (id, weekday, starts_at, ends_at)
         VALUES ($1, $2, $3, $4)`,
        [
          `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
          interval.weekday,
          interval.from,
          interval.to,
        ],
      );
    }

    for (const service of configuration.services) {
      await client.query(
        `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
         VALUES ($1, $2, $3, $4, true, $5)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               duration_minutes = EXCLUDED.duration_minutes,
               price_cents = EXCLUDED.price_cents,
               is_active = EXCLUDED.is_active,
               display_order = EXCLUDED.display_order`,
        [service.id, service.name, service.minutes, service.cents, service.order],
      );
    }
    await client.query('UPDATE service SET is_active = false WHERE NOT (id = ANY($1::uuid[]))', [
      configuration.services.map((service) => service.id),
    ]);

    await client.query('DELETE FROM closure');
    for (const closure of configuration.closures) {
      await client.query('INSERT INTO closure (id, date, reason) VALUES ($1, $2, $3)', [
        closure.id,
        closure.date,
        closure.reason,
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
