import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { salonDayFromToday } from '../../e2e/helpers/salon-days';

/**
 * The day an e2e fixture lands on, for every day of the week the suite can run on.
 *
 * US10 seeds several bookings at the same hour on different offsets. When two
 * offsets landed on the same day, the EXCLUDE constraint rejected the second one
 * and scenarios 5 and 6 failed on Thursdays, Fridays and Saturdays only.
 */

// 2026-11-02 is a Monday; the seed puts its holiday a week after "today" (db/seed/seed.ts).
const WEEK = Array.from({ length: 7 }, (_, index) => Temporal.PlainDate.from('2026-11-02').add({ days: index }));

function seededHoliday(today: Temporal.PlainDate): string {
  const candidate = today.add({ days: 7 });
  return (candidate.dayOfWeek === 7 ? candidate.add({ days: 1 }) : candidate).toString();
}

describe.each(WEEK.map((today) => [today.toString(), today] as const))('run on %s', (_, today) => {
  const holiday = seededHoliday(today);
  const days = Array.from({ length: 15 }, (__, offset) => salonDayFromToday(today, offset, holiday));

  it('lands every offset on a day the salon is open', () => {
    for (const day of days) {
      expect(day.dayOfWeek).not.toBe(7);
      expect(day.toString()).not.toBe(holiday);
    }
  });

  it('never lands two offsets on the same day, and keeps their order', () => {
    expectStrictlyAscending(days.map(String));
  });

  it('keeps past offsets in the past, apart and in order', () => {
    const past = [-10, -2, -1].map((offset) => salonDayFromToday(today, offset, holiday).toString());
    expectStrictlyAscending([...past, today.toString()]);
  });
});

/** ISO dates sort as text: ascending and without repeats means distinct days, in order. */
function expectStrictlyAscending(isoDates: readonly string[]): void {
  expect(new Set(isoDates).size).toBe(isoDates.length);
  expect([...isoDates].sort()).toEqual(isoDates);
}

it('reproduces the US10 failure: on a Thursday, +3 and +4 used to be the same Monday', () => {
  const thursday = Temporal.PlainDate.from('2026-11-05');
  const holiday = seededHoliday(thursday);

  expect(salonDayFromToday(thursday, 3, holiday).equals(salonDayFromToday(thursday, 4, holiday))).toBe(false);
});
