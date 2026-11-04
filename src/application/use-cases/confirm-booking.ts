import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { openingOf } from '@/domain/availability/compute-range';
import type { Appointment } from '@/domain/booking/appointment';
import { validateBookingRequest, type BookingRejection } from '@/domain/booking/confirm';
import { selectServices } from '@/domain/catalog/selection';
import type { Clock } from '@/domain/shared/clock';
import type { RawContact } from '@/domain/contact/contact';
import { err, ok, type Result } from '@/domain/shared/result';
import { localDateOf } from '@/domain/shared/time';
import type {
  AppointmentRepository,
  SalonConfigRepository,
  TokenGenerator,
  UnavailablePeriodRepository,
} from '../ports';

/**
 * Confirming a booking (Historia 2).
 *
 * Two guards, and they are not the same guard twice:
 *
 * - The **domain** re-checks the slot against the data just loaded (FR-011).
 * - The **database** refuses to hold two overlapping confirmed appointments,
 *   whatever the application believed a microsecond earlier (FR-012, D-002).
 *
 * The second is what makes the promise hold under two simultaneous
 * confirmations, which is precisely when the first one cannot.
 */

export type ConfirmBookingInput = {
  readonly serviceIds: readonly string[];
  /** The absolute instant, exactly as `/availability` handed it out. */
  readonly startsAt: string;
  readonly contact: RawContact;
};

export type ConfirmBookingFailure =
  | { readonly kind: 'EMPTY_SELECTION' }
  | { readonly kind: 'DUPLICATE_SERVICE' }
  /**
   * A service that is not, or is no longer, on offer. To the client a retired
   * service and one that never existed are the same news (FR-015).
   */
  | { readonly kind: 'SERVICE_UNAVAILABLE'; readonly serviceIds: readonly string[] }
  | { readonly kind: 'INVALID_START' }
  | { readonly kind: 'REJECTED'; readonly rejection: BookingRejection }
  | { readonly kind: 'CONTACT_LIMIT_REACHED'; readonly limit: number };

export type ConfirmedBooking = {
  readonly appointment: Appointment;
  /**
   * The only copy of the clear token that will ever exist outside the client's
   * browser. v1 sends no message, so the confirmation screen is its one
   * delivery (FR-015, asunción 5).
   */
  readonly token: string;
};

function parseInstant(value: string): Temporal.Instant | null {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
}

export function createConfirmBooking(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly periods: UnavailablePeriodRepository;
  readonly tokens: TokenGenerator;
  readonly clock: Clock;
}) {
  return async function confirmBooking(
    input: ConfirmBookingInput,
  ): Promise<Result<ConfirmedBooking, ConfirmBookingFailure>> {
    const configuration = await deps.config.load();
    const { policy, salon } = configuration;
    const timezone = salon.timezone;
    const now = deps.clock.now();

    // The services are checked against today's catalogue before the slot:
    // the slot is measured with their total duration (FR-015).
    const selection = selectServices(configuration.services, input.serviceIds);
    if (!selection.ok) {
      switch (selection.error.kind) {
        case 'EMPTY':
          return err({ kind: 'EMPTY_SELECTION' });
        case 'DUPLICATE':
          return err({ kind: 'DUPLICATE_SERVICE' });
        case 'UNKNOWN_SERVICE':
          return err({ kind: 'SERVICE_UNAVAILABLE', serviceIds: selection.error.serviceIds });
      }
    }

    const requestedStart = parseInstant(input.startsAt);
    if (requestedStart === null) return err({ kind: 'INVALID_START' });

    // The date is derived from the instant, never taken from the request.
    const date = localDateOf(requestedStart, timezone);
    const opening = openingOf(date, configuration.schedule);

    const dayStart = date
      .toPlainDateTime(new Temporal.PlainTime(0, 0))
      .toZonedDateTime(timezone, { disambiguation: 'compatible' })
      .toInstant();
    const dayEnd = date
      .add({ days: 1 })
      .toPlainDateTime(new Temporal.PlainTime(0, 0))
      .toZonedDateTime(timezone, { disambiguation: 'compatible' })
      .toInstant();

    const [busy, unavailablePeriods] = await Promise.all([
      deps.appointments.findConfirmedInWindow(dayStart, dayEnd),
      deps.periods.findOverlapping(dayStart, dayEnd),
    ]);

    const validated = validateBookingRequest({
      requestedStart,
      date,
      services: selection.value.services,
      contact: input.contact,
      openingIntervals: opening.openingIntervals,
      unavailablePeriods,
      confirmedAppointments: busy,
      now,
      policy,
      timezone,
    });

    if (!validated.ok) return err({ kind: 'REJECTED', rejection: validated.error });

    const counts = await deps.appointments.countFutureByContact(
      validated.value.contact.normalizedPhone,
      validated.value.contact.normalizedEmail,
      now,
    );

    const limit = policy.maxFutureAppointmentsPerContact;
    if (counts.byPhone >= limit || counts.byEmail >= limit) {
      return err({ kind: 'CONTACT_LIMIT_REACHED', limit });
    }

    const { token, hash } = deps.tokens.generate();

    const inserted = await deps.appointments.insert({
      id: randomUUID(),
      startsAt: validated.value.startsAt,
      endsAt: validated.value.endsAt,
      services: validated.value.services,
      contact: validated.value.contact,
      tokenHash: hash,
      createdAt: now,
    });

    // The exclusion constraint had the last word, as it is meant to.
    if (!inserted.ok) return err({ kind: 'REJECTED', rejection: { kind: 'SLOT_TAKEN' } });

    return ok({ appointment: inserted.value, token });
  };
}
