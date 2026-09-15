import { z } from 'zod';
import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { messages, withPhone } from '@/messages/es-ES';
import { jsonError, jsonOk, neutralNotFound } from '../../../_lib/responses';
import { appointmentDetailResponse, reasonFor } from '../../../_lib/serializers';

export const dynamic = 'force-dynamic';

/**
 * The confirmation FR-022 asks for is taken in the interface; the body restates
 * it so a stray request cannot cancel anything by accident.
 */
const bodySchema = z.object({ confirmed: z.literal(true) }).strict();

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

  const payload: unknown = await request.json().catch(() => null);
  if (!bodySchema.safeParse(payload).success) {
    return jsonError(400, {
      code: 'CONFIRMATION_REQUIRED',
      message: messages.cancellation.confirmTitle,
      nextAction: messages.cancellation.confirmQuestion,
    });
  }

  const result = await container().cancelAppointment(token);

  if (result.ok) return jsonOk(appointmentDetailResponse(result.value));

  // A link that resolves to nothing gets the same answer here as anywhere else.
  if (result.error.kind === 'NOT_FOUND') return neutralNotFound();

  const { salon, policy } = await container().config.load();
  // The wording follows the domain's block, never an `if` here (FR-028).
  const reason = reasonFor(result.error.block, policy.cancellationDeadlineHours, salon.phone);

  return jsonError(409, {
    code: result.error.block.kind,
    message: messages.cancellation.blocked,
    nextAction: reason ?? withPhone(messages.errors.unexpected.nextAction, salon.phone),
  });
}
