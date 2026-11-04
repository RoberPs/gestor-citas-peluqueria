import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { neutralNotFound } from '../../../../_lib/responses';

export const dynamic = 'force-dynamic';

/**
 * Stop receiving emails about this appointment, from its management link
 * (004, FR-017). Always harmless: done, already done or never asked for, it is
 * a 204 (FR-016). The appointment does not change, cancelled or past included.
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

  const result = await container().revokeEmailConsent.byManagementToken(token);
  if (!result.ok) return neutralNotFound();

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
