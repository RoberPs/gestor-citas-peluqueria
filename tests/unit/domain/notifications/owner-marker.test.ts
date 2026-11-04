import { describe, expect, it } from 'vitest';
import { needsConfirmationCall } from '@/domain/notifications/owner-marker';
import { appointment, minutesAfterBooking } from './_fixtures';

/**
 * 004, FR-020a: the owner sees the mark only where a call helps — an online
 * appointment, still confirmed and not over, whose confirmation failed for good.
 */

const NOW = minutesAfterBooking(90);

describe('needsConfirmationCall', () => {
  it('marks an online, confirmed, upcoming appointment whose confirmation FAILED', () => {
    expect(needsConfirmationCall(appointment(), 'FAILED', NOW)).toBe(true);
  });

  it('still marks it while it is under way', () => {
    const live = appointment();
    expect(needsConfirmationCall(live, 'FAILED', live.startsAt.add({ minutes: 5 }))).toBe(true);
  });

  it('does not mark it once it is over', () => {
    const over = appointment();
    expect(needsConfirmationCall(over, 'FAILED', over.endsAt)).toBe(false);
  });

  it('does not mark a cancelled one', () => {
    expect(
      needsConfirmationCall(
        appointment({ status: 'CANCELLED', cancelledAt: NOW, cancelledBy: 'CUSTOMER' }),
        'FAILED',
        NOW,
      ),
    ).toBe(false);
  });

  it('does not mark one written by hand, which has no link to give', () => {
    expect(needsConfirmationCall(appointment({ origin: 'OWNER' }), 'FAILED', NOW)).toBe(false);
  });

  it.each([['OTHER'], [null]] as const)('does not mark one whose confirmation is %s', (delivery) => {
    expect(needsConfirmationCall(appointment(), delivery, NOW)).toBe(false);
  });

  it('does not mark an anonymised one: there is nobody to call', () => {
    expect(needsConfirmationCall(appointment({ customer: null, anonymizedAt: NOW }), 'FAILED', NOW)).toBe(false);
  });
});
