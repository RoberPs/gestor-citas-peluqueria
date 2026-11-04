import { z } from 'zod';
import type { OwnerAppointmentFailure, OwnerAppointmentSaved } from '@/application/use-cases/manage-owner-appointments';
import { listOf, messages } from '@/messages/es-ES';
import { jsonError, jsonOk, type ApiError } from '../../_lib/responses';
import { instantSchema } from './period-params';
import { conflictDto, ownerAppointmentDto } from './serializers';

/**
 * The HTTP frontier of the owner's appointments (002, Historias 4, 5, 6 y 11):
 * bodies as `owner-api.yaml` states them, and every failure with what to do
 * next (FR-059). What a valid appointment is, is the domain's call.
 */

export const appointmentIdSchema = z.string().uuid();

const resolutionSchema = z
  .object({
    cancelAppointments: z.array(z.string().uuid()).optional(),
    deletePeriods: z.array(z.string().uuid()).optional(),
    shortenPeriods: z
      .array(z.object({ id: z.string().uuid(), startsAt: instantSchema, endsAt: instantSchema }).strict())
      .optional(),
    acknowledgeAppointments: z.array(z.string().uuid()).optional(),
  })
  .strict();

const answerShape = {
  stateToken: z.string().optional(),
  resolution: resolutionSchema.optional(),
  acknowledgedWarnings: z.array(z.string()).optional(),
};

export const customerSchema = z
  .object({ name: z.string(), phone: z.string(), email: z.string().nullable().optional() })
  .strict()
  .transform((customer) => ({ ...customer, email: customer.email ?? null }));

export const createAppointmentSchema = z
  .object({ serviceIds: z.array(z.string().uuid()), startsAt: instantSchema, customer: customerSchema, ...answerShape })
  .strict();

export const rescheduleSchema = z.object({ startsAt: instantSchema, ...answerShape }).strict();

export const cancellationSchema = z.object({ confirmed: z.literal(true) }).strict();

export const malformedAppointment: ApiError = { code: 'BAD_REQUEST', ...messages.owner.errors.badRequest };

/** The one translation of a saved appointment and of every failure to HTTP. */
export function appointmentResponse(
  result: { ok: true; value: OwnerAppointmentSaved } | { ok: false; error: OwnerAppointmentFailure },
  successStatus: 200 | 201,
): Response {
  if (result.ok) {
    const { appointment, now, timezone, notifyCustomer } = result.value;
    return jsonOk(
      { ...ownerAppointmentDto(appointment, now, timezone), ...(notifyCustomer === null ? {} : { notifyCustomer }) },
      successStatus,
    );
  }

  const failure = result.error;
  const reasons = messages.owner.errors.appointment;
  switch (failure.kind) {
    case 'NOT_FOUND':
      return jsonError(404, { code: 'NOT_FOUND', ...messages.owner.errors.appointmentNotFound });
    case 'INVALID_SELECTION':
      return jsonError(422, { code: failure.error.kind, ...reasons[failure.error.kind] });
    case 'INVALID_CONTACT': {
      const names = failure.fields.map((field) => messages.owner.errors.contactFieldNames[field.field]);
      const { message, nextAction } = messages.owner.errors.invalidContact;
      return jsonError(422, { code: 'INVALID_CONTACT', message: message.replace('{fields}', listOf(names)), nextAction });
    }
    case 'BLOCKED':
      return jsonError(422, { code: failure.reason, ...reasons[failure.reason] });
    case 'RESOLUTION_REJECTED':
      return jsonError(422, { code: failure.reason, ...reasons[failure.reason] });
    case 'STATE_CHANGED':
      return jsonError(409, { code: 'STATE_CHANGED', ...reasons.STATE_CHANGED });
    case 'CONFLICT': {
      const onlyWarnings = failure.conflicts.length === 0;
      return jsonOk(
        {
          code: onlyWarnings ? 'WARNING' : 'CONFLICT',
          ...(onlyWarnings ? messages.owner.errors.appointmentWarning : messages.owner.errors.appointmentConflict),
          conflicts: failure.conflicts.map((conflict) => conflictDto(conflict, failure.timezone)),
          stateToken: failure.stateToken,
          warnings: failure.warnings.map((code) => ({ code, message: messages.owner.errors.warnings[code] })),
        },
        409,
      );
    }
  }
}
