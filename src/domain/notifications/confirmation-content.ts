import type { Temporal } from '@js-temporal/polyfill';
import type { Appointment } from '../booking/appointment';
import type { BookingPolicy, Salon, Weekday } from '../catalog/salon';
import { totalPriceOf, type PriceTotal } from '../catalog/selection';
import { err, ok, type Result } from '../shared/result';
import { formatLocalTime, localDateOf } from '../shared/time';

/**
 * What the confirmation email says, as data (004, FR-006, D-008).
 *
 * The wording is the infrastructure's, from the message catalogue; which day,
 * which hours, which total and which deadline are decided here, by the same
 * rules the screens use. Of the client only the name is in it (FR-007).
 */

export type ConfirmationContent = {
  readonly salon: { readonly name: string; readonly address: string; readonly phone: string };
  readonly customerName: string;
  /** The salon's calendar day and wall-clock hours, never the device's (FR-025). */
  readonly date: Temporal.PlainDate;
  readonly weekday: Weekday;
  /** `11:30`. */
  readonly startTime: string;
  readonly endTime: string;
  /** In the appointment's order, each with its price or none (FR-019 of 005). */
  readonly services: readonly { readonly name: string; readonly priceCents: number | null }[];
  readonly total: PriceTotal;
  readonly cancellationDeadlineHours: number;
};

export function confirmationContent(
  appointment: Appointment,
  salon: Salon,
  policy: BookingPolicy,
): Result<ConfirmationContent, 'NO_CUSTOMER'> {
  if (appointment.customer === null) return err('NO_CUSTOMER');

  const date = localDateOf(appointment.startsAt, salon.timezone);

  return ok({
    salon: { name: salon.name, address: salon.address, phone: salon.phone },
    customerName: appointment.customer.name,
    date,
    weekday: date.dayOfWeek as Weekday,
    startTime: formatLocalTime(appointment.startsAt, salon.timezone),
    endTime: formatLocalTime(appointment.endsAt, salon.timezone),
    services: appointment.services.map((service) => ({ name: service.name, priceCents: service.priceCents })),
    total: totalPriceOf(appointment.services),
    cancellationDeadlineHours: policy.cancellationDeadlineHours,
  });
}
