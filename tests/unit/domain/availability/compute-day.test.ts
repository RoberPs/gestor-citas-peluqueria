import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { computeDaySlots } from '@/domain/availability/compute-day';
import {
  at,
  busy,
  FRIDAY,
  interval,
  MADRID,
  NOW,
  POLICY,
  SATURDAY,
  times,
  wholeDay,
} from './_fixtures';

/**
 * The four conditions of FR-003, one at a time and then together.
 *
 * Every scenario here is one of the acceptance scenarios of Historia 1, stated
 * in the same terms the spec states them.
 */

type Options = {
  date?: Temporal.PlainDate;
  openingIntervals?: ReturnType<typeof interval>[];
  unavailable?: ReturnType<typeof busy>[];
  durationMinutes?: number;
  confirmed?: ReturnType<typeof busy>[];
  now?: Temporal.Instant;
  currentAppointmentStart?: Temporal.Instant;
};

function slots(options: Options = {}) {
  const date = options.date ?? FRIDAY;
  return computeDaySlots({
    date,
    openingIntervals: options.openingIntervals ?? [interval(5, '10:00', '20:00')],
    unavailablePeriods: options.unavailable ?? [],
    serviceDurationMinutes: options.durationMinutes ?? 30,
    confirmedAppointments: options.confirmed ?? [],
    now: options.now ?? NOW,
    policy: POLICY,
    timezone: MADRID,
    ...(options.currentAppointmentStart === undefined
      ? {}
      : { currentAppointmentStart: options.currentAppointmentStart }),
  });
}

describe('Historia 1, escenario 1 — an empty day on the half hour', () => {
  it('offers 10:00 to 19:30 for a 30 minute service', () => {
    const list = times(slots());

    expect(list[0]).toBe('10:00');
    expect(list.at(-1)).toBe('19:30');
    expect(list).toHaveLength(20);
    expect(list).toContain('14:30');
  });
});

describe('Historia 1, escenario 2 — the service must finish before closing', () => {
  it('stops offering Color at 18:30 when the salon closes at 20:00', () => {
    const list = times(slots({ durationMinutes: 90 }));

    expect(list.at(-1)).toBe('18:30');
    expect(list).not.toContain('19:00');
    expect(list).not.toContain('19:30');
  });

  it('still offers 19:00 and 19:30 for a 30 minute service', () => {
    const list = times(slots());

    expect(list).toContain('19:00');
    expect(list).toContain('19:30');
  });

  it('offers a start whose end lands exactly on closing time', () => {
    const list = times(slots({ durationMinutes: 60 }));

    expect(list.at(-1)).toBe('19:00');
  });
});

describe('Historia 1, escenario 3 — the midday close (FR-007a, BR-002)', () => {
  const saturday = [interval(6, '10:00', '14:00'), interval(6, '16:00', '20:00')];

  it('offers nothing between 14:00 and 16:00', () => {
    const list = times(slots({ date: SATURDAY, openingIntervals: saturday, durationMinutes: 90 }));

    expect(list.filter((time) => time >= '14:00' && time < '16:00')).toEqual([]);
  });

  it('ends the morning at 12:30 and starts the afternoon at 16:00 for Color', () => {
    const list = times(slots({ date: SATURDAY, openingIntervals: saturday, durationMinutes: 90 }));

    const morning = list.filter((time) => time < '14:00');
    const afternoon = list.filter((time) => time >= '16:00');

    expect(morning.at(-1)).toBe('12:30');
    expect(afternoon[0]).toBe('16:00');
  });

  it('does not offer 13:00 for a 90 minute service: it would end at 14:30, already closed', () => {
    const list = times(slots({ date: SATURDAY, openingIntervals: saturday, durationMinutes: 90 }));

    expect(list).not.toContain('13:00');
  });

  it('does offer 13:00 for a 30 minute service, which fits the morning stretch', () => {
    const list = times(slots({ date: SATURDAY, openingIntervals: saturday, durationMinutes: 30 }));

    expect(list).toContain('13:00');
    expect(list).toContain('13:30');
    expect(list).not.toContain('14:00');
  });
});

describe('Historia 1, escenario 4 — an existing confirmed appointment', () => {
  it('hides 10:00, 10:30 and 11:00 behind a 10:00 to 11:30 appointment', () => {
    const list = times(slots({ confirmed: [busy('2026-09-18', '10:00', '11:30')] }));

    expect(list).not.toContain('10:00');
    expect(list).not.toContain('10:30');
    expect(list).not.toContain('11:00');
  });

  it('offers 11:30, because the range is half-open (BR-013)', () => {
    const list = times(slots({ confirmed: [busy('2026-09-18', '10:00', '11:30')] }));

    expect(list).toContain('11:30');
  });

  it('offers a start whose service ends exactly when the next appointment begins', () => {
    const list = times(slots({ confirmed: [busy('2026-09-18', '11:00', '12:00')] }));

    expect(list).toContain('10:30');
    expect(list).not.toContain('11:00');
  });

  it('hides a start whose 90 minutes would swallow a later appointment', () => {
    const list = times(
      slots({ durationMinutes: 90, confirmed: [busy('2026-09-18', '11:00', '11:30')] }),
    );

    expect(list).not.toContain('10:00');
    expect(list).not.toContain('10:30');
    expect(list).toContain('11:30');
  });
});

describe('Historia 1, escenario 5 — the two hour lead time (BR-003)', () => {
  it('offers 11:30 first when it is 09:30 today', () => {
    const list = times(
      slots({
        date: Temporal.PlainDate.from('2026-09-15'),
        openingIntervals: [interval(2, '10:00', '20:00')],
        now: at('2026-09-15', '09:30'),
      }),
    );

    expect(list[0]).toBe('11:30');
    expect(list).not.toContain('10:00');
    expect(list).not.toContain('11:00');
  });

  it('offers a start that falls exactly on the two hour boundary', () => {
    const list = times(
      slots({
        date: Temporal.PlainDate.from('2026-09-15'),
        openingIntervals: [interval(2, '10:00', '20:00')],
        now: at('2026-09-15', '10:00'),
      }),
    );

    expect(list[0]).toBe('12:00');
  });
});

describe('a closed day (FR-007a)', () => {
  it('offers nothing on a day an unavailable period covers whole', () => {
    expect(slots({ unavailable: [wholeDay('2026-09-18')] })).toEqual([]);
  });

  it('offers nothing when the weekday has no stretches', () => {
    expect(slots({ openingIntervals: [] })).toEqual([]);
  });
});

describe('the 60 day horizon (BR-011)', () => {
  it('offers slots on the last day of the horizon', () => {
    const lastDay = Temporal.PlainDate.from('2026-11-14');

    const list = times(
      slots({
        date: lastDay,
        openingIntervals: [interval(6, '10:00', '20:00')],
      }),
    );

    expect(list.length).toBeGreaterThan(0);
  });

  it('offers nothing the day after the horizon', () => {
    const beyond = Temporal.PlainDate.from('2026-11-15');

    expect(slots({ date: beyond, openingIntervals: [interval(7, '10:00', '20:00')] })).toEqual([]);
  });
});

describe('the slot each appointment already holds (FR-027)', () => {
  const current = at('2026-09-18', '11:00');

  it('offers the current slot and marks it, instead of hiding it as busy', () => {
    const list = slots({
      confirmed: [busy('2026-09-18', '11:00', '11:30')],
      currentAppointmentStart: current,
    });

    const own = list.find((slot) => slot.localTime === '11:00');

    expect(own?.isCurrentAppointment).toBe(true);
  });

  it('frees the slots the current appointment was blocking for a longer service', () => {
    const list = times(
      slots({
        durationMinutes: 90,
        confirmed: [busy('2026-09-18', '11:00', '11:30')],
        currentAppointmentStart: current,
      }),
    );

    expect(list).toContain('10:00');
    expect(list).toContain('10:30');
  });

  it('still hides slots taken by somebody else', () => {
    const list = times(
      slots({
        confirmed: [busy('2026-09-18', '11:00', '11:30'), busy('2026-09-18', '15:00', '15:30')],
        currentAppointmentStart: current,
      }),
    );

    expect(list).not.toContain('15:00');
  });

  it('marks nothing when no current appointment is passed', () => {
    const list = slots();

    expect(list.every((slot) => slot.isCurrentAppointment === false)).toBe(true);
  });
});

describe('what a slot carries', () => {
  it('formats both ends in salon wall time so the client does no arithmetic', () => {
    const list = slots({ durationMinutes: 90 });

    expect(list[0]?.localTime).toBe('10:00');
    expect(list[0]?.endsLocalTime).toBe('11:30');
  });

  it('carries the absolute instant, which is what gets sent back when booking', () => {
    const list = slots();

    expect(list[0]?.startsAt.equals(at('2026-09-18', '10:00'))).toBe(true);
  });
});

describe('unavailable periods count as busy (002, FR-020, BR-002)', () => {
  it('offers no start that overlaps a blocked lunch hour (Historia 3, escenario 1)', () => {
    const list = times(
      slots({ durationMinutes: 45, unavailable: [busy('2026-09-18', '13:00', '14:00')] }),
    );

    expect(list).toContain('12:00');
    expect(list).not.toContain('12:30');
    expect(list).not.toContain('13:00');
    expect(list).not.toContain('13:30');
    expect(list).toContain('14:00');
  });

  it('lets a service start exactly when a period ends: the range is half-open (BR-013)', () => {
    expect(times(slots({ unavailable: [busy('2026-09-18', '10:00', '11:00')] }))[0]).toBe('11:00');
  });

  it('blocks the day with a period that began days earlier', () => {
    const holidays = { startsAt: at('2026-09-10', '00:00'), endsAt: at('2026-09-19', '00:00') };

    expect(slots({ unavailable: [holidays] })).toEqual([]);
  });

  it('applies periods and appointments together, with one rule for both', () => {
    const list = times(
      slots({
        confirmed: [busy('2026-09-18', '10:00', '12:00')],
        unavailable: [busy('2026-09-18', '12:00', '19:30')],
      }),
    );

    expect(list).toEqual(['19:30']);
  });
});
