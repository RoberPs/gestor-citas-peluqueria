import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import { applyCancellation } from '@/domain/booking/cancel';
import { at, POLICY } from '../availability/_fixtures';

/**
 * Cancelling (Historia 5). The rules are `canCancel`'s, reused rather than
 * restated: BR-004 exists once or it exists twice, and twice is how it starts
 * giving two answers.
 */

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'b2e9c0de',
    status: 'CONFIRMED',
    startsAt: at('2026-09-18', '11:30'),
    endsAt: at('2026-09-18', '12:00'),
    services: [{ serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: 1800 }],
    customer: { name: 'Ana', phone: '600112233', email: 'ana@example.com' },
    createdAt: at('2026-09-15', '10:00'),
    cancelledAt: null,
    anonymizedAt: null,
    ...overrides,
  };
}

describe('applyCancellation', () => {
  it('cancels an appointment that is still inside the deadline', () => {
    const now = at('2026-09-16', '11:30');

    const result = applyCancellation(appointment(), now, POLICY);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.status).toBe('CANCELLED');
    expect(result.value.cancelledAt?.equals(now)).toBe(true);
  });

  it('keeps the slot, the service and the identity of the appointment', () => {
    const original = appointment();

    const result = applyCancellation(original, at('2026-09-16', '11:30'), POLICY);

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.id).toBe(original.id);
    expect(result.value.startsAt.equals(original.startsAt)).toBe(true);
    expect(result.value.services).toEqual(original.services);
  });

  it('leaves the original untouched: the result is a new value', () => {
    const original = appointment();

    applyCancellation(original, at('2026-09-16', '11:30'), POLICY);

    expect(original.status).toBe('CONFIRMED');
    expect(original.cancelledAt).toBeNull();
  });

  it('rejects a cancellation past the 24 hour deadline (BR-004)', () => {
    const result = applyCancellation(appointment(), at('2026-09-18', '09:00'), POLICY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('TOO_LATE');
  });

  it('rejects cancelling an appointment that is already cancelled (BR-007)', () => {
    const cancelled = appointment({ status: 'CANCELLED', cancelledAt: at('2026-09-16', '09:00') });

    const result = applyCancellation(cancelled, at('2026-09-16', '10:00'), POLICY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'ALREADY_CANCELLED' });
  });

  it('rejects cancelling an appointment that has already happened (BR-010)', () => {
    const result = applyCancellation(appointment(), at('2026-09-19', '10:00'), POLICY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'ALREADY_COMPLETED' });
  });
});
