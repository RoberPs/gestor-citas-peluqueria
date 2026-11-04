import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { neutralNotFound } from '../../_lib/responses';

export const dynamic = 'force-dynamic';

/**
 * The one-click unsubscribe of the mail client (004, D-009, RFC 8058).
 *
 * Every email carries this URL in `List-Unsubscribe`, and the client's
 * «Cancelar suscripción» button POSTs `List-Unsubscribe=One-Click` to it. The
 * body says nothing this route needs, so it is not read. A `POST`, never a
 * `GET`: a link a virus scanner follows on its own must not unsubscribe anyone.
 *
 * Like every route with a token, it answers the per-IP limit with the neutral
 * 404 (001, FR-038), and the lookup runs anyway, so both take the same time.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const clientIp = resolveClientIp({
    forwardedFor: request.headers.get('x-forwarded-for'),
    remoteAddress: null,
  });
  const { allowed } = await rateLimiter().check('APPOINTMENT_LOOKUP', clientIp);
  if (!allowed) return neutralNotFound();

  const result = await container().revokeEmailConsent.byUnsubscribeToken(token);
  if (!result.ok) return neutralNotFound();

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
