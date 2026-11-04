'use server';

import { Temporal } from '@js-temporal/polyfill';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { container } from '@/app/_lib/container';
import { periodIdSchema } from '@/app/api/gestion/_lib/period-params';
import { conflictDto, type ConflictDto } from '@/app/api/gestion/_lib/serializers';
import { wholeDaysOf } from '@/domain/owner/unavailable-period';
import { instantFromWallTime } from '@/domain/shared/time';
import { messages } from '@/messages/es-ES';
import { requireOwnerPage } from '../_lib/require-owner-page';

/**
 * Blocking and releasing time from the agenda (002, Historia 3).
 *
 * The form sends the salon's wall time — a day and two times, or a first and
 * a last day — and the instants are worked out here, in the salon's zone,
 * never on the owner's device (BR-015). Whether the period is valid, and
 * whether it lands on appointments, is the use case's call.
 */

export type PeriodFormValues = {
  readonly tipo: 'horas' | 'dias';
  readonly dia: string;
  readonly desde: string;
  readonly hasta: string;
  readonly primerDia: string;
  readonly ultimoDia: string;
  readonly motivo: string;
};

export type PeriodFormState =
  | { readonly kind: 'idle'; readonly values: PeriodFormValues }
  | { readonly kind: 'saved'; readonly values: PeriodFormValues }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly nextAction: string;
      readonly values: PeriodFormValues;
    }
  | {
      readonly kind: 'conflict';
      readonly conflicts: readonly ConflictDto[];
      readonly stateToken: string;
      readonly values: PeriodFormValues;
    };

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function valuesOf(form: FormData): PeriodFormValues {
  return {
    tipo: text(form, 'tipo') === 'dias' ? 'dias' : 'horas',
    dia: text(form, 'dia'),
    desde: text(form, 'desde'),
    hasta: text(form, 'hasta'),
    primerDia: text(form, 'primerDia'),
    ultimoDia: text(form, 'ultimoDia'),
    motivo: text(form, 'motivo'),
  };
}

function spanOf(values: PeriodFormValues, timezone: string) {
  try {
    if (values.tipo === 'dias') {
      return wholeDaysOf(Temporal.PlainDate.from(values.primerDia), Temporal.PlainDate.from(values.ultimoDia), timezone);
    }
    const day = Temporal.PlainDate.from(values.dia);
    return {
      startsAt: instantFromWallTime(day, Temporal.PlainTime.from(values.desde), timezone),
      endsAt: instantFromWallTime(day, Temporal.PlainTime.from(values.hasta), timezone),
    };
  } catch {
    return null;
  }
}

export async function blockPeriod(_previous: PeriodFormState, form: FormData): Promise<PeriodFormState> {
  await requireOwnerPage();

  const values = valuesOf(form);
  const { config, unavailablePeriods } = container();
  const { timezone } = (await config.load()).salon;

  const span = spanOf(values, timezone);
  if (span === null) return { kind: 'error', ...messages.owner.errors.badRequest, values };

  const acknowledged = form.getAll('confirmarCita').filter((id): id is string => typeof id === 'string');
  const result = await unavailablePeriods.create({
    ...span,
    reason: values.motivo,
    stateToken: text(form, 'stateToken') || undefined,
    acknowledgeAppointments: acknowledged,
  });

  if (result.ok) {
    revalidatePath('/gestion/agenda');
    return { kind: 'saved', values };
  }
  const rejection = result.error;
  if (rejection.kind === 'INVALID') {
    return { kind: 'error', ...messages.owner.errors.period[rejection.reason], values };
  }
  return {
    kind: 'conflict',
    conflicts: rejection.conflicts.map((conflict) => conflictDto(conflict, rejection.timezone)),
    stateToken: rejection.stateToken,
    values,
  };
}

/**
 * Back to the same day of the agenda, which says whether the time is free
 * again or the period was already gone.
 */
export async function releasePeriod(form: FormData): Promise<void> {
  await requireOwnerPage();

  const id = periodIdSchema.safeParse(text(form, 'periodo'));
  const released = id.success && (await container().unavailablePeriods.remove(id.data)).ok;

  revalidatePath('/gestion/agenda');
  const day = encodeURIComponent(text(form, 'fecha'));
  const withCancelled = text(form, 'canceladas') === '1' ? '&canceladas=1' : '';
  redirect(`/gestion/agenda?fecha=${day}${withCancelled}&liberado=${released ? 'si' : 'no'}`);
}
