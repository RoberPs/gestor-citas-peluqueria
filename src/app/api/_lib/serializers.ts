import type { AvailabilityView } from '@/application/use-cases/get-availability';
import type { AppointmentDetail } from '@/application/use-cases/view-appointment';
import { durationOf } from '@/domain/booking/appointment';
import type { ModificationBlock } from '@/domain/booking/modification-rules';
import type { Salon } from '@/domain/catalog/salon';
import { totalPriceOf, type PriceTotal } from '@/domain/catalog/selection';
import { snapshotOf, type Service, type ServiceSnapshot } from '@/domain/catalog/service';
import { formatIsoDate, formatLocalTime, localDateOf } from '@/domain/shared/time';
import { messages, withPhone } from '@/messages/es-ES';
import { dayLabel, priceLabel, totalPriceLabel, weekdayLabel } from '../../_lib/format';

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
  readonly priceCents: number | null;
  /** Already written out, so no screen formats cents or decides "no price" (FR-019). */
  readonly priceLabel: string;
};

/** A service as booked: the snapshot an appointment or a selection carries. */
export function snapshotDto(service: ServiceSnapshot): ServiceDto {
  return {
    id: service.serviceId,
    name: service.name,
    durationMinutes: service.durationMinutes,
    priceCents: service.priceCents,
    priceLabel: priceLabel(service.priceCents),
  };
}

export function serviceDto(service: Service): ServiceDto {
  return snapshotDto(snapshotOf(service));
}

export type PriceTotalDto = {
  readonly kind: PriceTotal['kind'];
  readonly knownCents: number | null;
  /** Already written out: the client neither adds amounts nor picks the sentence (FR-020). */
  readonly label: string;
};

export function priceTotalDto(total: PriceTotal): PriceTotalDto {
  const knownCents =
    total.kind === 'ALL_PRICED' ? total.cents : total.kind === 'PARTIALLY_PRICED' ? total.knownCents : null;

  return { kind: total.kind, knownCents, label: totalPriceLabel(total) };
}

export function availabilityResponse(view: AvailabilityView) {
  const { selection } = view;

  return {
    serviceIds: selection.services.map((service) => service.serviceId),
    services: selection.services.map(snapshotDto),
    durationMinutes: selection.durationMinutes,
    price: priceTotalDto(view.price),
    fitsOpeningHours: view.fitsOpeningHours,
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
    services: appointment.services.map(snapshotDto),
    // From the snapshots: a price set after booking does not reach it (FR-014).
    price: priceTotalDto(totalPriceOf(appointment.services)),
    date: formatIsoDate(localDateOf(appointment.startsAt, timezone)),
    startsLocalTime: formatLocalTime(appointment.startsAt, timezone),
    endsLocalTime: formatLocalTime(appointment.endsAt, timezone),
    durationMinutes: durationOf(appointment),
    startsAt: appointment.startsAt.toString(),
    canCancel: detail.canCancel,
    canReschedule: detail.canReschedule,
    // 2.1.0: who cancelled it, so the client knows whether to call (002, D-037).
    cancelledBy: appointment.cancelledBy,
    unavailableReason: unavailableReason(detail),
    cancellationPolicyHours: detail.policy.cancellationDeadlineHours,
    salon: salonInfo(salon),
  };
}

export type AppointmentDetailDto = ReturnType<typeof appointmentDetailResponse>;
