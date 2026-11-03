import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import { deriveView } from '@/domain/booking/derive-view';
import { at } from '../availability/_fixtures';

/**
 * FR-031: `COMPLETED` is a confirmed appointment whose end has passed, worked
 * out when it is read.
 *
 * It is never persisted and no background process assigns it. Persisting it
 * would need such a process, and with it the chance of showing a stale state.
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

describe('deriveView', () => {
  it('is CONFIRMED before the appointment starts', () => {
    expect(deriveView(appointment(), at('2026-09-18', '10:00'))).toBe('CONFIRMED');
  });

  it('is still CONFIRMED while the appointment is under way', () => {
    expect(deriveView(appointment(), at('2026-09-18', '11:45'))).toBe('CONFIRMED');
  });

  it('is COMPLETED exactly at the end, not a minute later', () => {
    expect(deriveView(appointment(), at('2026-09-18', '12:00'))).toBe('COMPLETED');
  });

  it('is CONFIRMED one second before the end', () => {
    expect(deriveView(appointment(), at('2026-09-18', '12:00').subtract({ seconds: 1 }))).toBe(
      'CONFIRMED',
    );
  });

  it('is COMPLETED long after the appointment', () => {
    expect(deriveView(appointment(), at('2026-10-18', '12:00'))).toBe('COMPLETED');
  });

  it('is CANCELLED whatever the clock says, before the slot', () => {
    const cancelled = appointment({ status: 'CANCELLED', cancelledAt: at('2026-09-16', '09:00') });

    expect(deriveView(cancelled, at('2026-09-18', '10:00'))).toBe('CANCELLED');
  });

  it('is CANCELLED and not COMPLETED after the slot has passed', () => {
    const cancelled = appointment({ status: 'CANCELLED', cancelledAt: at('2026-09-16', '09:00') });

    expect(deriveView(cancelled, at('2026-10-18', '12:00'))).toBe('CANCELLED');
  });
});
