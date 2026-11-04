import { Temporal } from '@js-temporal/polyfill';
import type { Appointment } from '@/domain/booking/appointment';
import type { ChannelConsent, PendingNotification } from '@/domain/notifications/consent';

/** Shared setup for the notification suites (004). */

/** When the appointment was booked: Tuesday 2026-11-10, 10:00 in Madrid. */
export const BOOKED_AT = Temporal.Instant.from('2026-11-10T09:00:00Z');

export function minutesAfterBooking(minutes: number): Temporal.Instant {
  return BOOKED_AT.add({ seconds: Math.round(minutes * 60) });
}

export function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    status: 'CONFIRMED',
    origin: 'ONLINE',
    // Friday 2026-11-13, 11:30 to 12:30 in Madrid.
    startsAt: Temporal.Instant.from('2026-11-13T10:30:00Z'),
    endsAt: Temporal.Instant.from('2026-11-13T11:30:00Z'),
    services: [
      { serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: 1800 },
      { serviceId: 's2', name: 'Lavado', durationMinutes: 30, priceCents: 800 },
    ],
    customer: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    createdAt: BOOKED_AT,
    cancelledAt: null,
    cancelledBy: null,
    anonymizedAt: null,
    ...overrides,
  };
}

export function consent(overrides: Partial<ChannelConsent> = {}): ChannelConsent {
  return {
    appointmentId: 'a1',
    channel: 'EMAIL',
    grantedAt: BOOKED_AT,
    ended: null,
    ...overrides,
  };
}

export function pending(overrides: Partial<PendingNotification> = {}): PendingNotification {
  return {
    id: 'n1',
    appointmentId: 'a1',
    channel: 'EMAIL',
    kind: 'BOOKING_CONFIRMATION',
    attempts: 0,
    createdAt: BOOKED_AT,
    ...overrides,
  };
}
