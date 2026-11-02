import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { container } from '@/app/_lib/container';
import type { BookingRejection } from '@/domain/booking/confirm';
import { normalizeEmail, normalizePhone, validateName } from '@/domain/contact/contact';
import { localDateOf } from '@/domain/shared/time';
import { resolveClientIp } from '@/infrastructure/config/env';
import { logger } from '@/infrastructure/logging/logger';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { messages, withPhone } from '@/messages/es-ES';
import { jsonError, jsonErrorWith, type ApiError } from '../_lib/responses';
import { availabilityResponse } from '../_lib/serializers';

export const dynamic = 'force-dynamic';

/**
 * Zod checks the **shape**; the format rules come from the domain through
 * `refine` (D-009). "A valid Spanish phone number" is a business rule, and a
 * second copy of it living in this schema is exactly what Principio I forbids.
 *
 * `strict()` is how FR-008 is enforced at the boundary: a fourth personal field
 * is rejected rather than quietly ignored.
 */
const customerSchema = z
  .object({
    name: z.string().refine((value) => validateName(value).ok),
    phone: z.string().refine((value) => normalizePhone(value).ok),
    email: z.string().refine((value) => normalizeEmail(value).ok),
  })
  .strict();

const bodySchema = z
  .object({
    serviceId: z.string().uuid(),
    startsAt: z.string().min(1),
    customer: customerSchema,
  })
  .strict();

function validationError(
  fields: readonly { field: string; message: string }[],
  error: ApiError = { code: 'VALIDATION_ERROR', ...messages.errors.invalidContact },
): Response {
  return jsonErrorWith(400, error, { fields });
}

/**
 * Turns a domain rejection into the wire vocabulary of the contract.
 *
 * `NOT_ON_GRID` and `BEYOND_HORIZON` have no user scenario: only a tampered
 * request produces them. To the client they mean the same thing as
 * `OUTSIDE_OPENING_HOURS` — that start is not one the salon offers — so they
 * are answered the same way, with the current availability attached.
 */
function conflictFor(rejection: BookingRejection): { code: string; error: ApiError } {
  switch (rejection.kind) {
    case 'SLOT_TAKEN':
      return { code: 'SLOT_TAKEN', error: { code: 'SLOT_TAKEN', ...messages.errors.slotTaken } };
    case 'TOO_LATE_TO_BOOK':
      return {
        code: 'TOO_LATE_TO_BOOK',
        error: { code: 'TOO_LATE_TO_BOOK', ...messages.errors.tooLateToBook },
      };
    default:
      return {
        code: 'OUTSIDE_OPENING_HOURS',
        error: { code: 'OUTSIDE_OPENING_HOURS', ...messages.errors.outsideOpeningHours },
      };
  }
}

/** The availability of the day that was asked for, so the client picks again in place. */
async function availabilityFor(serviceId: string, startsAt: string, timezone: string) {
  const { getAvailability } = container();

  let selectedDate: string | undefined;
  try {
    selectedDate = localDateOf(Temporal.Instant.from(startsAt), timezone).toString();
  } catch {
    selectedDate = undefined;
  }

  const onThatDay =
    selectedDate === undefined
      ? null
      : await getAvailability({ serviceId, rangeStart: selectedDate, selectedDate });

  if (onThatDay !== null && onThatDay.ok) return availabilityResponse(onThatDay.value);

  const fallback = await getAvailability({ serviceId });
  return fallback.ok ? availabilityResponse(fallback.value) : null;
}

export async function POST(request: Request): Promise<Response> {
  const { salon } = await container().config.load();

  // FR-039: unlike the link limit, this one is explained. Whoever reaches it is
  // almost always a legitimate client behind a shared IP.
  const clientIp = resolveClientIp({
    forwardedFor: request.headers.get('x-forwarded-for'),
    remoteAddress: null,
  });
  const { allowed } = await rateLimiter().check('BOOKING_CONFIRMATION', clientIp);
  if (!allowed) {
    return jsonError(429, {
      code: 'TOO_MANY_BOOKINGS',
      message: messages.errors.tooManyBookings.message,
      nextAction: withPhone(messages.errors.tooManyBookings.nextAction, salon.phone),
    });
  }

  const payload: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(payload);

  if (!parsed.success) {
    const fields = parsed.error.issues
      .filter((issue) => issue.path[0] === 'customer' && typeof issue.path[1] === 'string')
      .map((issue) => {
        const field = `customer.${String(issue.path[1])}`;
        const code =
          issue.path[1] === 'name'
            ? 'INVALID_NAME'
            : issue.path[1] === 'phone'
              ? 'INVALID_PHONE'
              : 'INVALID_EMAIL';
        return { field, message: messages.errors.contactField[code] };
      });

    return fields.length > 0
      ? validationError(fields)
      : validationError([], { code: 'INVALID_REQUEST', ...messages.errors.rangeOutOfBounds });
  }

  const result = await container().confirmBooking({
    serviceId: parsed.data.serviceId,
    startsAt: parsed.data.startsAt,
    contact: parsed.data.customer,
  });

  if (result.ok) {
    // The trace references the internal id and nothing else. It never appears
    // in a client URL, and the three personal fields never appear here
    // (FR-036); the logger redacts them even if a future edit slips one in.
    logger().info({ appointmentId: result.value.appointment.id }, 'booking confirmed');

    // POST-Redirect-GET (D-010): reloading the confirmation repeats an
    // idempotent GET, so it cannot create a second appointment.
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/cita/${result.value.token}?nueva=1`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const failure = result.error;

  logger().warn(
    {
      reason: failure.kind,
      rejection: failure.kind === 'REJECTED' ? failure.rejection.kind : undefined,
    },
    'booking rejected',
  );

  if (failure.kind === 'UNKNOWN_SERVICE' || failure.kind === 'INVALID_START') {
    return validationError([], { code: 'INVALID_REQUEST', ...messages.errors.unknownService });
  }

  if (failure.kind === 'CONTACT_LIMIT_REACHED') {
    return jsonError(422, {
      code: 'CONTACT_LIMIT_REACHED',
      message: messages.errors.contactLimitReached.message,
      nextAction: withPhone(messages.errors.contactLimitReached.nextAction, salon.phone),
    });
  }

  if (failure.rejection.kind === 'INVALID_CONTACT') {
    return validationError(
      failure.rejection.fields.map((field) => ({
        field: field.field,
        message: messages.errors.contactField[field.code],
      })),
    );
  }

  const conflict = conflictFor(failure.rejection);
  const availability = await availabilityFor(
    parsed.data.serviceId,
    parsed.data.startsAt,
    salon.timezone,
  );

  return jsonErrorWith(409, conflict.error, { availability });
}
