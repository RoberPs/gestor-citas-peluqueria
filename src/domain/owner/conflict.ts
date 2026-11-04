import { Temporal } from '@js-temporal/polyfill';
import { overlaps } from '../availability/interval-math';
import type { Appointment, AppointmentId } from '../booking/appointment';
import type { UnavailablePeriod, UnavailablePeriodId } from '../catalog/salon';
import type { NonEmptyServiceList } from '../catalog/selection';
import type { ValidatedContact } from '../contact/contact';
import { err, ok, type Result } from '../shared/result';
import { validateShortening } from './unavailable-period';

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

/**
 * What the owner asked for, already planned and checked (D-023): the
 * operation the resolution goes with. A value; nothing here writes it.
 */
export type ResolutionIntent =
  | {
      readonly kind: 'CREATE_APPOINTMENT';
      readonly id: AppointmentId;
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
      readonly services: NonEmptyServiceList;
      readonly contact: ValidatedContact;
      readonly createdAt: Temporal.Instant;
    }
  | {
      readonly kind: 'RESCHEDULE_APPOINTMENT';
      readonly appointmentId: AppointmentId;
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
    }
  | {
      /** Historia 11: same start, maybe a longer span (D-035). */
      readonly kind: 'EDIT_APPOINTMENT';
      readonly appointmentId: AppointmentId;
      readonly startsAt: Temporal.Instant;
      /** Its end before the edit: only what lies beyond it can be in the way. */
      readonly previousEndsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
      readonly services: NonEmptyServiceList;
      readonly contact: ValidatedContact;
    }
  | {
      readonly kind: 'CREATE_PERIOD';
      readonly id: UnavailablePeriodId;
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
      readonly reason: string | null;
    };

/**
 * Where to look for what is in the way of an intent: its span, or for an
 * edit only what it grows into. Shortening or keeping an appointment as long
 * finds nothing — not even a period it already sat under, which a block over
 * it leaves on purpose (FR-022, FR-074). `null` is nothing to look at.
 */
export function conflictSpanOf(
  intent: ResolutionIntent,
): { readonly startsAt: Temporal.Instant; readonly endsAt: Temporal.Instant } | null {
  if (intent.kind !== 'EDIT_APPOINTMENT') return { startsAt: intent.startsAt, endsAt: intent.endsAt };
  return Temporal.Instant.compare(intent.endsAt, intent.previousEndsAt) > 0
    ? { startsAt: intent.previousEndsAt, endsAt: intent.endsAt }
    : null;
}

/** The appointment an intent changes, which does not get in its own way. */
export function ownAppointmentOf(intent: ResolutionIntent): AppointmentId | undefined {
  return intent.kind === 'RESCHEDULE_APPOINTMENT' || intent.kind === 'EDIT_APPOINTMENT' ? intent.appointmentId : undefined;
}

export type PeriodShortening = {
  readonly id: UnavailablePeriodId;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
};

/** What the owner chose. There is no field that means "keep both" (FR-035). */
export type Resolution = {
  readonly cancelAppointments?: readonly AppointmentId[];
  readonly deletePeriods?: readonly UnavailablePeriodId[];
  readonly shortenPeriods?: readonly PeriodShortening[];
  /** Only a new period may leave an appointment inside it, cancelling nobody (FR-022). */
  readonly acknowledgeAppointments?: readonly AppointmentId[];
};

/** The operation and everything applied with it, all or nothing (FR-037). */
export type ResolutionPlan = {
  readonly intent: ResolutionIntent;
  readonly cancelAppointments: readonly AppointmentId[];
  readonly deletePeriods: readonly UnavailablePeriodId[];
  readonly shortenPeriods: readonly PeriodShortening[];
  /** The owner's clock when she confirmed: the moment of its cancellations. */
  readonly at: Temporal.Instant;
};

export type ResolutionError = AcknowledgementError | 'SHORTENING_DOES_NOT_FIT';

/**
 * The heart of BR-001 and FR-035: a plan is valid only once everything in the
 * way is resolved. An appointment is cancelled — or, under a new period,
 * acknowledged —; a period is deleted or shortened until it leaves room.
 * Whether a shortening fits is decided here, not on the screen.
 */
export function buildResolutionPlan(input: {
  readonly intent: ResolutionIntent;
  readonly conflicts: readonly Conflict[];
  readonly resolution: Resolution;
  readonly now: Temporal.Instant;
  readonly timezone: string;
}): Result<ResolutionPlan, ResolutionError> {
  const { intent, conflicts, resolution } = input;
  const cancel = resolution.cancelAppointments ?? [];
  const remove = resolution.deletePeriods ?? [];
  const shorten = resolution.shortenPeriods ?? [];
  const acknowledged = intent.kind === 'CREATE_PERIOD' ? (resolution.acknowledgeAppointments ?? []) : [];

  const appointmentsInTheWay = conflicts.filter((conflict) => conflict.kind === 'APPOINTMENT');
  const periodsInTheWay = conflicts.filter((conflict) => conflict.kind === 'UNAVAILABLE_PERIOD');
  const shortenedIds = shorten.map((shortening) => shortening.id);
  const periodIds = [...remove, ...shortenedIds];

  const known = (ids: readonly string[], among: readonly Conflict[]) =>
    ids.every((id) => among.some((conflict) => conflict.id === id));
  if (
    !known([...cancel, ...acknowledged], appointmentsInTheWay) ||
    !known(periodIds, periodsInTheWay) ||
    new Set(periodIds).size !== periodIds.length
  ) {
    return err('UNKNOWN_TARGET');
  }

  const handled = new Set([...cancel, ...acknowledged, ...periodIds]);
  if (conflicts.some((conflict) => !handled.has(conflict.id))) return err('UNRESOLVED_CONFLICT');

  for (const shortening of shorten) {
    const current = periodsInTheWay.find((conflict) => conflict.id === shortening.id);
    if (current?.kind !== 'UNAVAILABLE_PERIOD') return err('UNKNOWN_TARGET');
    const valid = validateShortening({
      startsAt: shortening.startsAt,
      endsAt: shortening.endsAt,
      current: { id: current.id, startsAt: current.startsAt, endsAt: current.endsAt, reason: current.reason },
      now: input.now,
      timezone: input.timezone,
    });
    const span = conflictSpanOf(intent);
    if (!valid.ok || (span !== null && overlaps(shortening, span))) return err('SHORTENING_DOES_NOT_FIT');
  }

  return ok({ intent, cancelAppointments: cancel, deletePeriods: remove, shortenPeriods: shorten, at: input.now });
}

/**
 * The shortenings of a period in the way that leave room for `span`: what is
 * left of it before, and what is left after. None when `span` swallows it,
 * which can only be deleted. `buildResolutionPlan` still has the last word.
 */
export function shorteningsThatFit(
  period: UnavailablePeriod,
  span: { readonly startsAt: Temporal.Instant; readonly endsAt: Temporal.Instant },
): readonly PeriodShortening[] {
  const options: PeriodShortening[] = [];
  if (Temporal.Instant.compare(period.startsAt, span.startsAt) < 0) {
    options.push({ id: period.id, startsAt: period.startsAt, endsAt: span.startsAt });
  }
  if (Temporal.Instant.compare(span.endsAt, period.endsAt) < 0) {
    options.push({ id: period.id, startsAt: span.endsAt, endsAt: period.endsAt });
  }
  return options;
}
