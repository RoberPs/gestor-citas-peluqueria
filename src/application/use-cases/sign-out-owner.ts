import type { OwnerSessionRepository, TokenGenerator } from '../ports';

/**
 * Signing out deletes the session row (002, FR-006). Nothing marks it, so
 * nothing can bring it back: going back in the browser finds no session.
 * Idempotent: signing out twice, or with no session, is not an error.
 */
export function createSignOutOwner(deps: {
  readonly sessions: OwnerSessionRepository;
  readonly tokens: TokenGenerator;
}) {
  return async function signOutOwner(token: string | undefined): Promise<void> {
    if (token === undefined || token === '') return;
    await deps.sessions.deleteByTokenHash(deps.tokens.hash(token));
  };
}
