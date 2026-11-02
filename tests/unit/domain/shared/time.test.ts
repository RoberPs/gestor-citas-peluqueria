import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  formatIsoDate,
  formatLocalTime,
  instantFromWallTime,
  localDateOf,
  zonedFrom,
} from '@/domain/shared/time';

const MADRID = 'Europe/Madrid';

describe('SalonTime', () => {
  describe('instant to salon wall time and back', () => {
    it('reads an instant as the wall time of the salon in summer', () => {
      const instant = Temporal.Instant.from('2026-09-18T09:30:00Z');

      expect(formatLocalTime(instant, MADRID)).toBe('11:30');
      expect(formatIsoDate(localDateOf(instant, MADRID))).toBe('2026-09-18');
    });

    it('reads the same UTC hour as a different wall time in winter', () => {
      const instant = Temporal.Instant.from('2026-12-18T09:30:00Z');

      expect(formatLocalTime(instant, MADRID)).toBe('10:30');
    });

    it('resolves a wall time to the instant with the offset of that date', () => {
      const summer = instantFromWallTime(
        Temporal.PlainDate.from('2026-09-18'),
        Temporal.PlainTime.from('10:00'),
        MADRID,
      );
      const winter = instantFromWallTime(
        Temporal.PlainDate.from('2026-12-18'),
        Temporal.PlainTime.from('10:00'),
        MADRID,
      );

      // Same opening hour, two different absolute moments: 10:00 is wall time.
      expect(summer.toString()).toBe('2026-09-18T08:00:00Z');
      expect(winter.toString()).toBe('2026-12-18T09:00:00Z');
    });

    it('round-trips instant to wall time and back', () => {
      const date = Temporal.PlainDate.from('2026-10-30');
      const time = Temporal.PlainTime.from('16:30');

      const instant = instantFromWallTime(date, time, MADRID);

      expect(formatLocalTime(instant, MADRID)).toBe('16:30');
      expect(formatIsoDate(localDateOf(instant, MADRID))).toBe('2026-10-30');
    });

    it('exposes the zoned view used for calendar arithmetic', () => {
      const zoned = zonedFrom(Temporal.Instant.from('2026-09-18T09:30:00Z'), MADRID);

      expect(zoned.hour).toBe(11);
      expect(zoned.minute).toBe(30);
      expect(zoned.timeZoneId).toBe(MADRID);
    });
  });

  describe('adding real minutes across the October change', () => {
    // Madrid moves from CEST to CET on 2026-10-25 at 03:00 local (01:00 UTC).
    it('adds real minutes, not wall-clock minutes, across the transition', () => {
      const start = instantFromWallTime(
        Temporal.PlainDate.from('2026-10-25'),
        Temporal.PlainTime.from('01:30'),
        MADRID,
      );

      const end = addMinutes(start, 90);

      // 90 real minutes later the wall clock reads 02:00, not 03:00: the hour
      // between 02:00 and 03:00 happens twice that night.
      expect(formatLocalTime(end, MADRID)).toBe('02:00');
      expect(end.epochMilliseconds - start.epochMilliseconds).toBe(90 * 60 * 1000);
    });

    it('keeps a 90 minute service 90 real minutes long on an ordinary day', () => {
      const start = instantFromWallTime(
        Temporal.PlainDate.from('2026-09-18'),
        Temporal.PlainTime.from('10:00'),
        MADRID,
      );

      const end = addMinutes(start, 90);

      expect(formatLocalTime(end, MADRID)).toBe('11:30');
      expect(end.epochMilliseconds - start.epochMilliseconds).toBe(90 * 60 * 1000);
    });

    it('interprets the same opening hour on both sides of the transition', () => {
      const before = instantFromWallTime(
        Temporal.PlainDate.from('2026-10-24'),
        Temporal.PlainTime.from('10:00'),
        MADRID,
      );
      const after = instantFromWallTime(
        Temporal.PlainDate.from('2026-10-25'),
        Temporal.PlainTime.from('10:00'),
        MADRID,
      );

      expect(formatLocalTime(before, MADRID)).toBe('10:00');
      expect(formatLocalTime(after, MADRID)).toBe('10:00');
      // 25 real hours apart: the night in between gained one.
      expect(after.epochMilliseconds - before.epochMilliseconds).toBe(25 * 60 * 60 * 1000);
    });
  });

  describe('HH:mm formatting', () => {
    it('pads hours and minutes to two digits', () => {
      const instant = instantFromWallTime(
        Temporal.PlainDate.from('2026-09-18'),
        Temporal.PlainTime.from('09:05'),
        MADRID,
      );

      expect(formatLocalTime(instant, MADRID)).toBe('09:05');
    });

    it('formats midnight as 00:00', () => {
      const instant = instantFromWallTime(
        Temporal.PlainDate.from('2026-09-18'),
        Temporal.PlainTime.from('00:00'),
        MADRID,
      );

      expect(formatLocalTime(instant, MADRID)).toBe('00:00');
    });
  });
});
