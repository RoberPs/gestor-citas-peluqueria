import { Temporal } from '@js-temporal/polyfill';
import { err, ok, type Result } from '../shared/result';

/**
 * The sign-in lock of the one staff account (002, FR-009, D-017).
 *
 * Pure: it decides from the stored state and the injected clock, and stores
 * nothing. It is per account and never per origin — there is no address
 * anywhere in this file, nor in the table it describes.
 */

export const LOCKOUT_POLICY = {
  maxFailedAttempts: 5,
  windowMinutes: 15,
  lockMinutes: 15,
} as const;

export type LockoutState = {
  readonly failedAttempts: number;
  /** Start of the fifteen minute window. `null` exactly when there are no failures. */
  readonly firstFailedAttemptAt: Temporal.Instant | null;
  readonly lockedUntil: Temporal.Instant | null;
};

type AtMoment = LockoutState & { readonly now: Temporal.Instant };

function isBefore(a: Temporal.Instant, b: Temporal.Instant): boolean {
  return Temporal.Instant.compare(a, b) < 0;
}

export function evaluateLockout(input: AtMoment): {
  readonly isLocked: boolean;
  readonly windowExpired: boolean;
} {
  const windowEnd = input.firstFailedAttemptAt?.add({ minutes: LOCKOUT_POLICY.windowMinutes });

  return {
    // Only time lifts a lock. A correct password during it changes nothing:
    // otherwise whoever guessed right on the sixth try would walk past the
    // limit that is there to stop exactly them.
    isLocked: input.lockedUntil !== null && isBefore(input.now, input.lockedUntil),
    windowExpired: windowEnd === undefined || !isBefore(input.now, windowEnd),
  };
}

export function registerFailure(input: AtMoment): LockoutState {
  const { isLocked, windowExpired } = evaluateLockout(input);
  // A failure while locked is not counted: the lock is already as long as it gets.
  if (isLocked) return input;

  const failedAttempts = windowExpired ? 1 : input.failedAttempts + 1;
  const firstFailedAttemptAt =
    windowExpired || input.firstFailedAttemptAt === null ? input.now : input.firstFailedAttemptAt;

  return {
    failedAttempts,
    firstFailedAttemptAt,
    lockedUntil:
      failedAttempts >= LOCKOUT_POLICY.maxFailedAttempts
        ? input.now.add({ minutes: LOCKOUT_POLICY.lockMinutes })
        : null,
  };
}

/**
 * D-016: twelve characters and no composition rules, which is what NIST
 * recommends and what a non-technical owner can meet without writing it on a
 * note stuck to the mirror. Checked on the server, whatever the form said.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function validateNewPassword(password: string): Result<string, 'TOO_SHORT'> {
  // Counted in characters as a person sees them, not in UTF-16 units.
  return [...password].length < MIN_PASSWORD_LENGTH ? err('TOO_SHORT') : ok(password);
}
