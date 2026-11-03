import { randomUUID } from 'node:crypto';
import { evaluateLockout, registerFailure } from '@/domain/owner/account';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import type {
  OwnerAccountRepository,
  OwnerSessionRepository,
  PasswordHasher,
  TokenGenerator,
} from '../ports';

/**
 * Signing the owner in (002, Historia 1).
 *
 * There is ONE failure, `REJECTED`, for an unknown user, a wrong password and a
 * locked account alike (FR-008, FR-009): the type itself cannot tell them
 * apart, so no handler can. And every path derives a scrypt key — the real one,
 * or the decoy — so the time it takes does not tell them apart either (D-017).
 */

export type SignInFailure = 'REJECTED';

export function createSignInOwner(deps: {
  readonly accounts: OwnerAccountRepository;
  readonly sessions: OwnerSessionRepository;
  readonly passwords: PasswordHasher;
  readonly tokens: TokenGenerator;
  readonly clock: Clock;
}) {
  return async function signInOwner(input: {
    readonly username: string;
    readonly password: string;
  }): Promise<Result<{ readonly token: string }, SignInFailure>> {
    const now = deps.clock.now();
    const account = await deps.accounts.findByUsername(input.username);

    if (account === null) {
      await deps.passwords.verifyDecoy(input.password);
      return err('REJECTED');
    }

    // Asked before comparing anything: while locked, not even the right
    // password gets in (data-model.md, "Bloqueo de la cuenta").
    if (evaluateLockout({ ...account.lockout, now }).isLocked) {
      await deps.passwords.verifyDecoy(input.password);
      return err('REJECTED');
    }

    if (!(await deps.passwords.verify(input.password, account.passwordHash))) {
      await deps.accounts.saveLockout(account.id, registerFailure({ ...account.lockout, now }));
      return err('REJECTED');
    }

    if (account.lockout.failedAttempts > 0 || account.lockout.lockedUntil !== null) {
      await deps.accounts.saveLockout(account.id, {
        failedAttempts: 0,
        firstFailedAttemptAt: null,
        lockedUntil: null,
      });
    }

    const { token, hash } = deps.tokens.generate();
    await deps.sessions.create({ id: randomUUID(), accountId: account.id, tokenHash: hash, at: now });

    return ok({ token });
  };
}
