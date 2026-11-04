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
 * Reads the salon's configuration on every load (002, D-021).
 *
 * Nothing is cached: the owner edits this configuration, and whatever she saves
 * must rule in the client's very next query, with no restart (FR-056). A cache
 * without invalidation would break that by construction, and one with it would
 * fail silently the day some write forgot to invalidate. The cost is three small
 * reads in parallel over tables of tens of rows, and `config-propagation.test.ts`
 * counts them so that it stays that.
 */
export function createSalonConfigRepository(getPool: () => Pool): SalonConfigRepository {
  return {
    async loadCatalogue() {
      const rows = await drizzle(getPool(), { schema }).select().from(service).orderBy(asc(service.displayOrder));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        durationMinutes: row.durationMinutes,
        priceCents: row.priceCents,
        isActive: row.isActive,
        displayOrder: row.displayOrder,
      }));
    },

    async load(): Promise<SalonConfiguration> {
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

      return {
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
        // The two parameters the owner edits come from the salon row; the rest
        // of the policy is the system's and stays in code (D-022).
        policy: {
          ...DEFAULT_BOOKING_POLICY,
          minimumLeadTimeMinutes: salonRow.minimumLeadTimeMinutes,
          cancellationDeadlineHours: salonRow.cancellationDeadlineHours,
        },
      };
    },
  };
}
