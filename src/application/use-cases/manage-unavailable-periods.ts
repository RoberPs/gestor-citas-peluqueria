import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { AppointmentId } from '@/domain/booking/appointment';
import type { UnavailablePeriod, UnavailablePeriodId } from '@/domain/catalog/salon';
import {
  checkAcknowledgement,
  computeStateToken,
  detectConflicts,
  type Conflict,
} from '@/domain/owner/conflict';
import {
  normalizePeriodReason,
  validatePeriod,
  validateShortening,
  type PeriodRejection,
} from '@/domain/owner/unavailable-period';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import type {
  AppointmentRepository,
  SalonConfigRepository,
  StateHasher,
  UnavailablePeriodRepository,
} from '../ports';

/**
 * Blocking, shortening and releasing the owner's time (002, Historia 3).
 *
 * A new period takes its starts away from the client in the very next query,
 * with nothing cached in between (FR-056, SC-003). One that lands on confirmed
 * appointments is not saved until the owner has seen them: the first call
 * answers with them and a `stateToken`, and only a second one that returns
 * the same token and acknowledges every one of them saves it (FR-022, D-024).
 * Acknowledging cancels nobody. Cancelling from this warning instead belongs
 * to the conflict resolution of Historia 6.
 */

export type PeriodSaved = {
  readonly period: UnavailablePeriod;
  readonly timezone: string;
};

export type CreatePeriodRejection =
  | { readonly kind: 'INVALID'; readonly reason: Exclude<PeriodRejection, 'NOT_CONTAINED'> }
  | {
      readonly kind: 'CONFLICT';
      readonly conflicts: readonly Conflict[];
      readonly stateToken: string;
      readonly timezone: string;
    };

export type ShortenPeriodRejection =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'INVALID'; readonly reason: PeriodRejection };

export function createManageUnavailablePeriods(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly periods: UnavailablePeriodRepository;
  readonly stateHash: StateHasher;
  readonly clock: Clock;
}) {
  async function timezone(): Promise<string> {
    return (await deps.config.load()).salon.timezone;
  }

  return {
    /** The periods that touch `[from, to)`, in one query (D-027). */
    async list(input: {
      readonly from: Temporal.Instant;
      readonly to: Temporal.Instant;
    }): Promise<Result<{ readonly periods: readonly UnavailablePeriod[]; readonly timezone: string }, 'INVALID_WINDOW'>> {
      if (Temporal.Instant.compare(input.from, input.to) >= 0) return err('INVALID_WINDOW');
      const [periods, zone] = await Promise.all([deps.periods.findOverlapping(input.from, input.to), timezone()]);
      return ok({ periods, timezone: zone });
    },

    async create(input: {
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
      readonly reason?: string | null | undefined;
      readonly stateToken?: string | undefined;
      readonly acknowledgeAppointments?: readonly AppointmentId[] | undefined;
    }): Promise<Result<PeriodSaved, CreatePeriodRejection>> {
      const zone = await timezone();
      const span = validatePeriod({ ...input, now: deps.clock.now(), timezone: zone });
      if (!span.ok) return err({ kind: 'INVALID', reason: span.error });

      const appointments = await deps.appointments.findInWindow(span.value.startsAt, span.value.endsAt, {
        includeCancelled: false,
      });
      // Another period underneath is no conflict: two blocks overlapping are harmless (D-019).
      const conflicts = detectConflicts({ ...span.value, appointments, periods: [] });

      if (conflicts.length > 0) {
        const stateToken = computeStateToken(conflicts, deps.stateHash);
        const acknowledged = checkAcknowledgement(conflicts, input.acknowledgeAppointments ?? []);
        if (input.stateToken !== stateToken || !acknowledged.ok) {
          return err({ kind: 'CONFLICT', conflicts, stateToken, timezone: zone });
        }
      }

      const period = await deps.periods.insert({
        id: randomUUID(),
        ...span.value,
        reason: normalizePeriodReason(input.reason ?? null),
      });
      return ok({ period, timezone: zone });
    },

    /** FR-019: makes room without deleting it. Its reason stays. */
    async shorten(input: {
      readonly id: UnavailablePeriodId;
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
    }): Promise<Result<PeriodSaved, ShortenPeriodRejection>> {
      const [current, zone] = await Promise.all([deps.periods.findById(input.id), timezone()]);
      if (current === null) return err({ kind: 'NOT_FOUND' });

      const span = validateShortening({ ...input, current, now: deps.clock.now(), timezone: zone });
      if (!span.ok) return err({ kind: 'INVALID', reason: span.error });

      const period = await deps.periods.shorten(input.id, span.value.startsAt, span.value.endsAt);
      return period === null ? err({ kind: 'NOT_FOUND' }) : ok({ period, timezone: zone });
    },

    /** The starts come back in the client's next query (SC-003). */
    async remove(id: UnavailablePeriodId): Promise<Result<null, 'NOT_FOUND'>> {
      return (await deps.periods.delete(id)) ? ok(null) : err('NOT_FOUND');
    },
  };
}
