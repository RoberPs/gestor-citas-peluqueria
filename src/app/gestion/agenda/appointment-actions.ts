'use server';

import { Temporal } from '@js-temporal/polyfill';
import { revalidatePath } from 'next/cache';
import type { OwnerAppointmentFailure, OwnerAppointmentSaved } from '@/application/use-cases/manage-owner-appointments';
import type { OwnerAnswer } from '@/application/use-cases/owner-change-protocol';
import { container } from '@/app/_lib/container';
import { appointmentIdSchema } from '@/app/api/gestion/_lib/appointment-params';
import { conflictDto, localTimeDto, type ConflictDto } from '@/app/api/gestion/_lib/serializers';
import type { ContactField } from '@/domain/contact/contact';
import { shorteningsThatFit, type PeriodShortening } from '@/domain/owner/conflict';
import type { Result } from '@/domain/shared/result';
import { instantFromWallTime } from '@/domain/shared/time';
import { listOf, messages } from '@/messages/es-ES';
import { requireOwnerPage } from '../_lib/require-owner-page';

/**
 * The owner's appointments from the agenda (002, Historias 4, 5 y 6).
 *
 * The forms send the salon's wall time and the instants are worked out here,
 * in the salon's zone (BR-015). What is in the way comes back named, with the
 * shortenings the domain says would leave room; the owner's answer goes back
 * in the same form, with the `stateToken` she was shown (D-024).
 */

export type ConflictOption = ConflictDto & {
  /** For a period: each shortening that leaves room, as the form sends it back. */
  readonly shortenings: readonly { readonly value: string; readonly from: string; readonly to: string }[];
};

export type AppointmentFormState =
  | { readonly kind: 'idle'; readonly values: Readonly<Record<string, string>> }
  | {
      readonly kind: 'saved';
      readonly values: Readonly<Record<string, string>>;
      /** FR-043: the phone to call when the client has a link and v1 tells them nothing. */
      readonly notifyPhone: string | null;
    }
  | {
      readonly kind: 'error';
      readonly values: Readonly<Record<string, string>>;
      readonly message: string;
      readonly nextAction: string;
      readonly fields: readonly ContactField[];
    }
  | {
      readonly kind: 'conflict';
      readonly values: Readonly<Record<string, string>>;
      readonly message: string;
      readonly nextAction: string;
      readonly conflicts: readonly ConflictOption[];
      readonly warnings: readonly { readonly code: string; readonly message: string }[];
      readonly stateToken: string;
    };

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function all(form: FormData, name: string): string[] {
  return form.getAll(name).filter((value): value is string => typeof value === 'string');
}

function valuesOf(form: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, text(form, name)]));
}

/** A shortening travels as `start/end`, two ISO instants. */
function shorteningValue(shortening: PeriodShortening): string {
  return `${shortening.startsAt.toString()}/${shortening.endsAt.toString()}`;
}

/** The owner's answer to the dialog, present only once she confirmed it. */
function answerOf(form: FormData): OwnerAnswer {
  if (text(form, 'confirmar') !== '1') return {};

  const deletePeriods: string[] = [];
  const shortenPeriods: PeriodShortening[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('periodo:') || typeof value !== 'string') continue;
    const id = name.slice('periodo:'.length);
    if (value === 'eliminar') {
      deletePeriods.push(id);
    } else {
      const [from, to] = value.split('/');
      try {
        shortenPeriods.push({ id, startsAt: Temporal.Instant.from(from ?? ''), endsAt: Temporal.Instant.from(to ?? '') });
      } catch {
        // An unreadable choice is no choice: the plan will say what is left unresolved.
      }
    }
  }

  return {
    stateToken: text(form, 'stateToken'),
    acknowledgedWarnings: all(form, 'aviso'),
    resolution: { cancelAppointments: all(form, 'cancelar'), deletePeriods, shortenPeriods },
  };
}

function wallTimeInstant(date: string, time: string, timezone: string): Temporal.Instant | null {
  try {
    return instantFromWallTime(Temporal.PlainDate.from(date), Temporal.PlainTime.from(time), timezone);
  } catch {
    return null;
  }
}

function stateOf(
  result: Result<OwnerAppointmentSaved, OwnerAppointmentFailure>,
  values: Record<string, string>,
): AppointmentFormState {
  if (result.ok) {
    revalidatePath('/gestion/agenda');
    return { kind: 'saved', values, notifyPhone: result.value.notifyCustomer?.phone ?? null };
  }

  const failure = result.error;
  const reasons = messages.owner.errors.appointment;
  const error = (copy: { message: string; nextAction: string }, fields: readonly ContactField[] = []) =>
    ({ kind: 'error', values, ...copy, fields }) as const;

  switch (failure.kind) {
    case 'NOT_FOUND':
      return error(messages.owner.errors.appointmentNotFound);
    case 'INVALID_SELECTION':
      return error(reasons[failure.error.kind]);
    case 'INVALID_CONTACT': {
      const fields = failure.fields.map((field) => field.field);
      const names = fields.map((field) => messages.owner.errors.contactFieldNames[field]);
      const copy = messages.owner.errors.invalidContact;
      return error({ message: copy.message.replace('{fields}', listOf(names)), nextAction: copy.nextAction }, fields);
    }
    case 'BLOCKED':
      return error(reasons[failure.reason]);
    case 'RESOLUTION_REJECTED':
      return error(reasons[failure.reason]);
    case 'STATE_CHANGED':
      return error(reasons.STATE_CHANGED);
    case 'CONFLICT': {
      const copy =
        failure.conflicts.length === 0 ? messages.owner.errors.appointmentWarning : messages.owner.errors.appointmentConflict;
      return {
        kind: 'conflict',
        values,
        ...copy,
        conflicts: failure.conflicts.map((conflict) => ({
          ...conflictDto(conflict, failure.timezone),
          shortenings:
            conflict.kind === 'UNAVAILABLE_PERIOD'
              ? shorteningsThatFit({ ...conflict }, failure.span).map((shortening) => ({
                  value: shorteningValue(shortening),
                  from: localTimeDto(shortening.startsAt, failure.timezone).localTime,
                  to: localTimeDto(shortening.endsAt, failure.timezone).localTime,
                }))
              : [],
        })),
        warnings: failure.warnings.map((code) => ({ code, message: messages.owner.errors.warnings[code] })),
        stateToken: failure.stateToken,
      };
    }
  }
}

const CREATE_FIELDS = ['fecha', 'hora', 'serviceIds', 'nombre', 'telefono', 'email'] as const;

/** Historia 4: an appointment written by hand. */
export async function createAppointment(_previous: AppointmentFormState, form: FormData): Promise<AppointmentFormState> {
  await requireOwnerPage();
  const values = valuesOf(form, CREATE_FIELDS);
  const { config, ownerAppointments } = container();

  const startsAt = wallTimeInstant(values['fecha'] ?? '', values['hora'] ?? '', (await config.load()).salon.timezone);
  if (startsAt === null) return { kind: 'error', values, ...messages.owner.errors.badRequest, fields: [] };

  const result = await ownerAppointments.create({
    serviceIds: (values['serviceIds'] ?? '').split(',').filter((id) => id !== ''),
    startsAt,
    customer: { name: values['nombre'] ?? '', phone: values['telefono'] ?? '', email: values['email'] ?? null },
    ...answerOf(form),
  });
  return stateOf(result, values);
}

/** Historia 5: the same appointment at another time. */
export async function moveAppointment(_previous: AppointmentFormState, form: FormData): Promise<AppointmentFormState> {
  await requireOwnerPage();
  const values = valuesOf(form, ['cita', 'fecha', 'hora']);
  const { config, ownerAppointments } = container();

  const id = appointmentIdSchema.safeParse(values['cita']);
  const startsAt = wallTimeInstant(values['fecha'] ?? '', values['hora'] ?? '', (await config.load()).salon.timezone);
  if (!id.success || startsAt === null) return { kind: 'error', values, ...messages.owner.errors.badRequest, fields: [] };

  return stateOf(await ownerAppointments.reschedule({ id: id.data, startsAt, ...answerOf(form) }), values);
}

/** Historia 5: the explicit confirmation of FR-040 is this form being sent. */
export async function cancelAppointment(_previous: AppointmentFormState, form: FormData): Promise<AppointmentFormState> {
  await requireOwnerPage();
  const values = valuesOf(form, ['cita']);

  const id = appointmentIdSchema.safeParse(values['cita']);
  if (!id.success || text(form, 'confirmed') !== 'true') {
    return { kind: 'error', values, ...messages.owner.errors.badRequest, fields: [] };
  }
  return stateOf(await container().ownerAppointments.cancel(id.data), values);
}
