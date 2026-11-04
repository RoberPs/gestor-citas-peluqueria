import { Temporal } from '@js-temporal/polyfill';
import { overlaps } from '../availability/interval-math';
import type { Appointment, AppointmentId } from '../booking/appointment';
import type { UnavailablePeriod, UnavailablePeriodId } from '../catalog/salon';
import { err, ok, type Result } from '../shared/result';

/**
 * What gets in the way of an operation of the owner's, named (002, FR-033).
 *
 * A conflict carries what it takes to show it — customer, every service and
 * span for an appointment; span and reason for a period — because one that
 * cannot be shown is no help to decide (contracts/domain-api.md). Overlap is
 * the half-open `overlaps` of BR-013: one minute is as much a conflict as the
 * whole span (clarificación 2026-09-16).
 */

export type Conflict =
  | {
      readonly kind: 'APPOINTMENT';
      readonly id: AppointmentId;
      /** `null` once anonymised. */
      readonly customerName: string | null;
      /** In the order they were booked, which is the catalogue's. */
      readonly serviceNames: readonly string[];
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
    }
  | {
      readonly kind: 'UNAVAILABLE_PERIOD';
      readonly id: UnavailablePeriodId;
      readonly reason: string | null;
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
    };

function byStartThenId(a: Conflict, b: Conflict): number {
  return Temporal.Instant.compare(a.startsAt, b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Only CONFIRMED appointments get in the way; a cancelled one holds no time. */
export function detectConflicts(input: {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly appointments: readonly Appointment[];
  readonly periods: readonly UnavailablePeriod[];
  /** When moving or editing: the appointment does not get in its own way. */
  readonly excludeAppointmentId?: AppointmentId;
}): readonly Conflict[] {
  const span = { startsAt: input.startsAt, endsAt: input.endsAt };

  const appointments: Conflict[] = input.appointments
    .filter(
      (appointment) =>
        appointment.status === 'CONFIRMED' &&
        appointment.id !== input.excludeAppointmentId &&
        overlaps(appointment, span),
    )
    .map((appointment) => ({
      kind: 'APPOINTMENT',
      id: appointment.id,
      customerName: appointment.customer?.name ?? null,
      serviceNames: appointment.services.map((service) => service.name),
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
    }));

  const periods: Conflict[] = input.periods
    .filter((period) => overlaps(period, span))
    .map((period) => ({
      kind: 'UNAVAILABLE_PERIOD',
      id: period.id,
      reason: period.reason,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
    }));

  return [...appointments, ...periods].sort(byStartThenId);
}

/**
 * The fingerprint of everything the warning shows (D-024, FR-038): sorted
 * before hashing, so the order is irrelevant, and built from what is shown, so
 * any change the owner would see changes it. Not a secret; it authorises
 * nothing. The hash is a port: `node:crypto` stays out of the domain.
 */
export function computeStateToken(
  conflicts: readonly Conflict[],
  hash: (input: string) => string,
): string {
  const shown = [...conflicts].sort(byStartThenId).map((conflict) => {
    const common = [conflict.kind, conflict.id, conflict.startsAt.toString(), conflict.endsAt.toString()];
    return conflict.kind === 'APPOINTMENT'
      ? [...common, conflict.customerName, conflict.serviceNames]
      : [...common, conflict.reason];
  });
  return hash(JSON.stringify(shown));
}

export type AcknowledgementError =
  /** An appointment in the way is left unacknowledged (FR-022). */
  | 'UNRESOLVED_CONFLICT'
  /** It acknowledges something that is not in the way. */
  | 'UNKNOWN_TARGET';

/**
 * Blocking time over appointments (FR-022): every one of them acknowledged,
 * none cancelled. Returns the acknowledged ids in the conflicts' order.
 */
export function checkAcknowledgement(
  conflicts: readonly Conflict[],
  acknowledged: readonly AppointmentId[],
): Result<readonly AppointmentId[], AcknowledgementError> {
  const inTheWay = conflicts.filter((conflict) => conflict.kind === 'APPOINTMENT').map((conflict) => conflict.id);
  const given = new Set(acknowledged);

  if ([...given].some((id) => !inTheWay.includes(id))) return err('UNKNOWN_TARGET');
  if (inTheWay.some((id) => !given.has(id))) return err('UNRESOLVED_CONFLICT');
  return ok(inTheWay);
}
