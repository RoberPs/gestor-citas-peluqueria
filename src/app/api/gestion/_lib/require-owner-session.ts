import { container } from '@/app/_lib/container';
import type { OwnerSessionContext } from '@/application/use-cases/authorize-owner-session';
import { err, ok, type Result } from '@/domain/shared/result';
import { messages } from '@/messages/es-ES';
import { jsonError } from '../../_lib/responses';
import { sessionTokenOf } from './session-cookie';

/**
 * The guard at the top of EVERY owner Route Handler (002, FR-002, D-018).
 *
 * It lives in the handler and not in the middleware: the middleware only
 * redirects screens, and if it disappeared — or were bypassed, as
 * CVE-2025-29927 bypassed it — no response would leak a thing. Without a live
 * session the answer is the neutral `401` and the action is not applied.
 */
export async function requireOwnerSession(
  request: Request,
): Promise<Result<OwnerSessionContext, Response>> {
  const session = await container().authorizeOwnerSession(sessionTokenOf(request));
  return session.ok ? ok(session.value) : err(unauthorized());
}

/** The body of `Unauthorized` in owner-api.yaml: no data of any kind (SC-001). */
export function unauthorized(): Response {
  return jsonError(401, { code: 'UNAUTHENTICATED', ...messages.owner.errors.unauthenticated });
}
