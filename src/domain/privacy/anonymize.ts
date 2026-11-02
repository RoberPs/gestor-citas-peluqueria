import { Temporal } from '@js-temporal/polyfill';
import type { Appointment } from '../booking/appointment';

/**
 * The twelve month deletion (FR-035, FR-035a, BR-018).
 *
 * It anonymises rather than deletes: the person goes, the occupancy stays. The
 * salon keeps a complete history of when its chair was busy, and that history
 * contains nobody.
 *
 * | Goes            | Stays                        |
 * |-----------------|------------------------------|
 * | name            | the service snapshot         |
 * | phone           | start and end                |
 * | email           | the persisted status         |
 * | the token hash  | createdAt, cancelledAt       |
 *
 * The token hash goes with the rest, in the same act: the link stops resolving
 * the moment the data is gone, so an old link is indistinguishable from one
 * that never existed.
 */

/**
 * An appointment after the purge.
 *
 * The type makes the dangerous middle state — no name, working link —
 * impossible to write. The database enforces the same invariant from the other
 * side with `appointment_anonymization_is_atomic`. Two layers, one invariant:
 * BR-018 does not depend on anyone remembering it.
 */
export type AnonymizedAppointment = Omit<Appointment, 'customer' | 'anonymizedAt'> & {
  readonly customer: null;
  readonly anonymizedAt: Temporal.Instant;
};

/**
 * Takes the moment as an argument rather than reading a clock: the domain does
 * not own one (FR-032).
 */
export function anonymize(appointment: Appointment, at: Temporal.Instant): AnonymizedAppointment {
  return { ...appointment, customer: null, anonymizedAt: at };
}

/**
 * Whether the retention period has run out for this appointment.
 *
 * It needs the timezone because twelve months is a calendar span, not a fixed
 * number of days, and calendar arithmetic has to happen somewhere on the map.
 */
export function isDueForAnonymization(
  appointment: Appointment,
  now: Temporal.Instant,
  retentionMonths: number,
  timezone: string,
): boolean {
  // Already done. Running the purge twice must not move the date it records.
  if (appointment.anonymizedAt !== null) return false;

  const dueAt = appointment.startsAt
    .toZonedDateTimeISO(timezone)
    .add({ months: retentionMonths })
    .toInstant();

  return Temporal.Instant.compare(now, dueAt) >= 0;
}
