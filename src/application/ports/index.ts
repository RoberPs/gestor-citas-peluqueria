import type { Temporal } from '@js-temporal/polyfill';
import type {
  Appointment,
  AppointmentId,
  BusyInterval,
} from '@/domain/booking/appointment';
import type { SalonConfiguration, UnavailablePeriod } from '@/domain/catalog/salon';
import type { NonEmptyServiceList } from '@/domain/catalog/selection';
import type { NormalizedEmail, NormalizedPhone, ValidatedContact } from '@/domain/contact/contact';
import type { Result } from '@/domain/shared/result';

/**
 * The ports the domain does not know about.
 *
 * The domain is handed data that has already been loaded; it never goes looking
 * for any. That is what lets it stay pure and testable without infrastructure.
 */

export type NewAppointment = {
  readonly id: AppointmentId;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  /** In catalogue order: the order is kept as each row's position. */
  readonly services: NonEmptyServiceList;
  readonly contact: ValidatedContact;
  readonly tokenHash: Uint8Array;
  readonly createdAt: Temporal.Instant;
};

export interface AppointmentRepository {
  findByTokenHash(hash: Uint8Array): Promise<Appointment | null>;

  /** D-003: ONE query for the whole horizon. Sustains SC-005 and FR-005b. */
  findConfirmedInWindow(
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<readonly BusyInterval[]>;

  /**
   * BR-014 / FR-013: counts that phone's confirmed future appointments and that
   * email's **separately**. It returns the two counts, not their union: the rule
   * is `byPhone >= 3 || byEmail >= 3`, not `count(phone OR email) >= 3`.
   * A `WHERE phone = $1 OR email = $2` would implement a stricter rule than the
   * specified one, rejecting someone who has reached neither limit.
   */
  countFutureByContact(
    phone: NormalizedPhone,
    email: NormalizedEmail,
    now: Temporal.Instant,
  ): Promise<{ readonly byPhone: number; readonly byEmail: number }>;

  /**
   * Inserts the appointment and its services in one transaction (005, D-011).
   * Translates the 23P01 violation of the EXCLUDE constraint into
   * `SLOT_TAKEN`, which is how FR-012 becomes observable without leaking
   * database detail upwards.
   */
  insert(appointment: NewAppointment): Promise<Result<Appointment, 'SLOT_TAKEN'>>;

  /** FR-025, BR-006: atomic. On failure the original appointment is untouched. */
  updateSchedule(
    id: AppointmentId,
    start: Temporal.Instant,
    end: Temporal.Instant,
  ): Promise<Result<Appointment, 'SLOT_TAKEN'>>;

  cancel(
    id: AppointmentId,
    at: Temporal.Instant,
  ): Promise<Result<Appointment, 'ALREADY_CANCELLED'>>;
}

export interface SalonConfigRepository {
  /** FR-007: preloaded configuration, read-only in v1. Cacheable in memory. */
  load(): Promise<SalonConfiguration>;
}

/** The owner's blocked time (002, D-019). Never cached: a new period rules at once (FR-056). */
export interface UnavailablePeriodRepository {
  /**
   * The periods that touch `[from, to)`, in order, found through the index on
   * their range (D-027). One query for the whole window, never one per day.
   */
  findOverlapping(
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<readonly UnavailablePeriod[]>;
}

export interface TokenGenerator {
  /** D-005: 32 bytes from a CSPRNG. Returns the clear token and its SHA-256. */
  generate(): { readonly token: string; readonly hash: Uint8Array };
  hash(token: string): Uint8Array;
}

export type RateLimitBucket = 'APPOINTMENT_LOOKUP' | 'BOOKING_CONFIRMATION';

export interface RateLimiter {
  /**
   * FR-040: the IP becomes a key through an HMAC and is not kept beyond the
   * window. The result deliberately carries no remaining-attempts count and no
   * retry time: whoever opens a link must not be able to deduce that a limit
   * exists at all (FR-038, D-006). If it returned those, someone would put them
   * in a header and the indistinguishability would be gone.
   */
  check(bucket: RateLimitBucket, clientIp: string): Promise<{ readonly allowed: boolean }>;
}
