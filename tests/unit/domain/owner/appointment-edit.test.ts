import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import type { UnavailablePeriod } from '@/domain/catalog/salon';
import type { NonEmptyServiceList } from '@/domain/catalog/selection';
import { validateContact, type ValidatedContact } from '@/domain/contact/contact';
import { planAppointmentEdit } from '@/domain/owner/appointment-edit';
import { conflictSpanOf } from '@/domain/owner/conflict';
import { at, interval, MADRID, POLICY } from '../availability/_fixtures';

/**
 * 002, Historia 11: editing keeps the start and plans a span that may grow
 * (FR-071 to FR-075). Only what the growth lands on is in the way.
 */

const CORTE = { serviceId: 's1', name: 'Corte de pelo', durationMinutes: 30, priceCents: 1500 };
const BARBA = { serviceId: 's2', name: 'Diseño y corte de barba', durationMinutes: 30, priceCents: null };
const NOW = at('2026-09-18', '09:00');

function contact(phone = '600112233'): ValidatedContact {
  const validated = validateContact({ name: 'Ana López', phone, email: null }, { email: 'OPTIONAL' });
  if (!validated.ok) throw new Error('unreachable');
  return validated.value;
}

function appointment(id: string, from: string, to: string, overrides: Partial<Appointment> = {}): Appointment {
  return {
    id,
    status: 'CONFIRMED',
    origin: 'ONLINE',
    startsAt: at('2026-09-18', from),
    endsAt: at('2026-09-18', to),
    services: [CORTE],
    customer: { name: id === 'mine' ? 'Ana López' : 'Marta Ruiz', phone: '600112233', email: null },
    createdAt: at('2026-09-10', '10:00'),
    cancelledAt: null,
    cancelledBy: null,
    anonymizedAt: null,
    ...overrides,
  };
}

const MINE = appointment('mine', '11:00', '11:30');

function plan(
  overrides: Partial<{
    appointment: Appointment;
    services: NonEmptyServiceList;
    appointments: readonly Appointment[];
    unavailablePeriods: readonly UnavailablePeriod[];
    futureCountsForNewContact: { byPhone: number; byEmail: number } | null;
    now: typeof NOW;
  }> = {},
) {
  return planAppointmentEdit({
    appointment: overrides.appointment ?? MINE,
    services: overrides.services ?? [CORTE, BARBA],
    contact: contact(),
    openingIntervals: [interval(5, '10:00', '20:00')],
    appointments: overrides.appointments ?? [MINE],
    unavailablePeriods: overrides.unavailablePeriods ?? [],
    futureCountsForNewContact: overrides.futureCountsForNewContact ?? null,
    now: overrides.now ?? NOW,
    policy: POLICY,
    timezone: MADRID,
  });
}

describe('planAppointmentEdit', () => {
  it('keeps the start and ends at the start plus the new sum (escenario 1, FR-073)', () => {
    expect(plan()).toMatchObject({
      ok: true,
      value: { appointmentId: 'mine', startsAt: at('2026-09-18', '11:00'), endsAt: at('2026-09-18', '12:00'), conflicts: [] },
    });
  });

  it('names what the growth lands on (escenario 3, FR-074)', () => {
    const ana = appointment('ana', '11:30', '12:00');

    expect(plan({ appointments: [MINE, ana] })).toMatchObject({ ok: true, value: { conflicts: [{ id: 'ana' }] } });
  });

  it('never finds a conflict when shortening, nor in a period it already sat under', () => {
    const lunch = { id: 'p1', startsAt: at('2026-09-18', '10:30'), endsAt: at('2026-09-18', '11:30'), reason: 'Comida' };
    const long = appointment('mine', '11:00', '12:00', { services: [CORTE, BARBA] });

    expect(plan({ appointment: long, services: [CORTE], unavailablePeriods: [lunch] })).toMatchObject({
      ok: true,
      value: { endsAt: at('2026-09-18', '11:30'), conflicts: [] },
    });
    expect(plan({ appointment: MINE, services: [CORTE], unavailablePeriods: [lunch] })).toMatchObject({
      ok: true,
      value: { conflicts: [] },
    });
  });

  it('warns when the new end falls after closing', () => {
    const late = appointment('mine', '19:30', '20:00');

    expect(plan({ appointment: late, appointments: [late] })).toMatchObject({
      ok: true,
      value: { warnings: ['OUTSIDE_OPENING_HOURS'] },
    });
  });

  it('refuses a cancelled one (FR-042)', () => {
    expect(plan({ appointment: appointment('mine', '11:00', '11:30', { status: 'CANCELLED' }) })).toEqual({
      ok: false,
      error: 'ALREADY_CANCELLED',
    });
  });

  it('refuses one already over, measured by its current end, and edits one under way (FR-071)', () => {
    expect(plan({ now: at('2026-09-18', '11:30') })).toEqual({ ok: false, error: 'IN_THE_PAST' });
    expect(plan({ now: at('2026-09-18', '11:10') }).ok).toBe(true);
  });

  it('applies the contact limit only to a new contact (FR-075)', () => {
    expect(plan({ futureCountsForNewContact: { byPhone: 3, byEmail: 0 } })).toEqual({
      ok: false,
      error: 'CONTACT_LIMIT_REACHED',
    });
    expect(plan({ futureCountsForNewContact: null }).ok).toBe(true);
  });
});

describe('conflictSpanOf', () => {
  it('is the growth of an edited appointment, and nothing when it does not grow', () => {
    const base = {
      kind: 'EDIT_APPOINTMENT' as const,
      appointmentId: 'mine',
      startsAt: at('2026-09-18', '11:00'),
      previousEndsAt: at('2026-09-18', '11:30'),
      services: [CORTE] as NonEmptyServiceList,
      contact: contact(),
    };

    expect(conflictSpanOf({ ...base, endsAt: at('2026-09-18', '12:00') })).toEqual({
      startsAt: at('2026-09-18', '11:30'),
      endsAt: at('2026-09-18', '12:00'),
    });
    expect(conflictSpanOf({ ...base, endsAt: at('2026-09-18', '11:30') })).toBeNull();
  });
});
