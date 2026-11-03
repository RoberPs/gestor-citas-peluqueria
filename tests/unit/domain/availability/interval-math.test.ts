import { describe, expect, it } from 'vitest';
import { overlaps, subtractIntervals } from '@/domain/availability/interval-math';
import type { BusyInterval } from '@/domain/booking/appointment';
import { busy } from './_fixtures';

/**
 * The one overlap rule and the one subtraction of the feature (002, D-019,
 * D-020). Everything else — free time in the agenda, CLOSED against FULL,
 * conflicts — is built on these two, so they are pinned down here.
 */

const DAY = '2026-09-18';

function labels(intervals: readonly BusyInterval[]): readonly string[] {
  return intervals.map(
    (part) =>
      `${part.startsAt.toZonedDateTimeISO('Europe/Madrid').toPlainTime().toString().slice(0, 5)}-` +
      `${part.endsAt.toZonedDateTimeISO('Europe/Madrid').toPlainTime().toString().slice(0, 5)}`,
  );
}

describe('overlaps — half-open, BR-013', () => {
  it('is true when the two share any minute', () => {
    expect(overlaps(busy(DAY, '10:00', '11:00'), busy(DAY, '10:59', '12:00'))).toBe(true);
  });

  it('is false when one ends exactly where the other starts', () => {
    expect(overlaps(busy(DAY, '10:00', '11:00'), busy(DAY, '11:00', '12:00'))).toBe(false);
    expect(overlaps(busy(DAY, '11:00', '12:00'), busy(DAY, '10:00', '11:00'))).toBe(false);
  });

  it('is true when one contains the other', () => {
    expect(overlaps(busy(DAY, '10:00', '20:00'), busy(DAY, '13:00', '14:00'))).toBe(true);
  });
});

describe('subtractIntervals', () => {
  it('leaves the base untouched when nothing is taken away', () => {
    expect(labels(subtractIntervals([busy(DAY, '10:00', '20:00')], []))).toEqual(['10:00-20:00']);
  });

  it('cuts a hole out of the middle', () => {
    expect(
      labels(subtractIntervals([busy(DAY, '10:00', '20:00')], [busy(DAY, '13:00', '14:00')])),
    ).toEqual(['10:00-13:00', '14:00-20:00']);
  });

  it('trims either end', () => {
    expect(
      labels(
        subtractIntervals(
          [busy(DAY, '10:00', '20:00')],
          [busy(DAY, '09:00', '11:00'), busy(DAY, '19:00', '21:00')],
        ),
      ),
    ).toEqual(['11:00-19:00']);
  });

  it('returns nothing when the base is covered, also by pieces that overlap each other', () => {
    expect(
      subtractIntervals(
        [busy(DAY, '10:00', '20:00')],
        [busy(DAY, '10:00', '15:00'), busy(DAY, '14:00', '20:00')],
      ),
    ).toEqual([]);
  });

  it('keeps a piece that only touches what is taken away', () => {
    expect(
      labels(subtractIntervals([busy(DAY, '10:00', '14:00')], [busy(DAY, '14:00', '16:00')])),
    ).toEqual(['10:00-14:00']);
  });

  it('works over several base stretches, in order, whatever order they come in', () => {
    expect(
      labels(
        subtractIntervals(
          [busy(DAY, '16:00', '20:00'), busy(DAY, '10:00', '14:00')],
          [busy(DAY, '12:00', '17:00')],
        ),
      ),
    ).toEqual(['10:00-12:00', '17:00-20:00']);
  });
});
