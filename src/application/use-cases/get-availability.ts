import { Temporal } from '@js-temporal/polyfill';
import { computeDaySlots } from '@/domain/availability/compute-day';
import { computeRangeDays, horizonEndOf, openingOf } from '@/domain/availability/compute-range';
import { findNextAvailableDate } from '@/domain/availability/next-available';
import type { RangeDay, Slot } from '@/domain/booking/appointment';
import type { Salon } from '@/domain/catalog/salon';
import {
  durationOfServices,
  selectServices,
  type NonEmptyServiceList,
  type ServiceSelection,
} from '@/domain/catalog/selection';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import { localDateOf } from '@/domain/shared/time';
import type { AppointmentRepository, SalonConfigRepository } from '../ports';

/**
 * Everything the booking screen needs, in one response fed by **one query**
 * (FR-005b, SC-005).
 *
 * The horizon's confirmed appointments are loaded once; the state of the 14
 * days, the slots of the selected day and the jump to the next free day are all
 * derived from that array in memory. No loop over days touches the database, so
 * the N+1 the Principio VIII forbids cannot appear here.
 */

export type AvailabilityView = {
  /** The services asked about, in catalogue order, and their total duration. */
  readonly selection: ServiceSelection;
  readonly salon: Salon;
  readonly range: {
    readonly start: string;
    readonly end: string;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
  };
  readonly days: readonly RangeDay[];
  readonly selectedDate: string;
  readonly slots: readonly Slot[];
  readonly nextAvailableDate: string | null;
  readonly cancellationPolicyHours: number;
};

export type AvailabilityRejection =
  | { readonly kind: 'EMPTY_SELECTION' }
  | { readonly kind: 'DUPLICATE_SERVICE' }
  | { readonly kind: 'UNKNOWN_SERVICE'; readonly serviceIds: readonly string[] }
  | { readonly kind: 'RANGE_OUT_OF_BOUNDS' };

export type GetAvailabilityInput = {
  readonly rangeStart?: string | undefined;
  readonly selectedDate?: string | undefined;
} & (
  | { readonly serviceIds: readonly string[]; readonly currentAppointment?: undefined }
  | {
      /**
       * Set while rescheduling: the services are the appointment's frozen
       * snapshots, whatever the catalogue says today, so the hours offered are
       * for the duration that was booked; and its own slot stops counting as
       * busy (FR-017, FR-027, D-008). No ids can be passed alongside it.
       */
      readonly currentAppointment: {
        readonly services: NonEmptyServiceList;
        readonly startsAt: Temporal.Instant;
      };
      readonly serviceIds?: undefined;
    }
);

function parseDate(value: string | undefined): Temporal.PlainDate | null {
  if (value === undefined) return null;
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return null;
  }
}

/** The domain's reasons for refusing a selection, in this use case's words. */
function selectionFor(
  input: GetAvailabilityInput,
  catalogue: Parameters<typeof selectServices>[0],
): Result<ServiceSelection, AvailabilityRejection> {
  if (input.currentAppointment !== undefined) {
    const { services } = input.currentAppointment;
    return ok({ services, durationMinutes: durationOfServices(services) });
  }

  const selected = selectServices(catalogue, input.serviceIds);
  if (selected.ok) return selected;

  switch (selected.error.kind) {
    case 'EMPTY':
      return err({ kind: 'EMPTY_SELECTION' });
    case 'DUPLICATE':
      return err({ kind: 'DUPLICATE_SERVICE' });
    case 'UNKNOWN_SERVICE':
      return err({ kind: 'UNKNOWN_SERVICE', serviceIds: selected.error.serviceIds });
  }
}

function startOfDay(date: Temporal.PlainDate, timezone: string): Temporal.Instant {
  return date
    .toPlainDateTime(new Temporal.PlainTime(0, 0))
    .toZonedDateTime(timezone, { disambiguation: 'compatible' })
    .toInstant();
}

export function createGetAvailability(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly clock: Clock;
}) {
  return async function getAvailability(
    input: GetAvailabilityInput,
  ): Promise<Result<AvailabilityView, AvailabilityRejection>> {
    const configuration = await deps.config.load();
    const { policy, salon } = configuration;
    const timezone = salon.timezone;
    const now = deps.clock.now();

    const selected = selectionFor(input, configuration.services);
    if (!selected.ok) return selected;
    const selection = selected.value;

    const today = localDateOf(now, timezone);
    const horizonEnd = horizonEndOf(now, policy, timezone);

    const requestedStart = parseDate(input.rangeStart);
    if (input.rangeStart !== undefined && requestedStart === null) {
      return err({ kind: 'RANGE_OUT_OF_BOUNDS' });
    }

    const rangeStart = requestedStart ?? today;
    // No stepping back before today and none past the horizon (FR-005b).
    if (
      Temporal.PlainDate.compare(rangeStart, today) < 0 ||
      Temporal.PlainDate.compare(rangeStart, horizonEnd) > 0
    ) {
      return err({ kind: 'RANGE_OUT_OF_BOUNDS' });
    }

    // THE query. From local midnight, so an appointment already under way still
    // counts as busy, through to the end of the horizon.
    const busy = await deps.appointments.findConfirmedInWindow(
      startOfDay(today, timezone),
      startOfDay(horizonEnd.add({ days: 1 }), timezone),
    );

    const currentStart = input.currentAppointment?.startsAt;
    const shared = {
      salonSchedule: configuration.schedule,
      closures: configuration.closures,
      serviceDurationMinutes: selection.durationMinutes,
      confirmedAppointments: busy,
      now,
      policy,
      timezone,
      ...(currentStart === undefined ? {} : { currentAppointmentStart: currentStart }),
    };

    const days = computeRangeDays({
      rangeStart,
      rangeLengthDays: policy.rangeLengthDays,
      ...shared,
    });

    const lastDay = days.at(-1);
    if (lastDay === undefined) return err({ kind: 'RANGE_OUT_OF_BOUNDS' });

    const requestedSelection = parseDate(input.selectedDate);
    if (input.selectedDate !== undefined && requestedSelection === null) {
      return err({ kind: 'RANGE_OUT_OF_BOUNDS' });
    }
    if (
      requestedSelection !== null &&
      !days.some((day) => day.date === requestedSelection.toString())
    ) {
      return err({ kind: 'RANGE_OUT_OF_BOUNDS' });
    }

    // With no day asked for, land on the first one with room: the client should
    // not have to hunt for it.
    const selectedDate =
      requestedSelection ??
      Temporal.PlainDate.from(
        days.find((day) => day.status === 'AVAILABLE')?.date ?? rangeStart.toString(),
      );

    const opening = openingOf(selectedDate, configuration.schedule, configuration.closures);
    const slots = computeDaySlots({
      date: selectedDate,
      openingIntervals: opening.openingIntervals,
      isClosed: opening.isClosed,
      ...shared,
    });

    const nextAvailableDate = findNextAvailableDate({
      fromDate: selectedDate,
      horizonEnd,
      ...shared,
    });

    return ok({
      selection,
      salon,
      range: {
        start: rangeStart.toString(),
        end: lastDay.date,
        // False in the first range: past days are not bookable (escenario 10).
        canGoBack: Temporal.PlainDate.compare(rangeStart, today) > 0,
        // False once the horizon is reached (escenario 9).
        canGoForward:
          Temporal.PlainDate.compare(Temporal.PlainDate.from(lastDay.date), horizonEnd) < 0,
      },
      days,
      selectedDate: selectedDate.toString(),
      slots,
      nextAvailableDate: nextAvailableDate === null ? null : nextAvailableDate.toString(),
      cancellationPolicyHours: policy.cancellationDeadlineHours,
    });
  };
}
