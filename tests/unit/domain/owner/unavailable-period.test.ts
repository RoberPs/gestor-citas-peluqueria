import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import type { UnavailablePeriod } from '@/domain/catalog/salon';
import {
  normalizePeriodReason,
  validatePeriod,
  validateShortening,
  wholeDaysOf,
} from '@/domain/owner/unavailable-period';
import { at, MADRID, NOW } from '../availability/_fixtures';

/**
 * 002, Historia 3: what a period of blocked time has to be before it is saved
 * (FR-018, FR-019, FR-023) and the past it cannot reach (BR-009).
 */

function span(fromDate: string, from: string, toDate: string, to: string) {
  return { startsAt: at(fromDate, from), endsAt: at(toDate, to) };
}

function lunch(): UnavailablePeriod {
  return { id: 'p-1', ...span('2026-09-18', '13:00', '2026-09-18', '15:00'), reason: 'Comida' };
}

describe('validatePeriod (FR-018, FR-023)', () => {
  it('accepts a lunch hour on the 15 minute grid', () => {
    const result = validatePeriod({ ...span('2026-09-18', '13:15', '2026-09-18', '14:45'), now: NOW, timezone: MADRID });

    expect(result).toEqual({ ok: true, value: span('2026-09-18', '13:15', '2026-09-18', '14:45') });
  });

  it('accepts three weeks away as one period', () => {
    const result = validatePeriod({ ...span('2026-10-01', '00:00', '2026-10-22', '00:00'), now: NOW, timezone: MADRID });

    expect(result.ok).toBe(true);
  });

  it.each([
    ['an end before the start', span('2026-09-18', '14:00', '2026-09-18', '13:00')],
    ['an end equal to the start', span('2026-09-18', '13:00', '2026-09-18', '13:00')],
  ])('rejects %s', (_name, input) => {
    expect(validatePeriod({ ...input, now: NOW, timezone: MADRID })).toEqual({
      ok: false,
      error: 'END_NOT_AFTER_START',
    });
  });

  it.each([
    ['a start off the grid', span('2026-09-18', '13:10', '2026-09-18', '14:00')],
    ['an end off the grid', span('2026-09-18', '13:00', '2026-09-18', '14:05')],
    [
      'seconds on the start',
      { startsAt: at('2026-09-18', '13:00').add({ seconds: 1 }), endsAt: at('2026-09-18', '14:00') },
    ],
  ])('rejects %s', (_name, input) => {
    expect(validatePeriod({ ...input, now: NOW, timezone: MADRID })).toEqual({
      ok: false,
      error: 'INVALID_GRANULARITY',
    });
  });

  it('measures the grid in the salon wall clock, also on the day the clocks go back', () => {
    // 2026-10-25: 03:00 summer time becomes 02:00 winter time in Madrid.
    const result = validatePeriod({ ...span('2026-10-25', '01:45', '2026-10-25', '03:15'), now: NOW, timezone: MADRID });

    expect(result.ok).toBe(true);
  });

  it('rejects a period that is already over (BR-009)', () => {
    const now = at('2026-09-18', '15:00');

    expect(validatePeriod({ ...span('2026-09-18', '13:00', '2026-09-18', '15:00'), now, timezone: MADRID })).toEqual({
      ok: false,
      error: 'ALREADY_OVER',
    });
  });

  it('accepts one under way: the rest of the afternoon, blocked at 13:30', () => {
    const now = at('2026-09-18', '13:30');

    expect(validatePeriod({ ...span('2026-09-18', '13:00', '2026-09-18', '20:00'), now, timezone: MADRID }).ok).toBe(true);
  });
});

describe('validateShortening (FR-019)', () => {
  it.each([
    ['from the end', span('2026-09-18', '13:00', '2026-09-18', '14:00')],
    ['from the start', span('2026-09-18', '14:00', '2026-09-18', '15:00')],
    ['from both ends', span('2026-09-18', '13:30', '2026-09-18', '14:30')],
  ])('accepts a span inside the old one, %s', (_name, input) => {
    expect(validateShortening({ current: lunch(), ...input, now: NOW, timezone: MADRID })).toEqual({
      ok: true,
      value: input,
    });
  });

  it.each([
    ['starts earlier', span('2026-09-18', '12:45', '2026-09-18', '14:00')],
    ['ends later', span('2026-09-18', '13:00', '2026-09-18', '15:15')],
  ])('rejects one that %s: that is lengthening, not shortening', (_name, input) => {
    expect(validateShortening({ current: lunch(), ...input, now: NOW, timezone: MADRID })).toEqual({
      ok: false,
      error: 'NOT_CONTAINED',
    });
  });

  it('applies the same rules as creating one', () => {
    expect(
      validateShortening({ current: lunch(), ...span('2026-09-18', '14:00', '2026-09-18', '14:00'), now: NOW, timezone: MADRID }),
    ).toEqual({ ok: false, error: 'END_NOT_AFTER_START' });
    expect(
      validateShortening({ current: lunch(), ...span('2026-09-18', '13:00', '2026-09-18', '14:10'), now: NOW, timezone: MADRID }),
    ).toEqual({ ok: false, error: 'INVALID_GRANULARITY' });
  });

  it('leaves a period that is over as it was (BR-009)', () => {
    const now = at('2026-09-18', '16:00');

    expect(
      validateShortening({ current: lunch(), ...span('2026-09-18', '13:00', '2026-09-18', '14:00'), now, timezone: MADRID }),
    ).toEqual({ ok: false, error: 'ALREADY_OVER' });
  });
});

describe('wholeDaysOf', () => {
  it('runs from 00:00 of the first day to 00:00 of the day after the last', () => {
    const days = wholeDaysOf(Temporal.PlainDate.from('2026-10-10'), Temporal.PlainDate.from('2026-10-17'), MADRID);

    expect(days).toEqual(span('2026-10-10', '00:00', '2026-10-18', '00:00'));
  });

  it('keeps the 25 real hours of the day the clocks go back', () => {
    const day = Temporal.PlainDate.from('2026-10-25');
    const days = wholeDaysOf(day, day, MADRID);

    expect(days.endsAt.since(days.startsAt).total('hours')).toBe(25);
  });

  it('turns a last day before the first into a span that validatePeriod rejects', () => {
    const days = wholeDaysOf(Temporal.PlainDate.from('2026-10-17'), Temporal.PlainDate.from('2026-10-10'), MADRID);

    expect(validatePeriod({ ...days, now: NOW, timezone: MADRID })).toEqual({ ok: false, error: 'END_NOT_AFTER_START' });
  });
});

describe('normalizePeriodReason (FR-018)', () => {
  it.each([
    [null, null],
    ['', null],
    ['   ', null],
    ['  Comida ', 'Comida'],
  ])('turns %j into %j', (input, expected) => {
    expect(normalizePeriodReason(input)).toBe(expected);
  });
});
