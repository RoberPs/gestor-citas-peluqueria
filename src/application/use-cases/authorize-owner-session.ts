import { isSessionAlive, shouldTouchSession } from '@/domain/owner/session';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import type { OwnerSessionRepository, TokenGenerator } from '../ports';

/**
 * The guard every owner handler and screen goes through, first (002, FR-002,
 * D-018). It resolves the cookie's token to a live session or answers
 * `UNAUTHENTICATED`, before any use case has started: an action that arrives
 * with an idle session is not applied, not even in part (FR-007).
 */

export type OwnerSessionContext = {
  readonly sessionId: string;
  readonly accountId: string;
  /** To keep this session when the others are closed (FR-004). */
  readonly tokenHash: Uint8Array;
};

export function createAuthorizeOwnerSession(deps: {
  readonly sessions: OwnerSessionRepository;
  readonly tokens: TokenGenerator;
  readonly clock: Clock;
}) {
  return async function authorizeOwnerSession(
    token: string | undefined,
  ): Promise<Result<OwnerSessionContext, 'UNAUTHENTICATED'>> {
    if (token === undefined || token === '') return err('UNAUTHENTICATED');

    const tokenHash = deps.tokens.hash(token);
    const session = await deps.sessions.findByTokenHash(tokenHash);
    const now = deps.clock.now();

    if (session === null || !isSessionAlive(session.lastSeenAt, now)) return err('UNAUTHENTICATED');

    if (shouldTouchSession(session.lastSeenAt, now)) await deps.sessions.touch(session.id, now);

    return ok({ sessionId: session.id, accountId: session.accountId, tokenHash });
  };
}
