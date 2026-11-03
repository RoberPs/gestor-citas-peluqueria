import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import type { UnavailablePeriod } from '@/domain/catalog/salon';
import { buildAgendaDay, isPastSlot, type TimelineEntry } from '@/domain/owner/agenda';
import { at, interval, MADRID } from '../availability/_fixtures';

/**
 * 002, T059 and T060: the owner's day as a timeline (FR-011), CLOSED against
 * "no appointments" (FR-017, D-020), and the cut of the past at the END of an
 * appointment (FR-016, BR-009).
 */

const FRIDAY = Temporal.PlainDate.from('2026-09-18');
const OPENING = [interval(5, '10:00', '20:00')];

function appointment(from: string, to: string, overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: `a-${from}`,
    status: 'CONFIRMED',
    origin: 'ONLINE',
    startsAt: at('2026-09-18', from),
    endsAt: at('2026-09-18', to),
    services: [{ serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: 1800 }],
    customer: { name: 'Ana', phone: '600112233', email: 'ana@example.com' },
    createdAt: at('2026-09-10', '10:00'),
    cancelledAt: null,
    cancelledBy: null,
    anonymizedAt: null,
    ...overrides,
  };
}

function period(from: string, to: string, reason: string | null = 'Comida'): UnavailablePeriod {
  return { id: `p-${from}`, startsAt: at('2026-09-18', from), endsAt: at('2026-09-18', to), reason };
}

function day(options: {
  appointments?: Appointment[];
  periods?: UnavailablePeriod[];
  opening?: typeof OPENING;
  now?: Temporal.Instant;
}) {
  return buildAgendaDay({
    date: FRIDAY,
    openingIntervals: options.opening ?? OPENING,
    appointments: options.appointments ?? [],
    unavailablePeriods: options.periods ?? [],
    now: options.now ?? at('2026-09-15', '10:00'),
    timezone: MADRID,
  });
}

function shape(entries: readonly TimelineEntry[]): readonly string[] {
  const hhmm = (instant: Temporal.Instant) =>
    instant.toZonedDateTimeISO(MADRID).toPlainTime().toString().slice(0, 5);

  return entries.map((entry) => {
    switch (entry.kind) {
      case 'APPOINTMENT':
        return `cita ${hhmm(entry.appointment.startsAt)}-${hhmm(entry.appointment.endsAt)}`;
      case 'UNAVAILABLE':
        return `bloqueo ${hhmm(entry.period.startsAt)}-${hhmm(entry.period.endsAt)}`;
      case 'FREE':
        return `libre ${hhmm(entry.startsAt)}-${hhmm(entry.endsAt)}`;
    }
  });
}

describe('buildAgendaDay — the timeline (FR-011)', () => {
  it('lays out appointments, blocked time and free time in order, with nothing free overlapping', () => {
    const result = day({
      appointments: [appointment('16:00', '16:30'), appointment('10:30', '11:30')],
      periods: [period('13:00', '14:00')],
    });

    expect(shape(result.entries)).toEqual([
      'libre 10:00-10:30',
      'cita 10:30-11:30',
      'libre 11:30-13:00',
      'bloqueo 13:00-14:00',
      'libre 14:00-16:00',
      'cita 16:00-16:30',
      'libre 16:30-20:00',
    ]);
  });

  it('shows a period and an appointment that overlap both: a block cancels nobody (FR-022)', () => {
    const result = day({
      appointments: [appointment('13:30', '14:30')],
      periods: [period('13:00', '14:00')],
    });

    expect(shape(result.entries)).toEqual([
      'libre 10:00-13:00',
      'bloqueo 13:00-14:00',
      'cita 13:30-14:30',
      'libre 14:30-20:00',
    ]);
  });

  it('does not count a cancelled appointment as busy when it is shown (FR-015)', () => {
    const cancelled = appointment('10:00', '11:00', {
      status: 'CANCELLED',
      cancelledAt: at('2026-09-14', '10:00'),
      cancelledBy: 'CUSTOMER',
    });

    expect(shape(day({ appointments: [cancelled] }).entries)).toEqual([
      'cita 10:00-11:00',
      'libre 10:00-20:00',
    ]);
  });

  it('keeps an appointment outside the opening hours on the timeline', () => {
    expect(shape(day({ appointments: [appointment('20:30', '21:00')] }).entries).at(-1)).toBe(
      'cita 20:30-21:00',
    );
  });
});

describe('CLOSED against "no appointments" (FR-017, D-020)', () => {
  it('is closed, and empty, on a weekday with no stretches', () => {
    const result = day({ opening: [] });

    expect(result.isClosed).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it('is closed when a period covers the whole opening, and shows that period', () => {
    const result = day({ periods: [period('00:00', '23:59', 'Festivo')] });

    expect(result.isClosed).toBe(true);
    expect(shape(result.entries)).toEqual(['bloqueo 00:00-23:59']);
  });

  it('is open with no appointments when it has opening time and nobody booked', () => {
    const result = day({});

    expect(result.isClosed).toBe(false);
    expect(shape(result.entries)).toEqual(['libre 10:00-20:00']);
  });
});

describe('the past is read-only (FR-016, BR-009)', () => {
  it('cuts at the END of an appointment: one under way is not past', () => {
    const under = appointment('10:00', '11:00');

    expect(isPastSlot(under.endsAt, at('2026-09-18', '10:30'))).toBe(false);
    expect(isPastSlot(under.endsAt, at('2026-09-18', '11:00'))).toBe(true);
  });

  it('marks each appointment past or not by that same cut', () => {
    const result = day({
      appointments: [appointment('10:00', '11:00'), appointment('12:00', '13:00')],
      now: at('2026-09-18', '12:30'),
    });

    const pasts = result.entries.flatMap((entry) =>
      entry.kind === 'APPOINTMENT' ? [entry.isPast] : [],
    );
    expect(pasts).toEqual([true, false]);
  });

  it('makes the whole day read-only only once it is over in the salon zone', () => {
    expect(day({ now: at('2026-09-18', '23:59') }).isReadOnly).toBe(false);
    expect(day({ now: at('2026-09-19', '00:00') }).isReadOnly).toBe(true);
  });
});
