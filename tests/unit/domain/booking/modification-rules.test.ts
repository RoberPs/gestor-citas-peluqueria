import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import { canCancel, canReschedule } from '@/domain/booking/modification-rules';
import { at, POLICY } from '../availability/_fixtures';

/**
 * The three rules that gate both cancelling and rescheduling: more than 24
 * hours to go (BR-004), not already cancelled (BR-007), not already past
 * (BR-010).
 *
 * The block they return is what the screen shows as the reason, so the
 * explanation the client reads comes from the domain and not from an `if` in
 * the interface (FR-028).
 */

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'b2e9c0de',
    status: 'CONFIRMED',
    startsAt: at('2026-09-18', '11:30'),
    endsAt: at('2026-09-18', '12:00'),
    service: { serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: 1800 },
    customer: { name: 'Ana', phone: '600112233', email: 'ana@example.com' },
    createdAt: at('2026-09-15', '10:00'),
    cancelledAt: null,
    anonymizedAt: null,
    ...overrides,
  };
}

describe.each([
  ['canCancel', canCancel],
  ['canReschedule', canReschedule],
])('%s', (_name, rule) => {
  it('allows the action with more than 24 hours to go', () => {
    expect(rule(appointment(), at('2026-09-16', '11:30'), POLICY).ok).toBe(true);
  });

  it('allows it one second before the deadline', () => {
    const oneSecondBefore = at('2026-09-17', '11:30').subtract({ seconds: 1 });

    expect(rule(appointment(), oneSecondBefore, POLICY).ok).toBe(true);
  });

  it('blocks it exactly at the deadline and says when it was', () => {
    const result = rule(appointment(), at('2026-09-17', '11:30'), POLICY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('TOO_LATE');
    if (result.error.kind !== 'TOO_LATE') throw new Error('unreachable');
    // The deadline travels with the block so the message can be concrete.
    expect(result.error.deadline.equals(at('2026-09-17', '11:30'))).toBe(true);
  });

  it('blocks it a few hours before the appointment', () => {
    const result = rule(appointment(), at('2026-09-18', '09:00'), POLICY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('TOO_LATE');
  });

  it('blocks it on an appointment that is already cancelled (BR-007)', () => {
    const cancelled = appointment({ status: 'CANCELLED', cancelledAt: at('2026-09-16', '09:00') });

    const result = rule(cancelled, at('2026-09-16', '10:00'), POLICY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'ALREADY_CANCELLED' });
  });

  it('blocks it on an appointment that is already over (BR-010)', () => {
    const result = rule(appointment(), at('2026-09-19', '10:00'), POLICY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'ALREADY_COMPLETED' });
  });

  it('reports a cancelled past appointment as cancelled, which is the terminal state', () => {
    const cancelled = appointment({ status: 'CANCELLED', cancelledAt: at('2026-09-16', '09:00') });

    const result = rule(cancelled, at('2026-10-19', '10:00'), POLICY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'ALREADY_CANCELLED' });
  });
});
