import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { computeRangeDays } from '@/domain/availability/compute-range';
import type { BusyInterval } from '@/domain/booking/appointment';
import type { WeeklySchedule } from '@/domain/catalog/salon';
import { at, busy, MADRID, NOW, POLICY, standardSchedule, wholeDay } from './_fixtures';

/**
 * FR-005: each of the 14 days is CLOSED, FULL or AVAILABLE **for the chosen
 * service**. The three are not interchangeable — telling a client "closed" when
 * the day is merely full sends them away for good.
 */

type Options = {
  rangeStart?: string;
  schedule?: WeeklySchedule;
  unavailable?: readonly BusyInterval[];
  durationMinutes?: number;
  confirmed?: readonly BusyInterval[];
  now?: Temporal.Instant;
};

function range(options: Options = {}) {
  return computeRangeDays({
    rangeStart: Temporal.PlainDate.from(options.rangeStart ?? '2026-09-15'),
    rangeLengthDays: POLICY.rangeLengthDays,
    salonSchedule: options.schedule ?? standardSchedule(),
    unavailablePeriods: options.unavailable ?? [],
    serviceDurationMinutes: options.durationMinutes ?? 30,
    confirmedAppointments: options.confirmed ?? [],
    now: options.now ?? NOW,
    policy: POLICY,
    timezone: MADRID,
  });
}

function statusOn(days: ReturnType<typeof range>, date: string) {
  return days.find((day) => day.date === date)?.status;
}

/** Every confirmed appointment that fills a 10:00–20:00 day for a 30 minute service. */
function fullDay(date: string): readonly BusyInterval[] {
  return [busy(date, '10:00', '20:00')];
}

describe('the shape of a range', () => {
  it('returns 14 days starting where it was asked to', () => {
    const days = range();

    expect(days).toHaveLength(14);
    expect(days[0]?.date).toBe('2026-09-15');
    expect(days.at(-1)?.date).toBe('2026-09-28');
  });

  it('carries the ISO weekday, so the screen can label it without date maths', () => {
    const days = range();

    expect(days[0]?.weekday).toBe(2); // 2026-09-15 is a Tuesday
    expect(statusOn(days, '2026-09-20')).toBe('CLOSED'); // Sunday
  });
});

describe('CLOSED is never reported as FULL', () => {
  it('marks a weekday with no opening stretches as CLOSED', () => {
    const days = range();

    expect(statusOn(days, '2026-09-20')).toBe('CLOSED');
    expect(statusOn(days, '2026-09-27')).toBe('CLOSED');
  });

  it('marks a holiday as CLOSED, not FULL, even though it has stretches', () => {
    const days = range({ unavailable: [wholeDay('2026-09-18')] });

    expect(statusOn(days, '2026-09-18')).toBe('CLOSED');
  });

  it('marks an open day with no room left as FULL, not CLOSED', () => {
    const days = range({ confirmed: fullDay('2026-09-18') });

    expect(statusOn(days, '2026-09-18')).toBe('FULL');
  });

  it('reports zero slots for both CLOSED and FULL, and a count for AVAILABLE', () => {
    const days = range({ unavailable: [wholeDay('2026-09-17')], confirmed: fullDay('2026-09-18') });

    expect(days.find((d) => d.date === '2026-09-17')?.slotCount).toBe(0);
    expect(days.find((d) => d.date === '2026-09-18')?.slotCount).toBe(0);
    expect(days.find((d) => d.date === '2026-09-21')?.slotCount).toBe(20);
  });
});

describe('trimming the last range to the horizon', () => {
  it('returns fewer than 14 days rather than running past day 60', () => {
    const days = range({ rangeStart: '2026-11-10' });

    expect(days).toHaveLength(5);
    expect(days.at(-1)?.date).toBe('2026-11-14');
  });

  it('returns nothing for a range that starts beyond the horizon', () => {
    expect(range({ rangeStart: '2026-11-15' })).toEqual([]);
  });
});

describe('the status depends on the service', () => {
  it('can be FULL for Color and AVAILABLE for Corte on the same day', () => {
    // 10:30 to 19:00 booked leaves 10:00–10:30 and 19:00–20:00: a 30 minute
    // service fits in both, a 90 minute one fits in neither.
    const confirmed = [busy('2026-09-18', '10:30', '19:00')];

    const forCorte = range({ durationMinutes: 30, confirmed });
    const forColor = range({ durationMinutes: 90, confirmed });

    expect(statusOn(forCorte, '2026-09-18')).toBe('AVAILABLE');
    expect(statusOn(forColor, '2026-09-18')).toBe('FULL');
  });

  it('recomputes every day when the service changes', () => {
    const confirmed = [busy('2026-09-18', '10:30', '19:00')];

    const corte = range({ durationMinutes: 30, confirmed });
    const color = range({ durationMinutes: 90, confirmed });

    expect(corte.map((d) => d.status)).not.toEqual(color.map((d) => d.status));
  });
});

describe('the two hour lead time inside the range', () => {
  it('can leave today FULL while tomorrow is AVAILABLE', () => {
    const days = range({ now: Temporal.Instant.from('2026-09-15T17:45:00Z') }); // 19:45 Madrid

    expect(statusOn(days, '2026-09-15')).toBe('FULL');
    expect(statusOn(days, '2026-09-16')).toBe('AVAILABLE');
  });
});

describe('the seasonal time change inside the horizon', () => {
  // Madrid goes back to CET on 2026-10-25. Opening hours are wall times, so the
  // days on either side look identical to the client.
  it('keeps the same opening hours on both sides of the change', () => {
    const days = range({ rangeStart: '2026-10-19' });

    expect(statusOn(days, '2026-10-23')).toBe('AVAILABLE'); // Friday, CEST
    expect(statusOn(days, '2026-10-26')).toBe('AVAILABLE'); // Monday, CET
    expect(days.find((d) => d.date === '2026-10-23')?.slotCount).toBe(
      days.find((d) => d.date === '2026-10-26')?.slotCount,
    );
  });

  it('still counts a 90 minute service as 90 real minutes after the change', () => {
    const days = range({ rangeStart: '2026-10-19', durationMinutes: 90 });

    expect(days.find((d) => d.date === '2026-10-26')?.slotCount).toBe(18);
  });
});

describe('CLOSED and FULL with unavailable periods (002, D-020)', () => {
  it('marks a day CLOSED when periods cover all its opening, not only midnight to midnight', () => {
    const days = range({ unavailable: [busy('2026-09-18', '09:00', '21:00')] });

    expect(statusOn(days, '2026-09-18')).toBe('CLOSED');
  });

  it('marks a day CLOSED when several periods cover its opening between them', () => {
    const days = range({
      unavailable: [busy('2026-09-18', '10:00', '15:00'), busy('2026-09-18', '14:00', '20:00')],
    });

    expect(statusOn(days, '2026-09-18')).toBe('CLOSED');
  });

  it('marks a day FULL, not CLOSED, when opening is left but no start fits', () => {
    const days = range({
      unavailable: [busy('2026-09-18', '13:00', '14:00')],
      confirmed: [busy('2026-09-18', '10:00', '13:00'), busy('2026-09-18', '14:00', '20:00')],
    });

    expect(statusOn(days, '2026-09-18')).toBe('FULL');
  });

  it('shows a week of holidays as CLOSED every day, never as FULL (Historia 3, escenario 3)', () => {
    const holidays = { startsAt: at('2026-09-21', '00:00'), endsAt: at('2026-09-26', '00:00') };
    const days = range({ unavailable: [holidays] });

    for (const date of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']) {
      expect(statusOn(days, date)).toBe('CLOSED');
    }
    expect(statusOn(days, '2026-09-26')).toBe('AVAILABLE');
  });
});
