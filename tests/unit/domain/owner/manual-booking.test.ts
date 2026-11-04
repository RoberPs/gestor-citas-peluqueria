import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import type { UnavailablePeriod } from '@/domain/catalog/salon';
import type { NonEmptyServiceList } from '@/domain/catalog/selection';
import { planManualBooking } from '@/domain/owner/manual-booking';
import { at, interval, MADRID, POLICY } from '../availability/_fixtures';

/**
 * 002, Historia 4: the owner's exemptions, case by case from the table of
 * D-025. What blocks goes in the error channel; what only warns travels inside
 * the success, because it prevents nothing (FR-028).
 */

const CORTE = { serviceId: 's1', name: 'Corte de pelo', durationMinutes: 30, priceCents: null };
const BARBA = { serviceId: 's2', name: 'Diseño y corte de barba', durationMinutes: 30, priceCents: null };

/** Friday 2026-09-18, 16:40 in the salon. */
const NOW = at('2026-09-18', '16:40');
const FRIDAY_OPENING = [interval(5, '10:00', '20:00')];

function appointment(id: string, from: string, to: string): Appointment {
  return {
    id,
    status: 'CONFIRMED',
    origin: 'ONLINE',
    startsAt: at('2026-09-18', from),
    endsAt: at('2026-09-18', to),
    services: [CORTE],
    customer: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    createdAt: at('2026-09-10', '10:00'),
    cancelledAt: null,
    cancelledBy: null,
    anonymizedAt: null,
  };
}

function plan(
  time: string,
  overrides: Partial<{
    services: NonEmptyServiceList;
    appointments: readonly Appointment[];
    unavailablePeriods: readonly UnavailablePeriod[];
    futureCountsForContact: { byPhone: number; byEmail: number } | null;
    excludeAppointmentId: string;
    date: string;
  }> = {},
) {
  return planManualBooking({
    startsAt: at(overrides.date ?? '2026-09-18', time),
    services: overrides.services ?? [CORTE],
    openingIntervals: FRIDAY_OPENING,
    appointments: overrides.appointments ?? [],
    unavailablePeriods: overrides.unavailablePeriods ?? [],
    futureCountsForContact:
      overrides.futureCountsForContact === undefined ? { byPhone: 0, byEmail: 0 } : overrides.futureCountsForContact,
    ...(overrides.excludeAppointmentId === undefined ? {} : { excludeAppointmentId: overrides.excludeAppointmentId }),
    now: NOW,
    policy: POLICY,
    timezone: MADRID,
  });
}

describe('planManualBooking', () => {
  it('plans a free slot with no conflict and no warning (escenario 1)', () => {
    expect(plan('17:30')).toEqual({
      ok: true,
      value: { startsAt: at('2026-09-18', '17:30'), endsAt: at('2026-09-18', '18:00'), conflicts: [], warnings: [] },
    });
  });

  it('lasts the sum of its services: two of 30 minutes take an hour (FR-027, D-030)', () => {
    const result = plan('17:00', { services: [CORTE, BARBA] });

    expect(result.ok && result.value.endsAt).toEqual(at('2026-09-18', '18:00'));
  });

  describe('blocks what the owner is not exempt from', () => {
    it('blocks a slot whose end has already gone by (FR-030, BR-009)', () => {
      expect(plan('16:00')).toEqual({ ok: false, error: 'IN_THE_PAST' });
    });

    it('lets a walk-in already under way be written down: its end is still ahead', () => {
      expect(plan('16:30').ok).toBe(true);
    });

    it.each([
      ['by phone', { byPhone: 3, byEmail: 0 }],
      ['by email', { byPhone: 0, byEmail: 3 }],
    ])('blocks the fourth future appointment of a contact, counted %s (FR-029)', (_name, counts) => {
      expect(plan('18:00', { futureCountsForContact: counts })).toEqual({ ok: false, error: 'CONTACT_LIMIT_REACHED' });
    });

    it('lets the third through', () => {
      expect(plan('18:00', { futureCountsForContact: { byPhone: 2, byEmail: 2 } }).ok).toBe(true);
    });

    it('does not count at all when moving: the appointment already counted', () => {
      expect(plan('18:00', { futureCountsForContact: null }).ok).toBe(true);
    });

    it.each(['17:10', '17:07'])('blocks a start off the 15 minute grid, %s (D-025)', (time) => {
      expect(plan(time)).toEqual({ ok: false, error: 'INVALID_START_GRANULARITY' });
    });

    it('takes a quarter past: the owner\'s grid is finer than the client\'s', () => {
      expect(plan('17:15').ok).toBe(true);
    });
  });

  describe('does not object to what she is exempt from (BR-007)', () => {
    it('ignores the minimum lead time: 17:00 at 16:40 is created without objection (escenario 3)', () => {
      expect(plan('17:00')).toMatchObject({ ok: true, value: { conflicts: [], warnings: [] } });
    });

    it('ignores the booking horizon', () => {
      expect(plan('11:00', { date: '2027-03-19' })).toMatchObject({ ok: true, value: { warnings: [] } });
    });
  });

  describe('warns outside the opening hours, and lets it be confirmed (FR-028)', () => {
    it.each([
      ['a start after closing (escenario 4)', '20:30'],
      ['an end past closing', '19:45'],
      ['a start before opening', '09:30'],
    ])('warns about %s', (_name, time) => {
      const result = plan(time, { date: '2026-09-25' });

      expect(result).toMatchObject({ ok: true, value: { warnings: ['OUTSIDE_OPENING_HOURS'] } });
    });

    it('does not warn when the appointment ends exactly at closing', () => {
      expect(plan('19:30')).toMatchObject({ ok: true, value: { warnings: [] } });
    });
  });

  describe('names what is in the way, without blocking (FR-032, FR-033)', () => {
    it('names an overlapping appointment and a period', () => {
      const result = plan('17:00', {
        services: [CORTE, BARBA],
        appointments: [appointment('a1', '17:45', '18:15')],
        unavailablePeriods: [
          { id: 'p1', startsAt: at('2026-09-18', '16:45'), endsAt: at('2026-09-18', '17:15'), reason: 'Recado' },
        ],
      });

      expect(result.ok && result.value.conflicts.map((conflict) => conflict.id)).toEqual(['p1', 'a1']);
    });

    it('leaves out the appointment that is being moved', () => {
      const result = plan('17:00', {
        appointments: [appointment('a1', '16:45', '17:15')],
        excludeAppointmentId: 'a1',
        futureCountsForContact: null,
      });

      expect(result.ok && result.value.conflicts).toEqual([]);
    });
  });
});
