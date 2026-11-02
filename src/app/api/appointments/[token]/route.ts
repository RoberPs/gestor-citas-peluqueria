import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { jsonOk, neutralNotFound } from '../../_lib/responses';
import { appointmentDetailResponse } from '../../_lib/serializers';

export const dynamic = 'force-dynamic';

/**
 * Opening the management link.
 *
 * Two things here are deliberate and easy to undo by accident:
 *
 * 1. **The lookup always runs** — for a malformed token, and even when the
 *    per-IP limit has already been hit. Short-circuiting either would make the
 *    response faster in one case than the other, and that timing difference is
 *    itself the signal FR-038 forbids.
 * 2. **The limit answers with the same 404 as everything else** (D-006). No
 *    `429`, no `Retry-After`, no rate-limit header: any of them would tell
 *    whoever is probing links that the system is counting their attempts.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const clientIp = resolveClientIp({
    forwardedFor: request.headers.get('x-forwarded-for'),
    remoteAddress: null,
  });
  const { allowed } = await rateLimiter().check('APPOINTMENT_LOOKUP', clientIp);

  const detail = await container().viewAppointment(token);

  if (!allowed || detail === null) return neutralNotFound();

  return jsonOk(appointmentDetailResponse(detail));
}
