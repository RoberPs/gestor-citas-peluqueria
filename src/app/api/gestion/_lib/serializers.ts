import type { Temporal } from '@js-temporal/polyfill';
import { durationOf, type Appointment } from '@/domain/booking/appointment';
import type { UnavailablePeriod } from '@/domain/catalog/salon';
import { totalPriceOf } from '@/domain/catalog/selection';
import type { AgendaDay, TimelineEntry } from '@/domain/owner/agenda';
import { isPastSlot } from '@/domain/owner/agenda';
import type { Conflict } from '@/domain/owner/conflict';
import { formatLocalTime, localDateOf } from '@/domain/shared/time';
import { messages } from '@/messages/es-ES';
import { priceTotalDto, snapshotDto, type PriceTotalDto } from '../../_lib/serializers';

/**
 * Domain values turned into the wire shapes of `owner-api.yaml` (002).
 *
 * Every instant leaves with its salon wall time already written out, so no
 * screen does calendar arithmetic with the owner's device clock (BR-015).
 */

export type LocalTimeDto = {
  readonly instant: string;
  readonly localTime: string;
  readonly localDate: string;
};

export function localTimeDto(instant: Temporal.Instant, timezone: string): LocalTimeDto {
  return {
    instant: instant.toZonedDateTimeISO(timezone).toString({ timeZoneName: 'never' }),
    localTime: formatLocalTime(instant, timezone),
    localDate: localDateOf(instant, timezone).toString(),
  };
}

export type OwnerServiceOfAppointmentDto = {
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number | null;
  readonly priceLabel: string;
};

export type OwnerAppointmentDto = {
  readonly id: string;
  readonly status: Appointment['status'];
  readonly origin: Appointment['origin'];
  readonly startsAt: LocalTimeDto;
  readonly endsAt: LocalTimeDto;
  readonly services: readonly OwnerServiceOfAppointmentDto[];
  readonly price: PriceTotalDto;
  readonly durationMinutes: number;
  readonly createdAt: LocalTimeDto;
  readonly cancelledAt: LocalTimeDto | null;
  readonly cancelledBy: Appointment['cancelledBy'];
  readonly customer: { readonly name: string; readonly phone: string; readonly email: string | null } | null;
  readonly isPast: boolean;
  /** The token itself never leaves: it is the client's credential, not the owner's. */
  readonly hasManagementLink: boolean;
};

export function ownerAppointmentDto(
  appointment: Appointment,
  now: Temporal.Instant,
  timezone: string,
): OwnerAppointmentDto {
  return {
    id: appointment.id,
    status: appointment.status,
    origin: appointment.origin,
    startsAt: localTimeDto(appointment.startsAt, timezone),
    endsAt: localTimeDto(appointment.endsAt, timezone),
    // Snapshots without their catalogue id: what was booked, not today's catalogue.
    services: appointment.services.map((service) => {
      const { id: _catalogueId, ...dto } = snapshotDto(service);
      return dto;
    }),
    price: priceTotalDto(totalPriceOf(appointment.services)),
    durationMinutes: durationOf(appointment),
    createdAt: localTimeDto(appointment.createdAt, timezone),
    cancelledAt:
      appointment.cancelledAt === null ? null : localTimeDto(appointment.cancelledAt, timezone),
    cancelledBy: appointment.cancelledBy,
    customer: appointment.customer,
    isPast: isPastSlot(appointment.endsAt, now),
    // Online and not anonymised: the database ties the link to exactly that (D-026).
    hasManagementLink: appointment.origin === 'ONLINE' && appointment.anonymizedAt === null,
  };
}

export function periodDto(period: UnavailablePeriod, timezone: string) {
  return {
    id: period.id,
    startsAt: localTimeDto(period.startsAt, timezone),
    endsAt: localTimeDto(period.endsAt, timezone),
    reason: period.reason,
  };
}

/** FR-033: named, so the owner can decide. An anonymised customer is said in words. */
export function conflictDto(conflict: Conflict, timezone: string) {
  const span = {
    startsAt: localTimeDto(conflict.startsAt, timezone),
    endsAt: localTimeDto(conflict.endsAt, timezone),
  };
  return conflict.kind === 'APPOINTMENT'
    ? {
        kind: conflict.kind,
        id: conflict.id,
        customerName: conflict.customerName ?? messages.owner.agenda.anonymized,
        serviceNames: conflict.serviceNames,
        ...span,
      }
    : { kind: conflict.kind, id: conflict.id, reason: conflict.reason, ...span };
}

export type ConflictDto = ReturnType<typeof conflictDto>;

function entryDto(entry: TimelineEntry, now: Temporal.Instant, timezone: string) {
  switch (entry.kind) {
    case 'APPOINTMENT':
      return { kind: entry.kind, appointment: ownerAppointmentDto(entry.appointment, now, timezone) };
    case 'UNAVAILABLE':
      return { kind: entry.kind, period: periodDto(entry.period, timezone) };
    case 'FREE':
      return {
        kind: entry.kind,
        startsAt: localTimeDto(entry.startsAt, timezone),
        endsAt: localTimeDto(entry.endsAt, timezone),
      };
  }
}

export function agendaDayDto(day: AgendaDay, now: Temporal.Instant, timezone: string) {
  return {
    date: day.date.toString(),
    isClosed: day.isClosed,
    isReadOnly: day.isReadOnly,
    entries: day.entries.map((entry) => entryDto(entry, now, timezone)),
  };
}

export type AgendaDayDto = ReturnType<typeof agendaDayDto>;
