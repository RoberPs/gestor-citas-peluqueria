import type { AvailabilityView } from '@/application/use-cases/get-availability';
import type { AppointmentDetail } from '@/application/use-cases/view-appointment';
import type { ModificationBlock } from '@/domain/booking/modification-rules';
import type { Salon } from '@/domain/catalog/salon';
import type { Service } from '@/domain/catalog/service';
import { formatIsoDate, formatLocalTime, localDateOf } from '@/domain/shared/time';
import { messages, withPhone } from '@/messages/es-ES';
import { dayLabel, weekdayLabel } from '../../_lib/format';

/**
 * Domain and use-case types turned into the wire shapes of
 * `contracts/http-api.yaml`.
 *
 * Dates and hours leave here already written out, so the client never does
 * calendar arithmetic and the device clock decides nothing (FR-033).
 */

export type SalonInfoDto = {
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  readonly timezone: string;
  readonly timezoneLabel: string;
};

/** No salon identifier: there is one salon per instance (asunción 11). */
export function salonInfo(salon: Salon): SalonInfoDto {
  return {
    name: salon.name,
    address: salon.address,
    phone: salon.phone,
    timezone: salon.timezone,
    timezoneLabel: messages.common.timezoneLabel,
  };
}

export type ServiceDto = {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number;
};

export function serviceDto(service: Service): ServiceDto {
  return {
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    priceCents: service.priceCents,
  };
}

export function availabilityResponse(view: AvailabilityView) {
  return {
    serviceId: view.serviceId,
    range: view.range,
    days: view.days.map((day) => ({
      date: day.date,
      weekdayLabel: weekdayLabel(day.weekday),
      dayLabel: dayLabel(day.date),
      status: day.status,
      slotCount: day.slotCount,
    })),
    selectedDate: view.selectedDate,
    slots: view.slots.map((slot) => ({
      startsAt: slot.startsAt.toString(),
      localTime: slot.localTime,
      endsLocalTime: slot.endsLocalTime,
      isCurrentAppointment: slot.isCurrentAppointment,
    })),
    nextAvailableDate: view.nextAvailableDate,
    cancellationPolicyHours: view.cancellationPolicyHours,
  };
}

export type AvailabilityDto = ReturnType<typeof availabilityResponse>;

/**
 * Turns the block the domain returned into the sentence the client reads
 * (FR-028). The decision is the domain's; only the wording lives here.
 */
export function reasonFor(
  block: ModificationBlock | null,
  deadlineHours: number,
  salonPhone: string,
): string | null {
  if (block === null) return null;

  return withPhone(
    messages.appointment.unavailable[block.kind].replace('{hours}', String(deadlineHours)),
    salonPhone,
  );
}

export function unavailableReason(detail: AppointmentDetail): string | null {
  return reasonFor(detail.block, detail.policy.cancellationDeadlineHours, detail.salon.phone);
}

export function appointmentDetailResponse(detail: AppointmentDetail) {
  const { appointment, salon } = detail;
  const timezone = salon.timezone;

  return {
    view: detail.view,
    service: {
      id: appointment.service.serviceId,
      name: appointment.service.name,
      durationMinutes: appointment.service.durationMinutes,
      priceCents: appointment.service.priceCents,
    },
    date: formatIsoDate(localDateOf(appointment.startsAt, timezone)),
    startsLocalTime: formatLocalTime(appointment.startsAt, timezone),
    endsLocalTime: formatLocalTime(appointment.endsAt, timezone),
    durationMinutes: appointment.service.durationMinutes,
    startsAt: appointment.startsAt.toString(),
    canCancel: detail.canCancel,
    canReschedule: detail.canReschedule,
    unavailableReason: unavailableReason(detail),
    cancellationPolicyHours: detail.policy.cancellationDeadlineHours,
    salon: salonInfo(salon),
  };
}

export type AppointmentDetailDto = ReturnType<typeof appointmentDetailResponse>;
