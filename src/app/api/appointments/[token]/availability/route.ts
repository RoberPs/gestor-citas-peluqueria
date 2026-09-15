import { z } from 'zod';
import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { messages } from '@/messages/es-ES';
import { jsonError, jsonOk, neutralNotFound } from '../../../_lib/responses';
import { availabilityResponse, reasonFor } from '../../../_lib/serializers';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  rangeStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  selectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * The hours this appointment can move to (Historia 6).
 *
 * Same shape as `/availability`, with the two differences the story imposes:
 * the service is **not** a parameter — it comes from the appointment's frozen
 * snapshot (FR-024, D-011) — and the slot the appointment already holds is
 * offered, marked, and not counted as busy (FR-027).
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

  if (!detail.canReschedule) {
    return jsonError(409, {
      code: detail.block?.kind ?? 'CANNOT_RESCHEDULE',
      message: messages.reschedule.blocked,
      nextAction:
        reasonFor(detail.block, detail.policy.cancellationDeadlineHours, detail.salon.phone) ??
        messages.appointment.bookAnother,
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    rangeStart: url.searchParams.get('rangeStart') ?? undefined,
    selectedDate: url.searchParams.get('selectedDate') ?? undefined,
  });

  if (!parsed.success) {
    return jsonError(400, { code: 'INVALID_REQUEST', ...messages.errors.rangeOutOfBounds });
  }

  const result = await container().getAvailability({
    serviceId: detail.appointment.service.serviceId,
    rangeStart: parsed.data.rangeStart,
    selectedDate: parsed.data.selectedDate,
    currentAppointment: {
      service: detail.appointment.service,
      startsAt: detail.appointment.startsAt,
    },
  });

  if (!result.ok) {
    return jsonError(400, { code: 'RANGE_OUT_OF_BOUNDS', ...messages.errors.rangeOutOfBounds });
  }

  return jsonOk(availabilityResponse(result.value));
}
