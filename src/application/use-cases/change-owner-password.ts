import { validateNewPassword } from '@/domain/owner/account';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import type { OwnerAccountRepository, OwnerSessionRepository, PasswordHasher } from '../ports';
import type { OwnerSessionContext } from './authorize-owner-session';

/**
 * The owner changes her password from inside her session (002, FR-004).
 *
 * Unlike signing in, the two failures are told apart: whoever gets here
 * already holds a live session, so FR-008's indistinguishability is not at
 * stake, and a vague message would only confuse her. A change closes every
 * other session and keeps this one.
 */

export type ChangePasswordFailure = 'WRONG_CURRENT_PASSWORD' | 'TOO_SHORT';

export function createChangeOwnerPassword(deps: {
  readonly accounts: OwnerAccountRepository;
  readonly sessions: OwnerSessionRepository;
  readonly passwords: PasswordHasher;
  readonly clock: Clock;
}) {
  return async function changeOwnerPassword(
    session: OwnerSessionContext,
    input: { readonly current: string; readonly next: string },
  ): Promise<Result<void, ChangePasswordFailure>> {
    const account = await deps.accounts.findById(session.accountId);
    if (account === null || !(await deps.passwords.verify(input.current, account.passwordHash))) {
      return err('WRONG_CURRENT_PASSWORD');
    }

    const next = validateNewPassword(input.next);
    if (!next.ok) return next;

    await deps.accounts.updatePassword(account.id, await deps.passwords.hash(next.value), deps.clock.now());
    await deps.sessions.deleteAllExcept(account.id, session.tokenHash);

    return ok(undefined);
  };
}
