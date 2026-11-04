import { describe, expect, it } from 'vitest';
import { isConsentActive, revokeConsent } from '@/domain/notifications/consent';
import { consent, minutesAfterBooking } from './_fixtures';

/** 004, FR-016: a consent ends once, with its moment and its reason. */

describe('revokeConsent', () => {
  it('ends a live consent with its reason and the moment', () => {
    const at = minutesAfterBooking(30);
    const result = revokeConsent(consent(), 'UNSUBSCRIBED', at);

    expect(result).toEqual({ ok: true, value: consent({ ended: { at, reason: 'UNSUBSCRIBED' } }) });
  });

  it('answers ALREADY_ENDED for one already ended, without moving its first end', () => {
    const first = { at: minutesAfterBooking(5), reason: 'EMAIL_CHANGED' as const };
    const result = revokeConsent(consent({ ended: first }), 'UNSUBSCRIBED', minutesAfterBooking(30));

    expect(result).toEqual({ ok: false, error: 'ALREADY_ENDED' });
  });
});

describe('isConsentActive', () => {
  it('is true for a live email consent', () => {
    expect(isConsentActive(consent(), 'EMAIL')).toBe(true);
  });

  it('is false once ended', () => {
    expect(
      isConsentActive(consent({ ended: { at: minutesAfterBooking(1), reason: 'UNSUBSCRIBED' } }), 'EMAIL'),
    ).toBe(false);
  });

  it('is false without a consent, which means the same thing', () => {
    expect(isConsentActive(null, 'EMAIL')).toBe(false);
  });

  it('does not lend one channel to the other (FR-003)', () => {
    expect(isConsentActive(consent(), 'SMS')).toBe(false);
  });
});
