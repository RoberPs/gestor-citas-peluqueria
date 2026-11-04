import { z } from 'zod';
import { container } from '@/app/_lib/container';
import { messages } from '@/messages/es-ES';
import { jsonError } from '../../_lib/responses';
import { requireOwnerSession } from '../_lib/require-owner-session';
import { expiredSessionCookie, sessionCookie, sessionTokenOf } from '../_lib/session-cookie';

export const dynamic = 'force-dynamic';

/** The lengths of owner-api.yaml. The password never reaches a log (FR-010). */
const signInSchema = z
  .object({
    username: z.string().min(1).max(120),
    password: z.string().min(1).max(200),
  })
  .strict();

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function badRequest(): Response {
  return jsonError(400, { code: 'BAD_REQUEST', ...messages.owner.errors.badRequest });
}

/**
 * Signing in: the only owner route with no session before it (FR-002).
 *
 * Every rejection is one and the same response — status, body and headers —
 * for an unknown user, a wrong password and a locked account, with no
 * `Retry-After` or anything that would betray a limit (FR-008, FR-009).
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = signInSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest();

  const result = await container().signInOwner(parsed.data);
  if (!result.ok) {
    return jsonError(401, { code: 'SIGN_IN_REJECTED', ...messages.owner.errors.signInRejected });
  }

  return new Response(null, {
    status: 204,
    headers: { ...NO_STORE, 'Set-Cookie': sessionCookie(result.value.token) },
  });
}

/** Signing out deletes the row and expires the cookie (FR-006). */
export async function DELETE(request: Request): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  await container().signOutOwner(sessionTokenOf(request));

  return new Response(null, {
    status: 204,
    headers: { ...NO_STORE, 'Set-Cookie': expiredSessionCookie() },
  });
}
