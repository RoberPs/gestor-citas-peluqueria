import { describe, expect, it } from 'vitest';
import { decideDelivery, nextAttemptAt } from '@/domain/notifications/delivery';
import {
  appointment,
  BOOKED_AT,
  consent,
  minutesAfterBooking,
  pending,
} from './_fixtures';

/**
 * 004, D-008: the one place that decides whether an email goes out (FR-005,
 * FR-008, FR-009, FR-011), and when the next attempt is.
 */

const NOW = minutesAfterBooking(2);

describe('decideDelivery, in the order of data-model.md', () => {
  it('sends a live confirmation with its consent, inside the hour', () => {
    expect(
      decideDelivery({ appointment: appointment(), consent: consent(), notification: pending(), now: NOW }),
    ).toEqual({ kind: 'SEND' });
  });

  it('skips an anonymised appointment, before anything else', () => {
    expect(
      decideDelivery({
        appointment: appointment({ customer: null, anonymizedAt: NOW, status: 'CANCELLED' }),
        consent: null,
        notification: pending(),
        now: minutesAfterBooking(90),
      }),
    ).toEqual({ kind: 'SKIP', reason: 'PERSONAL_DATA_DELETED' });
  });

  it('never sends the confirmation of an appointment already cancelled (Principio II)', () => {
    expect(
      decideDelivery({
        appointment: appointment({ status: 'CANCELLED', cancelledAt: NOW, cancelledBy: 'CUSTOMER' }),
        consent: consent(),
        notification: pending(),
        now: NOW,
      }),
    ).toEqual({ kind: 'SKIP', reason: 'APPOINTMENT_CANCELLED' });
  });

  it('skips a cancelled appointment even after the hour, rather than call it a failure', () => {
    expect(
      decideDelivery({
        appointment: appointment({ status: 'CANCELLED', cancelledAt: NOW, cancelledBy: 'OWNER' }),
        consent: consent(),
        notification: pending(),
        now: minutesAfterBooking(61),
      }),
    ).toEqual({ kind: 'SKIP', reason: 'APPOINTMENT_CANCELLED' });
  });

  it('skips without a consent', () => {
    expect(
      decideDelivery({ appointment: appointment(), consent: null, notification: pending(), now: NOW }),
    ).toEqual({ kind: 'SKIP', reason: 'CONSENT_ENDED' });
  });

  it.each([['UNSUBSCRIBED'], ['EMAIL_CHANGED']] as const)('skips a consent ended as %s', (reason) => {
    expect(
      decideDelivery({
        appointment: appointment(),
        consent: consent({ ended: { at: NOW, reason } }),
        notification: pending(),
        now: NOW,
      }),
    ).toEqual({ kind: 'SKIP', reason: 'CONSENT_ENDED' });
  });

  it('skips an appointment whose email is gone, whatever its consent says (FR-008)', () => {
    expect(
      decideDelivery({
        appointment: appointment({ customer: { name: 'Ana López', phone: '600112233', email: null } }),
        consent: consent(),
        notification: pending(),
        now: NOW,
      }),
    ).toEqual({ kind: 'SKIP', reason: 'CONSENT_ENDED' });
  });

  it('skips a consent given for another channel (FR-003)', () => {
    expect(
      decideDelivery({
        appointment: appointment(),
        consent: consent({ channel: 'SMS' }),
        notification: pending(),
        now: NOW,
      }),
    ).toEqual({ kind: 'SKIP', reason: 'CONSENT_ENDED' });
  });

  it('expires exactly one hour after the booking (FR-011)', () => {
    expect(
      decideDelivery({ appointment: appointment(), consent: consent(), notification: pending(), now: minutesAfterBooking(60) }),
    ).toEqual({ kind: 'EXPIRED' });
  });

  it('still sends one second before the hour', () => {
    expect(
      decideDelivery({
        appointment: appointment(),
        consent: consent(),
        notification: pending(),
        now: minutesAfterBooking(60).subtract({ seconds: 1 }),
      }),
    ).toEqual({ kind: 'SEND' });
  });
});

describe('nextAttemptAt: 1, 3, 7, 15, 30 and 45 minutes after the booking (D-003)', () => {
  it.each([
    [0, 1],
    [0.5, 1],
    [1, 3],
    [2, 3],
    [3, 7],
    [6.9, 7],
    [7, 15],
    [14, 15],
    [15, 30],
    [29, 30],
    [30, 45],
    [44.9, 45],
  ])('after a failure at minute %d, tries again at minute %d', (failedAt, next) => {
    expect(nextAttemptAt(BOOKED_AT, minutesAfterBooking(failedAt))?.toString()).toBe(
      minutesAfterBooking(next).toString(),
    );
  });

  it.each([[45], [50], [60], [120]])('gives up after a failure at minute %d', (failedAt) => {
    expect(nextAttemptAt(BOOKED_AT, minutesAfterBooking(failedAt))).toBeNull();
  });
});
