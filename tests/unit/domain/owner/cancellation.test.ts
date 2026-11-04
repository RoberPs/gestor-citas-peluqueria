import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import { applyOwnerCancellation, checkOwnerCanChange } from '@/domain/owner/cancellation';
import { at } from '../availability/_fixtures';

/**
 * 002, Historia 5: the owner cancels any confirmed appointment, online or by
 * hand, with no deadline (BR-007), and the cancellation says it was her
 * (FR-040a). The past stays read-only (FR-016, BR-009).
 */

const NOW = at('2026-09-18', '11:15');

function appointment(from: string, to: string, overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    status: 'CONFIRMED',
    origin: 'ONLINE',
    startsAt: at('2026-09-18', from),
    endsAt: at('2026-09-18', to),
    services: [{ serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: 1800 }],
    customer: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    createdAt: at('2026-09-10', '10:00'),
    cancelledAt: null,
    cancelledBy: null,
    anonymizedAt: null,
    ...overrides,
  };
}

describe('applyOwnerCancellation', () => {
  it('cancels as the owner, an hour before, inside the client\'s 24 h deadline (escenario 2)', () => {
    expect(applyOwnerCancellation(appointment('12:15', '12:45'), NOW)).toEqual({
      ok: true,
      value: { ...appointment('12:15', '12:45'), status: 'CANCELLED', cancelledAt: NOW, cancelledBy: 'OWNER' },
    });
  });

  it('cancels one under way', () => {
    expect(applyOwnerCancellation(appointment('11:00', '11:30'), NOW).ok).toBe(true);
  });

  it('refuses one already over (BR-009)', () => {
    expect(applyOwnerCancellation(appointment('10:30', '11:00'), NOW)).toEqual({ ok: false, error: 'IN_THE_PAST' });
  });

  it('refuses one already cancelled: cancelling is final (FR-042, BR-008)', () => {
    const cancelled = appointment('12:15', '12:45', { status: 'CANCELLED', cancelledAt: NOW, cancelledBy: 'CUSTOMER' });

    expect(applyOwnerCancellation(cancelled, NOW)).toEqual({ ok: false, error: 'ALREADY_CANCELLED' });
  });
});

describe('checkOwnerCanChange', () => {
  it('names cancelled before past: a cancelled one is not "over", it is gone', () => {
    const both = appointment('09:00', '09:30', { status: 'CANCELLED', cancelledAt: NOW, cancelledBy: 'OWNER' });

    expect(checkOwnerCanChange(both, NOW)).toEqual({ ok: false, error: 'ALREADY_CANCELLED' });
  });
});
