import type { Temporal } from '@js-temporal/polyfill';

/**
 * The day `days` open days away from today, on the seeded salon's calendar,
 * which is closed on Sundays and on its one holiday.
 *
 * It counts open days, not calendar days. Moving a closed day to the next open
 * one instead made two offsets share a day — on a Thursday, +3 (Sunday) became
 * Monday, which is +4 — and two fixtures at the same hour then broke the EXCLUDE
 * constraint. Counting open days keeps every offset on its own day, in order.
 *
 * Offset 0 is today, or the next open day when the salon is closed today;
 * negative offsets count open days back from there.
 */
export function salonDayFromToday(today: Temporal.PlainDate, days: number, holiday: string): Temporal.PlainDate {
  const isOpen = (date: Temporal.PlainDate): boolean => date.dayOfWeek !== 7 && date.toString() !== holiday;
  const step = (date: Temporal.PlainDate, direction: 1 | -1): Temporal.PlainDate => {
    let next = date.add({ days: direction });
    while (!isOpen(next)) next = next.add({ days: direction });
    return next;
  };

  let date = isOpen(today) ? today : step(today, 1);
  const direction = days < 0 ? -1 : 1;
  for (let remaining = Math.abs(days); remaining > 0; remaining -= 1) {
    date = step(date, direction);
  }
  return date;
}
