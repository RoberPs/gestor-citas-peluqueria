import { Temporal } from '@js-temporal/polyfill';
import { openingOf } from '@/domain/availability/compute-range';
import type { Salon } from '@/domain/catalog/salon';
import { buildAgendaDay, type AgendaDay } from '@/domain/owner/agenda';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import { instantFromWallTime, localDateOf } from '@/domain/shared/time';
import type {
  AppointmentRepository,
  SalonConfigRepository,
  UnavailablePeriodRepository,
} from '../ports';

/**
 * One day of the owner's agenda (002, Historia 2).
 *
 * A fixed number of queries whatever the day holds and however long the salon
 * has been open — the configuration, the day's appointments with all their
 * services, and the periods that touch it — and the timeline is derived in
 * memory (D-027, SC-010). Any date, past or future (FR-012).
 */

export type AgendaView = {
  readonly day: AgendaDay;
  /** Today in the salon's calendar, for the "today" shortcut (FR-012). */
  readonly today: Temporal.PlainDate;
  readonly salon: Salon;
};

function startOfDay(date: Temporal.PlainDate, timezone: string): Temporal.Instant {
  return instantFromWallTime(date, new Temporal.PlainTime(0, 0), timezone);
}

export function createGetAgendaDay(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly periods: UnavailablePeriodRepository;
  readonly clock: Clock;
}) {
  return async function getAgendaDay(input: {
    /** `YYYY-MM-DD` in the salon's calendar; today when missing. */
    readonly date?: string | undefined;
    readonly includeCancelled: boolean;
  }): Promise<Result<AgendaView, 'INVALID_DATE'>> {
    const configuration = await deps.config.load();
    const timezone = configuration.salon.timezone;
    const now = deps.clock.now();
    const today = localDateOf(now, timezone);

    let date: Temporal.PlainDate;
    try {
      date = input.date === undefined ? today : Temporal.PlainDate.from(input.date, { overflow: 'reject' });
    } catch {
      return err('INVALID_DATE');
    }

    const from = startOfDay(date, timezone);
    const to = startOfDay(date.add({ days: 1 }), timezone);
    const [appointments, unavailablePeriods] = await Promise.all([
      deps.appointments.findInWindow(from, to, { includeCancelled: input.includeCancelled }),
      deps.periods.findOverlapping(from, to),
    ]);

    const day = buildAgendaDay({
      date,
      openingIntervals: openingOf(date, configuration.schedule).openingIntervals,
      appointments,
      unavailablePeriods,
      now,
      timezone,
    });

    return ok({ day, today, salon: configuration.salon });
  };
}
