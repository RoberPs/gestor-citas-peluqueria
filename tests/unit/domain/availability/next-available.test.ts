import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { findNextAvailableDate } from '@/domain/availability/next-available';
import type { BusyInterval } from '@/domain/booking/appointment';
import type { WeeklySchedule } from '@/domain/catalog/salon';
import { busy, MADRID, NOW, POLICY, standardSchedule, wholeDay } from './_fixtures';

/**
 * FR-006: the jump to the next day with availability, **even when it falls in a
 * later range**. It runs over data already in memory, so offering the jump
 * costs no extra query — which is what makes it worth offering at all.
 */

type Options = {
  fromDate?: string;
  horizonEnd?: string;
  schedule?: WeeklySchedule;
  unavailable?: readonly BusyInterval[];
  durationMinutes?: number;
  confirmed?: readonly BusyInterval[];
};

function next(options: Options = {}): string | null {
  const result = findNextAvailableDate({
    fromDate: Temporal.PlainDate.from(options.fromDate ?? '2026-09-15'),
    horizonEnd: Temporal.PlainDate.from(options.horizonEnd ?? '2026-11-14'),
    salonSchedule: options.schedule ?? standardSchedule(),
    unavailablePeriods: options.unavailable ?? [],
    serviceDurationMinutes: options.durationMinutes ?? 30,
    confirmedAppointments: options.confirmed ?? [],
    now: NOW,
    policy: POLICY,
    timezone: MADRID,
  });

  return result === null ? null : result.toString();
}

/** Fills a 10:00–20:00 day for any service. */
function fullDay(date: string): BusyInterval {
  return busy(date, '10:00', '20:00');
}

describe('findNextAvailableDate', () => {
  it('excludes the day it starts from: it answers "after this one"', () => {
    expect(next({ fromDate: '2026-09-15' })).toBe('2026-09-16');
  });

  it('skips over closed days', () => {
    // Friday 18th closed by a holiday, Saturday 19th too, Sunday 20th shut.
    expect(
      next({ fromDate: '2026-09-17', unavailable: [wholeDay('2026-09-18'), wholeDay('2026-09-19')] }),
    ).toBe('2026-09-21');
  });

  it('skips over full days', () => {
    expect(next({ fromDate: '2026-09-17', confirmed: [fullDay('2026-09-18')] })).toBe('2026-09-19');
  });

  it('jumps into a later range when the whole current range is unavailable', () => {
    // Every open day of the first 14 day range is full or closed.
    const confirmed = [
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-28',
    ].map(fullDay);

    const result = next({ fromDate: '2026-09-15', confirmed });

    // Day 15 of the horizon: beyond the range the client is looking at, whose
    // last day is 2026-09-28.
    expect(result).toBe('2026-09-29');
  });

  it('returns null once the horizon is exhausted', () => {
    expect(next({ fromDate: '2026-11-14' })).toBeNull();
  });

  it('returns null when nothing is open at all', () => {
    expect(next({ schedule: new Map() })).toBeNull();
  });

  it('answers per service: a day that is full for Color may be free for Corte', () => {
    // 10:30 to 19:00 booked on the 16th and 17th leaves only short gaps.
    const confirmed = [busy('2026-09-16', '10:30', '19:00'), busy('2026-09-17', '10:30', '19:00')];

    expect(next({ durationMinutes: 30, confirmed })).toBe('2026-09-16');
    expect(next({ durationMinutes: 90, confirmed })).toBe('2026-09-18');
  });

  it('includes the last day of the horizon when it has room', () => {
    expect(next({ fromDate: '2026-11-13' })).toBe('2026-11-14');
  });
});
