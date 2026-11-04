import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { container } from '@/app/_lib/container';
import type { OwnerSessionContext } from '@/application/use-cases/authorize-owner-session';
import { OWNER_SESSION_COOKIE } from '@/app/api/gestion/_lib/session-cookie';

/**
 * The guard at the top of every owner screen (002, FR-002, D-018), the twin of
 * `requireOwnerSession` for Route Handlers. Without a live session it sends to
 * the sign-in form before a single query about the salon has run, so nothing
 * of the agenda or of any client is rendered, not even for a moment.
 */
export async function requireOwnerPage(): Promise<OwnerSessionContext> {
  const token = (await cookies()).get(OWNER_SESSION_COOKIE)?.value;
  const session = await container().authorizeOwnerSession(token);
  if (!session.ok) redirect('/gestion/acceso');
  return session.value;
}

/** Whether there is a live session, for the sign-in screen to skip itself. */
export async function hasOwnerSession(): Promise<boolean> {
  const token = (await cookies()).get(OWNER_SESSION_COOKIE)?.value;
  return (await container().authorizeOwnerSession(token)).ok;
}
