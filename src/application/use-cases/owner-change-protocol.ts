import type { Temporal } from '@js-temporal/polyfill';
import {
  buildResolutionPlan,
  computeStateToken,
  type Conflict,
  type Resolution,
  type ResolutionIntent,
} from '@/domain/owner/conflict';
import type { ManualBookingWarning } from '@/domain/owner/manual-booking';
import { err, type Result } from '@/domain/shared/result';
import type { AppliedPlan, OwnerAppointmentWriter, StateHasher } from '../ports';

/**
 * The two-step protocol of the owner's changes (002, Historia 6, D-023, D-024).
 *
 * The first call carries no answer: whatever is in the way, and whatever only
 * warns, comes back named with a `stateToken`, and nothing has been touched
 * (FR-036). The second returns that token, a resolution and the warnings
 * acknowledged, and the plan is applied whole or not at all (FR-037). If the
 * state changed in between, the caller plans again on what there is now and
 * the owner is asked again (FR-038).
 */

export type OwnerAnswer = {
  readonly stateToken?: string | undefined;
  readonly resolution?: Resolution | undefined;
  readonly acknowledgedWarnings?: readonly string[] | undefined;
};

export type ProtocolRejection =
  | {
      readonly kind: 'CONFLICT';
      /** The span the owner asked for: what a shortening has to leave room for. */
      readonly span: { readonly startsAt: Temporal.Instant; readonly endsAt: Temporal.Instant };
      readonly conflicts: readonly Conflict[];
      readonly warnings: readonly ManualBookingWarning[];
      readonly stateToken: string;
    }
  /** A resolution that names what is not in the way, or a shortening that leaves no room. */
  | { readonly kind: 'RESOLUTION_REJECTED'; readonly reason: 'UNKNOWN_TARGET' | 'SHORTENING_DOES_NOT_FIT' };

export async function proposeOrApply(
  deps: { readonly writer: OwnerAppointmentWriter; readonly stateHash: StateHasher },
  input: {
    readonly intent: ResolutionIntent;
    readonly conflicts: readonly Conflict[];
    readonly warnings: readonly ManualBookingWarning[];
    readonly answer: OwnerAnswer;
    readonly now: Temporal.Instant;
    readonly timezone: string;
  },
): Promise<Result<AppliedPlan, ProtocolRejection | { readonly kind: 'STATE_CHANGED' }>> {
  const { conflicts, warnings, answer } = input;
  const stateToken = computeStateToken(conflicts, deps.stateHash);
  const asked = (): Result<never, ProtocolRejection> => err({
      kind: 'CONFLICT',
      span: { startsAt: input.intent.startsAt, endsAt: input.intent.endsAt },
      conflicts,
      warnings,
      stateToken,
    });

  const acknowledged = answer.acknowledgedWarnings ?? [];
  if (warnings.some((warning) => !acknowledged.includes(warning))) return asked();
  if (conflicts.length > 0 && answer.stateToken !== stateToken) return asked();

  const plan = buildResolutionPlan({
    intent: input.intent,
    conflicts,
    resolution: answer.resolution ?? {},
    now: input.now,
    timezone: input.timezone,
  });
  if (!plan.ok) {
    // Leaving something in the way is not an error to report but a question still open.
    return plan.error === 'UNRESOLVED_CONFLICT' ? asked() : err({ kind: 'RESOLUTION_REJECTED', reason: plan.error });
  }

  const applied = await deps.writer.applyPlan(plan.value, stateToken);
  return applied.ok ? applied : err({ kind: 'STATE_CHANGED' });
}

/**
 * Plans and proposes; if the state changed under the owner's feet, plans once
 * more on what there is now, keeping only her acknowledged warnings: whatever
 * is in the way then is asked again, never resolved on her behalf (FR-038).
 */
export async function withReplanning<T, E>(
  answer: OwnerAnswer,
  attempt: (answer: OwnerAnswer) => Promise<Result<T, E | { readonly kind: 'STATE_CHANGED' }>>,
): Promise<Result<T, E | { readonly kind: 'STATE_CHANGED' }>> {
  const first = await attempt(answer);
  if (first.ok || !isStateChanged(first.error)) return first;
  return attempt({ acknowledgedWarnings: answer.acknowledgedWarnings });
}

function isStateChanged(error: unknown): error is { readonly kind: 'STATE_CHANGED' } {
  return (error as { kind?: string }).kind === 'STATE_CHANGED';
}
