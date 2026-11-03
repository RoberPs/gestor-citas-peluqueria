import type { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import type { Appointment, BusyInterval } from '@/domain/booking/appointment';
import { applyReschedule } from '@/domain/booking/reschedule';
import type { OpeningInterval } from '@/domain/catalog/salon';
import { localDateOf } from '@/domain/shared/time';
import { at, busy, interval, MADRID, NOW, POLICY } from '../availability/_fixtures';

/**
 * Moving an appointment (Historia 6).
 *
 * The service cannot change: the signature takes no new one, so changing it is
 * not a runtime error but something that cannot be expressed (FR-024, D-011).
 * The duration used is the one frozen in the snapshot, not today's catalogue.
 */

const COLOR_SNAPSHOT = {
  serviceId: '00000000-0000-4000-8000-000000000012',
  name: 'Color',
  durationMinutes: 90,
  priceCents: 5500,
};

/** Friday 2026-09-18, 11:30 to 13:00. */
function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'b2e9c0de',
    status: 'CONFIRMED',
    startsAt: at('2026-09-18', '11:30'),
    endsAt: at('2026-09-18', '13:00'),
    services: [COLOR_SNAPSHOT],
    customer: { name: 'Ana', phone: '600112233', email: 'ana@example.com' },
    createdAt: at('2026-09-15', '10:00'),
    cancelledAt: null,
    anonymizedAt: null,
    ...overrides,
  };
}

type Options = {
  appointment?: Appointment;
  newStart?: Temporal.Instant;
  openingIntervals?: OpeningInterval[];
  isClosed?: boolean;
  confirmed?: BusyInterval[];
  now?: Temporal.Instant;
};

function reschedule(options: Options = {}) {
  const target = options.appointment ?? appointment();
  const newStart = options.newStart ?? at('2026-09-18', '16:00');

  return applyReschedule({
    appointment: target,
    newStart,
    date: localDateOf(newStart, MADRID),
    openingIntervals: options.openingIntervals ?? [interval(5, '10:00', '20:00')],
    isClosed: options.isClosed ?? false,
    confirmedAppointments: options.confirmed ?? [
      { startsAt: target.startsAt, endsAt: target.endsAt },
    ],
    now: options.now ?? NOW,
    policy: POLICY,
    timezone: MADRID,
  });
}

function failure(options: Options = {}) {
  const result = reschedule(options);
  if (result.ok) throw new Error('expected a rejection');
  return result.error;
}

describe('MOVED — the appointment changes slot', () => {
  it('returns the appointment at its new hour', () => {
    const result = reschedule({ newStart: at('2026-09-18', '16:00') });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.kind).toBe('MOVED');
    if (result.value.kind !== 'MOVED') throw new Error('unreachable');
    expect(result.value.appointment.startsAt.equals(at('2026-09-18', '16:00'))).toBe(true);
  });

  it('keeps the identity of the appointment, which is what keeps the link (FR-026)', () => {
    const original = appointment();

    const result = reschedule({ appointment: original, newStart: at('2026-09-18', '16:00') });

    if (!result.ok || result.value.kind !== 'MOVED') throw new Error('unreachable');
    expect(result.value.appointment.id).toBe(original.id);
    expect(result.value.appointment.status).toBe('CONFIRMED');
    expect(result.value.appointment.createdAt.equals(original.createdAt)).toBe(true);
    expect(result.value.appointment.customer).toEqual(original.customer);
  });

  it('uses the duration frozen in the snapshot, not one supplied from outside', () => {
    const result = reschedule({ newStart: at('2026-09-18', '16:00') });

    if (!result.ok || result.value.kind !== 'MOVED') throw new Error('unreachable');
    // 90 minutes, as agreed when it was booked.
    expect(result.value.appointment.endsAt.equals(at('2026-09-18', '17:30'))).toBe(true);
    expect(result.value.appointment.services).toEqual([COLOR_SNAPSHOT]);
  });

  it('leaves the original value untouched', () => {
    const original = appointment();

    reschedule({ appointment: original, newStart: at('2026-09-18', '16:00') });

    expect(original.startsAt.equals(at('2026-09-18', '11:30'))).toBe(true);
  });

  it('moves to another day inside the horizon', () => {
    const result = reschedule({
      newStart: at('2026-09-21', '10:00'),
      openingIntervals: [interval(1, '10:00', '20:00')],
    });

    expect(result.ok).toBe(true);
  });
});

describe('UNCHANGED — the client picked their own hour (escenario 5)', () => {
  it('reports no change rather than an error', () => {
    const result = reschedule({ newStart: at('2026-09-18', '11:30') });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({ kind: 'UNCHANGED' });
  });

  it('reports no change even when the deadline rules would still allow a move', () => {
    const result = reschedule({
      newStart: at('2026-09-18', '11:30'),
      now: at('2026-09-16', '10:00'),
    });

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.kind).toBe('UNCHANGED');
  });
});

describe('the appointment own slot does not block it (FR-027)', () => {
  it('allows a move that overlaps the hour it is leaving', () => {
    // 12:00 overlaps 11:30–13:00, which is this appointment's own slot.
    const result = reschedule({ newStart: at('2026-09-18', '12:00') });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'MOVED') throw new Error('unreachable');
    expect(result.value.appointment.startsAt.equals(at('2026-09-18', '12:00'))).toBe(true);
  });

  it('still refuses a slot somebody else holds', () => {
    const result = reschedule({
      newStart: at('2026-09-18', '16:00'),
      confirmed: [busy('2026-09-18', '16:00', '16:30')],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'SLOT_TAKEN' });
  });
});

describe('the rules that close rescheduling altogether', () => {
  it('refuses once less than 24 hours remain (BR-004)', () => {
    const error = failure({ now: at('2026-09-18', '09:00') });

    expect(error.kind).toBe('TOO_LATE');
  });

  it('refuses a cancelled appointment (BR-007)', () => {
    const cancelled = appointment({
      status: 'CANCELLED',
      cancelledAt: at('2026-09-16', '09:00'),
    });

    expect(failure({ appointment: cancelled, now: at('2026-09-16', '10:00') })).toEqual({
      kind: 'ALREADY_CANCELLED',
    });
  });

  it('refuses an appointment that has already happened (BR-010)', () => {
    expect(failure({ now: at('2026-09-19', '10:00') })).toEqual({ kind: 'ALREADY_COMPLETED' });
  });

  it('checks those rules before looking at the new slot at all', () => {
    // A cancelled appointment and an impossible new hour: the terminal state
    // is what the client is told, not the slot.
    const cancelled = appointment({
      status: 'CANCELLED',
      cancelledAt: at('2026-09-16', '09:00'),
    });

    expect(
      failure({
        appointment: cancelled,
        now: at('2026-09-16', '10:00'),
        newStart: at('2026-09-18', '03:00'),
      }),
    ).toEqual({ kind: 'ALREADY_CANCELLED' });
  });
});

describe('the new slot answers to the same four conditions as a booking (FR-003)', () => {
  it('refuses an hour the salon is not open for', () => {
    expect(failure({ newStart: at('2026-09-18', '09:00') })).toEqual({
      kind: 'OUTSIDE_OPENING_HOURS',
    });
  });

  it('refuses an hour whose 90 minutes would run past closing', () => {
    expect(failure({ newStart: at('2026-09-18', '19:00') })).toEqual({
      kind: 'OUTSIDE_OPENING_HOURS',
    });
  });

  it('refuses an hour that would cross a midday close', () => {
    expect(
      failure({
        newStart: at('2026-09-19', '13:00'),
        openingIntervals: [interval(6, '10:00', '14:00'), interval(6, '16:00', '20:00')],
      }),
    ).toEqual({ kind: 'OUTSIDE_OPENING_HOURS' });
  });

  it('refuses an hour off the grid, which only a tampered request produces', () => {
    expect(failure({ newStart: at('2026-09-18', '16:07') })).toEqual({ kind: 'NOT_ON_GRID' });
  });

  it('refuses an hour beyond the 60 day horizon', () => {
    const error = failure({ newStart: at('2026-11-20', '16:00') });

    expect(error.kind).toBe('BEYOND_HORIZON');
  });

  it('refuses an hour inside the two hour lead time', () => {
    const error = failure({
      appointment: appointment({
        startsAt: at('2026-09-25', '11:30'),
        endsAt: at('2026-09-25', '13:00'),
      }),
      newStart: at('2026-09-15', '11:00'),
      openingIntervals: [interval(2, '10:00', '20:00')],
    });

    expect(error.kind).toBe('TOO_LATE_TO_BOOK');
  });
});

describe('an appointment of several services (005, Historia 2)', () => {
  const CORTE_SNAPSHOT = {
    serviceId: '00000000-0000-4000-8000-000000000011',
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 1800,
  };
  const LAVADO_SNAPSHOT = {
    serviceId: '00000000-0000-4000-8000-000000000014',
    name: 'Lavado',
    durationMinutes: 30,
    priceCents: null,
  };

  /** Friday 2026-09-18, 11:30 to 12:30: two services of half an hour. */
  const twoServices = () =>
    appointment({
      endsAt: at('2026-09-18', '12:30'),
      services: [CORTE_SNAPSHOT, LAVADO_SNAPSHOT],
    });

  it('cannot move to a start where only half an hour fits (FR-017)', () => {
    // 19:30 would hold a single service; the appointment needs the whole hour.
    expect(failure({ appointment: twoServices(), newStart: at('2026-09-18', '19:30') })).toEqual({
      kind: 'OUTSIDE_OPENING_HOURS',
    });
  });

  it('keeps its services and its total duration when it moves', () => {
    const result = reschedule({ appointment: twoServices(), newStart: at('2026-09-18', '19:00') });

    if (!result.ok || result.value.kind !== 'MOVED') throw new Error('unreachable');
    expect(result.value.appointment.services).toEqual([CORTE_SNAPSHOT, LAVADO_SNAPSHOT]);
    expect(result.value.appointment.endsAt.equals(at('2026-09-18', '20:00'))).toBe(true);
  });

  it('still reports its own hour as unchanged', () => {
    expect(reschedule({ appointment: twoServices(), newStart: at('2026-09-18', '11:30') })).toEqual(
      { ok: true, value: { kind: 'UNCHANGED' } },
    );
  });
});
