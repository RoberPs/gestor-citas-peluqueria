import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import type { UnavailablePeriod } from '@/domain/catalog/salon';
import { validateContact, type ValidatedContact } from '@/domain/contact/contact';
import {
  buildResolutionPlan,
  shorteningsThatFit,
  checkAcknowledgement,
  computeStateToken,
  detectConflicts,
  type Conflict,
  type Resolution,
  type ResolutionIntent,
} from '@/domain/owner/conflict';
import { at, MADRID } from '../availability/_fixtures';

/**
 * 002: what gets in the way of an operation, named so the owner can decide
 * (FR-022, FR-033), and the fingerprint FR-038 compares (D-024). Historia 3
 * uses it to block time over appointments; Historia 6 builds on it.
 */

const sha256 = (input: string) => createHash('sha256').update(input).digest('hex');

function appointment(id: string, from: string, to: string, overrides: Partial<Appointment> = {}): Appointment {
  return {
    id,
    status: 'CONFIRMED',
    origin: 'ONLINE',
    startsAt: at('2026-09-18', from),
    endsAt: at('2026-09-18', to),
    services: [
      { serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: 1800 },
      { serviceId: 's2', name: 'Lavado', durationMinutes: 30, priceCents: null },
    ],
    customer: { name: 'Ana López', phone: '600112233', email: null },
    createdAt: at('2026-09-10', '10:00'),
    cancelledAt: null,
    cancelledBy: null,
    anonymizedAt: null,
    ...overrides,
  };
}

function period(id: string, from: string, to: string): UnavailablePeriod {
  return { id, startsAt: at('2026-09-18', from), endsAt: at('2026-09-18', to), reason: 'Comida' };
}

const NOW = at('2026-09-15', '10:00');

function validContact(): ValidatedContact {
  const contact = validateContact({ name: 'Luis', phone: '600998877', email: null }, { email: 'OPTIONAL' });
  if (!contact.ok) throw new Error('unreachable');
  return contact.value;
}

const LUNCH = { startsAt: at('2026-09-18', '13:00'), endsAt: at('2026-09-18', '14:00') };

describe('detectConflicts', () => {
  it('names an appointment by its customer, all its services and its span (FR-033)', () => {
    const conflicts = detectConflicts({ ...LUNCH, appointments: [appointment('a1', '13:00', '14:00')], periods: [] });

    expect(conflicts).toEqual([
      {
        kind: 'APPOINTMENT',
        id: 'a1',
        customerName: 'Ana López',
        serviceNames: ['Corte', 'Lavado'],
        startsAt: at('2026-09-18', '13:00'),
        endsAt: at('2026-09-18', '14:00'),
      },
    ]);
  });

  it('counts one minute of overlap the same as a full one (clarificación 2026-09-16)', () => {
    const conflicts = detectConflicts({ ...LUNCH, appointments: [appointment('a1', '12:01', '13:01')], periods: [] });

    expect(conflicts.map((conflict) => conflict.id)).toEqual(['a1']);
  });

  it('leaves out what only touches an end, and what is cancelled (BR-013)', () => {
    const conflicts = detectConflicts({
      ...LUNCH,
      appointments: [
        appointment('before', '12:30', '13:00'),
        appointment('after', '14:00', '14:30'),
        appointment('cancelled', '13:00', '13:30', { status: 'CANCELLED' }),
      ],
      periods: [],
    });

    expect(conflicts).toEqual([]);
  });

  it('names a period by its span and reason, in chronological order with the appointments', () => {
    const conflicts = detectConflicts({
      ...LUNCH,
      appointments: [appointment('a1', '13:30', '14:00')],
      periods: [period('p1', '12:00', '13:15')],
    });

    expect(conflicts.map((conflict) => `${conflict.kind} ${conflict.id}`)).toEqual([
      'UNAVAILABLE_PERIOD p1',
      'APPOINTMENT a1',
    ]);
    expect(conflicts[0]).toMatchObject({ reason: 'Comida' });
  });

  it('leaves out the appointment being moved (excludeAppointmentId)', () => {
    const conflicts = detectConflicts({
      ...LUNCH,
      appointments: [appointment('a1', '13:00', '14:00')],
      periods: [],
      excludeAppointmentId: 'a1',
    });

    expect(conflicts).toEqual([]);
  });

  it('names an anonymised appointment with no customer', () => {
    const conflicts = detectConflicts({
      ...LUNCH,
      appointments: [appointment('a1', '13:00', '14:00', { customer: null })],
      periods: [],
    });

    expect(conflicts[0]).toMatchObject({ customerName: null });
  });
});

describe('computeStateToken (D-024)', () => {
  const conflicts = detectConflicts({
    ...LUNCH,
    appointments: [appointment('a1', '13:00', '13:30'), appointment('a2', '13:30', '14:00')],
    periods: [],
  });

  it('is deterministic and does not depend on the order', () => {
    expect(computeStateToken(conflicts, sha256)).toBe(computeStateToken([...conflicts].reverse(), sha256));
  });

  it.each<[string, (conflict: Conflict) => Conflict]>([
    ['the span', (conflict) => ({ ...conflict, endsAt: conflict.endsAt.add({ minutes: 15 }) })],
    [
      'the customer',
      (conflict) => (conflict.kind === 'APPOINTMENT' ? { ...conflict, customerName: 'Otra' } : conflict),
    ],
    [
      'the services',
      (conflict) => (conflict.kind === 'APPOINTMENT' ? { ...conflict, serviceNames: ['Corte'] } : conflict),
    ],
  ])('changes when %s of one of them changes', (_name, change) => {
    const [first, ...rest] = conflicts;
    if (first === undefined) throw new Error('unreachable');

    expect(computeStateToken([change(first), ...rest], sha256)).not.toBe(computeStateToken(conflicts, sha256));
  });

  it('changes when one appears or goes away', () => {
    expect(computeStateToken(conflicts.slice(1), sha256)).not.toBe(computeStateToken(conflicts, sha256));
  });
});

describe('checkAcknowledgement (FR-022)', () => {
  const conflicts = detectConflicts({
    ...LUNCH,
    appointments: [appointment('a1', '13:00', '13:30'), appointment('a2', '13:30', '14:00')],
    periods: [],
  });

  it('accepts every appointment acknowledged, in any order', () => {
    expect(checkAcknowledgement(conflicts, ['a2', 'a1'])).toEqual({ ok: true, value: ['a1', 'a2'] });
  });

  it('refuses while one is left unacknowledged', () => {
    expect(checkAcknowledgement(conflicts, ['a1'])).toEqual({ ok: false, error: 'UNRESOLVED_CONFLICT' });
  });

  it('refuses one that is not in the way', () => {
    expect(checkAcknowledgement(conflicts, ['a1', 'a2', 'a3'])).toEqual({ ok: false, error: 'UNKNOWN_TARGET' });
  });

  it('has nothing to acknowledge when nothing is in the way', () => {
    expect(checkAcknowledgement([], [])).toEqual({ ok: true, value: [] });
  });
});

describe('buildResolutionPlan (FR-034, FR-035)', () => {
  const SPAN = { startsAt: at('2026-09-18', '16:00'), endsAt: at('2026-09-18', '17:00') };
  const create: ResolutionIntent = {
    kind: 'CREATE_APPOINTMENT',
    id: 'new',
    ...SPAN,
    services: [{ serviceId: 's1', name: 'Corte', durationMinutes: 60, priceCents: null }],
    contact: validContact(),
    createdAt: at('2026-09-15', '10:00'),
  };
  const conflicts = detectConflicts({
    ...SPAN,
    appointments: [appointment('a1', '15:45', '16:30')],
    periods: [period('p1', '16:30', '18:00')],
  });

  function build(resolution: Resolution, intent: ResolutionIntent = create, inTheWay = conflicts) {
    return buildResolutionPlan({ intent, conflicts: inTheWay, resolution, now: NOW, timezone: MADRID });
  }

  it('needs no resolution when nothing is in the way', () => {
    expect(build({}, create, [])).toEqual({
      ok: true,
      value: { intent: create, cancelAppointments: [], deletePeriods: [], shortenPeriods: [], at: NOW },
    });
  });

  it('cancels the appointment and deletes the period in the same plan', () => {
    expect(build({ cancelAppointments: ['a1'], deletePeriods: ['p1'] })).toEqual({
      ok: true,
      value: { intent: create, cancelAppointments: ['a1'], deletePeriods: ['p1'], shortenPeriods: [], at: NOW },
    });
  });

  it('shortens the period until it leaves room (escenario 4)', () => {
    const shortened = { id: 'p1', startsAt: at('2026-09-18', '17:00'), endsAt: at('2026-09-18', '18:00') };

    expect(build({ cancelAppointments: ['a1'], shortenPeriods: [shortened] })).toMatchObject({
      ok: true,
      value: { shortenPeriods: [shortened] },
    });
  });

  it.each([
    ['still overlapping', '16:45', '18:00'],
    ['reaching outside the period', '17:00', '18:30'],
    ['off the 15 minute grid', '17:05', '18:00'],
  ])('refuses a shortening %s', (_name, from, to) => {
    const shortened = { id: 'p1', startsAt: at('2026-09-18', from), endsAt: at('2026-09-18', to) };

    expect(build({ cancelAppointments: ['a1'], shortenPeriods: [shortened] })).toEqual({
      ok: false,
      error: 'SHORTENING_DOES_NOT_FIT',
    });
  });

  it('refuses while an appointment is left in the way: "keep both" cannot be said (FR-035)', () => {
    expect(build({ deletePeriods: ['p1'] })).toEqual({ ok: false, error: 'UNRESOLVED_CONFLICT' });
    expect(build({ deletePeriods: ['p1'], acknowledgeAppointments: ['a1'] })).toEqual({
      ok: false,
      error: 'UNRESOLVED_CONFLICT',
    });
  });

  it('refuses while a period is left in the way', () => {
    expect(build({ cancelAppointments: ['a1'] })).toEqual({ ok: false, error: 'UNRESOLVED_CONFLICT' });
  });

  it.each<[string, Resolution]>([
    ['an appointment that is not in the way', { cancelAppointments: ['a1', 'a9'], deletePeriods: ['p1'] }],
    ['a period that is not in the way', { cancelAppointments: ['a1'], deletePeriods: ['p1', 'p9'] }],
    ['a period deleted and shortened at once', {
      cancelAppointments: ['a1'],
      deletePeriods: ['p1'],
      shortenPeriods: [{ id: 'p1', startsAt: at('2026-09-18', '17:00'), endsAt: at('2026-09-18', '18:00') }],
    }],
  ])('refuses to resolve %s', (_name, resolution) => {
    expect(build(resolution)).toEqual({ ok: false, error: 'UNKNOWN_TARGET' });
  });

  it('lets a new period acknowledge the appointments it covers, cancelling none (FR-022)', () => {
    const block: ResolutionIntent = { kind: 'CREATE_PERIOD', id: 'p2', ...SPAN, reason: null };
    const covered = detectConflicts({ ...SPAN, appointments: [appointment('a1', '15:45', '16:30')], periods: [] });

    expect(build({ acknowledgeAppointments: ['a1'] }, block, covered)).toEqual({
      ok: true,
      value: { intent: block, cancelAppointments: [], deletePeriods: [], shortenPeriods: [], at: NOW },
    });
    expect(build({ cancelAppointments: ['a1'] }, block, covered)).toMatchObject({
      ok: true,
      value: { cancelAppointments: ['a1'] },
    });
  });
});

describe('shorteningsThatFit (escenario 4 de la Historia 6)', () => {
  const SPAN = { startsAt: at('2026-09-18', '16:00'), endsAt: at('2026-09-18', '17:00') };

  it('offers keeping what is before and what is after the new span', () => {
    expect(shorteningsThatFit(period('p1', '15:00', '18:00'), SPAN)).toEqual([
      { id: 'p1', startsAt: at('2026-09-18', '15:00'), endsAt: at('2026-09-18', '16:00') },
      { id: 'p1', startsAt: at('2026-09-18', '17:00'), endsAt: at('2026-09-18', '18:00') },
    ]);
  });

  it('offers only the side that is left', () => {
    expect(shorteningsThatFit(period('p1', '16:30', '18:00'), SPAN)).toEqual([
      { id: 'p1', startsAt: at('2026-09-18', '17:00'), endsAt: at('2026-09-18', '18:00') },
    ]);
  });

  it('offers nothing for a period the new span swallows: it can only be deleted', () => {
    expect(shorteningsThatFit(period('p1', '16:00', '17:00'), SPAN)).toEqual([]);
  });
});
