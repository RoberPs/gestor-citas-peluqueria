import { Temporal } from '@js-temporal/polyfill';
import type { Weekday } from '@/domain/catalog/salon';
import { messages } from '@/messages/es-ES';

/**
 * Presentation-only formatting, built from the message catalogue.
 *
 * The server sends every hour and date already written out, so the client does
 * no date arithmetic and the device clock cannot influence what is shown
 * (FR-033, BR-015).
 */

export function weekdayLabel(weekday: Weekday): string {
  return messages.common.weekdayShort[weekday - 1] ?? '';
}

export function weekdayLongLabel(weekday: Weekday): string {
  return messages.common.weekdayLong[weekday - 1] ?? '';
}

export function dayLabel(isoDate: string): string {
  return String(Temporal.PlainDate.from(isoDate).day);
}

export function monthLabel(isoDate: string): string {
  return messages.common.monthLong[Temporal.PlainDate.from(isoDate).month - 1] ?? '';
}

/** `viernes 18 de septiembre` — how a person says a date out loud. */
export function longDateLabel(isoDate: string): string {
  const date = Temporal.PlainDate.from(isoDate);
  const weekday = date.dayOfWeek as Weekday;

  return `${weekdayLongLabel(weekday)} ${date.day} de ${monthLabel(isoDate)}`;
}

/**
 * Cents to `18,00 €`. Money is an integer everywhere except on screen.
 * A service with no price says so in words, never as `0,00 €` (FR-019).
 */
export function priceLabel(cents: number | null): string {
  if (cents === null) return messages.common.priceOnRequest;
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

export function durationLabel(minutes: number): string {
  return `${minutes} ${messages.common.minutesSuffix}`;
}
