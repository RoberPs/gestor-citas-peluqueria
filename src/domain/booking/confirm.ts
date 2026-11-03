import { Temporal } from '@js-temporal/polyfill';
import { generateCandidateStarts } from '../availability/slot-grid';
import type { BookingPolicy, OpeningInterval } from '../catalog/salon';
import { durationOfServices, type NonEmptyServiceList } from '../catalog/selection';
import {
  validateContact,
  type ContactFieldError,
  type RawContact,
  type ValidatedContact,
} from '../contact/contact';
import { err, ok, type Result } from '../shared/result';
import { addMinutes, instantFromWallTime, localDateOf } from '../shared/time';
import type { BusyInterval } from './appointment';

/**
 * The server-side re-check of a booking (FR-011, FR-034).
 *
 * The interface has already checked most of this, and none of that counts.
 * `BEYOND_HORIZON` and `NOT_ON_GRID` have no user scenario at all — the screen
 * cannot produce them. They are in the type precisely because a tampered
 * request can, and the Principio V says the client is never a source of truth.
 *
 * The three-appointment limit of BR-014 is **not** here: it needs the
 * repository, so it lives in the use case. The domain decides on the data it is
 * given; it does not go looking for more.
 */

export type BookingRejection =
  | { readonly kind: 'SLOT_TAKEN' }
  | { readonly kind: 'TOO_LATE_TO_BOOK'; readonly earliestStart: Temporal.Instant }
  | { readonly kind: 'OUTSIDE_OPENING_HOURS' }
  | { readonly kind: 'BEYOND_HORIZON'; readonly horizonEnd: Temporal.PlainDate }
  | { readonly kind: 'NOT_ON_GRID' }
  | { readonly kind: 'INVALID_CONTACT'; readonly fields: readonly ContactFieldError[] };

/** A slot that satisfies the four conditions of FR-003, and nothing more. */
export type ValidatedSlot = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
};

export type ValidatedBooking = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly services: NonEmptyServiceList;
  readonly contact: ValidatedContact;
};

/**
 * What a slot is checked against. It takes a duration, not a service: one
 * service or four, what has to fit is the whole appointment (FR-008).
 */
export type SlotRequest = {
  readonly requestedStart: Temporal.Instant;
  /** The salon's calendar date the start is expected to fall on. */
  readonly date: Temporal.PlainDate;
  readonly durationMinutes: number;
  readonly openingIntervals: readonly OpeningInterval[];
  readonly isClosed: boolean;
  readonly confirmedAppointments: readonly BusyInterval[];
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
  /** While rescheduling, this appointment's own slot does not block it (FR-027). */
  readonly currentAppointmentStart?: Temporal.Instant;
};

/**
 * A new booking. The duration is not passed in: it is the sum of the services,
 * so the two can never disagree.
 */
export type BookingRequest = Omit<SlotRequest, 'durationMinutes' | 'currentAppointmentStart'> & {
  readonly services: NonEmptyServiceList;
  readonly contact: RawContact;
};

function overlaps(
  startsAt: Temporal.Instant,
  endsAt: Temporal.Instant,
  busy: BusyInterval,
): boolean {
  return (
    Temporal.Instant.compare(busy.startsAt, endsAt) < 0 &&
    Temporal.Instant.compare(startsAt, busy.endsAt) < 0
  );
}

/**
 * The four conditions of FR-003 against a requested start.
 *
 * Booking and rescheduling both go through here, so the rules exist once. A
 * second copy for rescheduling is exactly how a slot ends up bookable one way
 * and not the other (Principio I).
 */
export function validateSlot(input: SlotRequest): Result<ValidatedSlot, BookingRejection> {
  const { policy, timezone, now, requestedStart } = input;

  const horizonEnd = localDateOf(now, timezone).add({ days: policy.horizonDays });
  if (Temporal.PlainDate.compare(input.date, horizonEnd) > 0) {
    return err({ kind: 'BEYOND_HORIZON', horizonEnd });
  }

  const candidates = input.isClosed
    ? []
    : generateCandidateStarts(input.openingIntervals, policy.slotGridMinutes);

  const candidate = candidates.find((option) =>
    instantFromWallTime(input.date, option.start, timezone).equals(requestedStart),
  );

  if (candidate === undefined) {
    // Off the grid and outside opening hours are different failures: one means
    // the request was tampered with, the other that the salon is shut then.
    return err(isOnGrid(requestedStart, input) ? { kind: 'OUTSIDE_OPENING_HOURS' } : { kind: 'NOT_ON_GRID' });
  }

  const endsAt = addMinutes(requestedStart, input.durationMinutes);
  const stretchEnd = instantFromWallTime(input.date, candidate.intervalEnd, timezone);
  if (Temporal.Instant.compare(endsAt, stretchEnd) > 0) {
    return err({ kind: 'OUTSIDE_OPENING_HOURS' });
  }

  const earliestStart = addMinutes(now, policy.minimumLeadTimeMinutes);
  if (Temporal.Instant.compare(requestedStart, earliestStart) < 0) {
    return err({ kind: 'TOO_LATE_TO_BOOK', earliestStart });
  }

  const ownStart = input.currentAppointmentStart;
  const blocking = input.confirmedAppointments.filter(
    (busy) => ownStart === undefined || !busy.startsAt.equals(ownStart),
  );
  if (blocking.some((busy) => overlaps(requestedStart, endsAt, busy))) {
    return err({ kind: 'SLOT_TAKEN' });
  }

  return ok({ startsAt: requestedStart, endsAt });
}

/**
 * Checks the slot before the contact.
 *
 * When both are wrong, the slot is what the client hears about: asking someone
 * to correct a phone number for an hour that no longer exists wastes the only
 * thing they had left — their patience.
 */
export function validateBookingRequest(
  input: BookingRequest,
): Result<ValidatedBooking, BookingRejection> {
  const slot = validateSlot({ ...input, durationMinutes: durationOfServices(input.services) });
  if (!slot.ok) return slot;

  const contact = validateContact(input.contact);
  if (!contact.ok) return err({ kind: 'INVALID_CONTACT', fields: contact.error });

  return ok({ ...slot.value, services: input.services, contact: contact.value });
}

/** Whether the wall clock of the start lands on the grid, closed day or not. */
function isOnGrid(start: Temporal.Instant, input: SlotRequest): boolean {
  const zoned = start.toZonedDateTimeISO(input.timezone);
  const minutesIntoDay = zoned.hour * 60 + zoned.minute;

  return (
    zoned.second === 0 &&
    zoned.millisecond === 0 &&
    minutesIntoDay % input.policy.slotGridMinutes === 0
  );
}
