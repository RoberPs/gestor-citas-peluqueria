import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import type { UnavailablePeriod } from '@/domain/catalog/salon';
import {
  checkAcknowledgement,
  computeStateToken,
  detectConflicts,
  type Conflict,
} from '@/domain/owner/conflict';
import { at } from '../availability/_fixtures';

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
