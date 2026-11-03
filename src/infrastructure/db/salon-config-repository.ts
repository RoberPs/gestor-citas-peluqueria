import { Temporal } from '@js-temporal/polyfill';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { SalonConfigRepository } from '@/application/ports';
import {
  DEFAULT_BOOKING_POLICY,
  isWeekday,
  type OpeningInterval,
  type SalonConfiguration,
  type Weekday,
  type WeeklySchedule,
} from '@/domain/catalog/salon';
import { openingInterval, salon, schema, service } from './schema';

/**
 * Reads the preloaded configuration (FR-007). This feature never writes it.
 *
 * The result is cached in memory: it changes when the owner reloads it, not per
 * request, and the availability query is meant to be one query — paying for four
 * more to re-read a schedule that has not moved would defeat the point (D-003).
 */
export function createSalonConfigRepository(getPool: () => Pool): SalonConfigRepository {
  let cached: SalonConfiguration | undefined;

  return {
    async load(): Promise<SalonConfiguration> {
      if (cached !== undefined) return cached;

      const database = drizzle(getPool(), { schema });

      const [salonRows, intervalRows, serviceRows] = await Promise.all([
        database.select().from(salon).limit(1),
        database.select().from(openingInterval).orderBy(asc(openingInterval.startsAt)),
        database
          .select()
          .from(service)
          .where(eq(service.isActive, true))
          .orderBy(asc(service.displayOrder)),
      ]);

      const salonRow = salonRows[0];
      if (salonRow === undefined) {
        throw new Error('No salon configured. Run `npm run db:seed` (FR-007).');
      }

      const schedule = new Map<Weekday, OpeningInterval[]>();
      for (const row of intervalRows) {
        if (!isWeekday(row.weekday)) continue;
        const stretches = schedule.get(row.weekday) ?? [];
        stretches.push({
          weekday: row.weekday,
          startsAt: Temporal.PlainTime.from(row.startsAt),
          endsAt: Temporal.PlainTime.from(row.endsAt),
        });
        schedule.set(row.weekday, stretches);
      }

      cached = {
        salon: {
          name: salonRow.name,
          address: salonRow.address,
          phone: salonRow.phone,
          timezone: salonRow.timezone,
        },
        schedule: schedule as WeeklySchedule,
        services: serviceRows.map((row) => ({
          id: row.id,
          name: row.name,
          durationMinutes: row.durationMinutes,
          priceCents: row.priceCents,
          isActive: row.isActive,
          displayOrder: row.displayOrder,
        })),
        policy: DEFAULT_BOOKING_POLICY,
      };

      return cached;
    },
  };
}
