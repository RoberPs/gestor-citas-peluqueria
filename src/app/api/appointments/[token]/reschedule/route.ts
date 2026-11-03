import { z } from 'zod';
import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { messages } from '@/messages/es-ES';
import { jsonError, jsonErrorWith, jsonOk, neutralNotFound } from '../../../_lib/responses';
import {
  appointmentDetailResponse,
  availabilityResponse,
  reasonFor,
} from '../../../_lib/serializers';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ startsAt: z.string().min(1) }).strict();

/**
 * Moving the appointment (Historia 6).
 *
 * The token does not change: the same link keeps working (FR-026). And if the
 * new slot is gone, the answer carries the current availability so the client
 * picks again without going back — while their original appointment sits
 * exactly where it was (FR-025, BR-006).
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

  const payload: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError(400, { code: 'INVALID_REQUEST', ...messages.booking.missingSlot });
  }

  const result = await container().rescheduleAppointment(token, parsed.data.startsAt);

  if (result.ok) {
    return jsonOk({
      ...appointmentDetailResponse(result.value.detail),
      unchanged: result.value.unchanged,
    });
  }

  const failure = result.error;

  if (failure.kind === 'NOT_FOUND') return neutralNotFound();

  if (failure.kind === 'INVALID_START') {
    return jsonError(400, { code: 'INVALID_REQUEST', ...messages.booking.missingSlot });
  }

  const { salon, policy } = await container().config.load();

  if (failure.kind === 'BLOCKED') {
    // The appointment itself is closed to changes. There is no alternative hour
    // to offer, so no availability travels with it — only the domain's reason.
    return jsonError(409, {
      code: failure.block.kind,
      message: messages.reschedule.blocked,
      nextAction:
        reasonFor(failure.block, policy.cancellationDeadlineHours, salon.phone) ??
        messages.appointment.bookAnother,
    });
  }

  const detail = await container().viewAppointment(token);
  const availability =
    detail === null
      ? null
      : await container().getAvailability({
          currentAppointment: {
            services: detail.appointment.services,
            startsAt: detail.appointment.startsAt,
          },
        });

  const code =
    failure.rejection.kind === 'SLOT_TAKEN'
      ? 'SLOT_TAKEN'
      : failure.rejection.kind === 'TOO_LATE_TO_BOOK'
        ? 'TOO_LATE_TO_BOOK'
        : 'OUTSIDE_OPENING_HOURS';

  const copy =
    code === 'SLOT_TAKEN'
      ? messages.reschedule.slotTaken
      : code === 'TOO_LATE_TO_BOOK'
        ? messages.errors.tooLateToBook
        : messages.errors.outsideOpeningHours;

  return jsonErrorWith(
    409,
    { code, ...copy },
    { availability: availability?.ok === true ? availabilityResponse(availability.value) : null },
  );
}
