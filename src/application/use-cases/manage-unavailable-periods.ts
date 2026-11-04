import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { AppointmentId } from '@/domain/booking/appointment';
import type { UnavailablePeriod, UnavailablePeriodId } from '@/domain/catalog/salon';
import { computeStateToken, detectConflicts, type Conflict } from '@/domain/owner/conflict';
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
  OwnerAppointmentWriter,
  SalonConfigRepository,
  StateHasher,
  UnavailablePeriodRepository,
} from '../ports';
import { proposeOrApply, withReplanning } from './owner-change-protocol';

/**
 * Blocking, shortening and releasing the owner's time (002, Historia 3).
 *
 * A new period takes its starts away from the client in the very next query,
 * with nothing cached in between (FR-056, SC-003). One that lands on confirmed
 * appointments is not saved until the owner has seen them: the first call
 * answers with them and a `stateToken`, and only a second one that returns
 * the same token and acknowledges or cancels every one of them saves it
 * (FR-022, D-024). Acknowledging cancels nobody; cancelling goes in the same
 * transaction as the block, through the protocol of Historia 6 (T116).
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
    }
  /** The state changed twice in a row under the owner's answer. */
  | { readonly kind: 'STATE_CHANGED' };

export type ShortenPeriodRejection =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'INVALID'; readonly reason: PeriodRejection };

export function createManageUnavailablePeriods(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly periods: UnavailablePeriodRepository;
  readonly writer: OwnerAppointmentWriter;
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
      readonly cancelAppointments?: readonly AppointmentId[] | undefined;
    }): Promise<Result<PeriodSaved, CreatePeriodRejection>> {
      const zone = await timezone();
      const span = validatePeriod({ ...input, now: deps.clock.now(), timezone: zone });
      if (!span.ok) return err({ kind: 'INVALID', reason: span.error });

      const id = randomUUID();
      const reason = normalizePeriodReason(input.reason ?? null);
      const answer = {
        stateToken: input.stateToken,
        resolution: {
          acknowledgeAppointments: input.acknowledgeAppointments ?? [],
          cancelAppointments: input.cancelAppointments ?? [],
        },
      };

      const result = await withReplanning(answer, async (current) => {
        const appointments = await deps.appointments.findInWindow(span.value.startsAt, span.value.endsAt, {
          includeCancelled: false,
        });
        // Another period underneath is no conflict: two blocks overlapping are harmless (D-019).
        const conflicts = detectConflicts({ ...span.value, appointments, periods: [] });
        return proposeOrApply(deps, {
          intent: { kind: 'CREATE_PERIOD', id, ...span.value, reason },
          conflicts,
          warnings: [],
          answer: current,
          now: deps.clock.now(),
          timezone: zone,
        });
      });

      if (result.ok) {
        if (result.value.kind !== 'PERIOD') throw new Error('a period plan applied something else');
        return ok({ period: result.value.period, timezone: zone });
      }
      const failure = result.error;
      if (failure.kind === 'STATE_CHANGED') return err(failure);
      if (failure.kind === 'CONFLICT') {
        return err({ kind: 'CONFLICT', conflicts: failure.conflicts, stateToken: failure.stateToken, timezone: zone });
      }
      // Naming what is not in the way is a question still open, as before Historia 6.
      const fresh = await deps.appointments.findInWindow(span.value.startsAt, span.value.endsAt, {
        includeCancelled: false,
      });
      const conflicts = detectConflicts({ ...span.value, appointments: fresh, periods: [] });
      return err({ kind: 'CONFLICT', conflicts, stateToken: computeStateToken(conflicts, deps.stateHash), timezone: zone });
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
