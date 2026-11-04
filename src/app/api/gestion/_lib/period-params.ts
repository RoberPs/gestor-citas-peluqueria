import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import type { CreatePeriodRejection, ShortenPeriodRejection } from '@/application/use-cases/manage-unavailable-periods';
import { messages } from '@/messages/es-ES';
import type { ApiError } from '../../_lib/responses';

/**
 * The HTTP frontier of the periods (002, Historia 3): bodies and queries as
 * `owner-api.yaml` states them, and each rejection with what to do next.
 * What a valid period is, is the domain's call; here only the shape is.
 */

/** An ISO-8601 date-time with its offset, as an instant. */
export const instantSchema = z.string().transform((value, context) => {
  try {
    return Temporal.Instant.from(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'not a date-time' });
    return z.NEVER;
  }
});

export const periodSpanSchema = z.object({ startsAt: instantSchema, endsAt: instantSchema }).strict();

/**
 * Only `acknowledgeAppointments` is accepted as a resolution for now: cancelling
 * from this warning comes with the conflict resolution of Historia 6 (T116).
 */
export const createPeriodSchema = z
  .object({
    startsAt: instantSchema,
    endsAt: instantSchema,
    reason: z.string().max(200).nullable().optional(),
    stateToken: z.string().optional(),
    resolution: z.object({ acknowledgeAppointments: z.array(z.string().uuid()) }).strict().optional(),
  })
  .strict();

export const periodWindowSchema = z.object({ desde: instantSchema, hasta: instantSchema });

export const periodIdSchema = z.string().uuid();

export function invalidPeriod(rejection: Extract<CreatePeriodRejection | ShortenPeriodRejection, { kind: 'INVALID' }>): ApiError {
  return { code: rejection.reason, ...messages.owner.errors.period[rejection.reason] };
}

export const periodNotFound: ApiError = { code: 'NOT_FOUND', ...messages.owner.errors.periodNotFound };

export const malformedPeriod: ApiError = { code: 'BAD_REQUEST', ...messages.owner.errors.badRequest };
