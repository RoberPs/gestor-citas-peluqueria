import { describe, expect, it } from 'vitest';
import {
  createRateLimiter,
  rateLimitKey,
  rateLimitSubject,
} from '@/infrastructure/security/rate-limiter';

/**
 * D-007 and FR-040: a sliding window in process memory, keyed by an HMAC of the
 * IP, kept no longer than the window, and with rejections counted in aggregate
 * only — never against a requester.
 */

const SECRET = 'a-secret-for-tests';
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.9';

/** A controllable clock, so the window expiry is tested and not waited for. */
function fakeClock(startMs = 1_600_000_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advanceMinutes(minutes: number) {
      current += minutes * 60_000;
    },
  };
}

describe('rateLimitKey', () => {
  it('does not carry the IP: the key is not reversible to it', () => {
    const key = rateLimitKey(IP, SECRET);

    expect(key).not.toBe(IP);
    expect(key).not.toContain(IP);
    expect(key).not.toContain('203');
  });

  it('is a fixed width hex digest', () => {
    expect(rateLimitKey(IP, SECRET)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for the same IP and secret, so a window survives the requests', () => {
    expect(rateLimitKey(IP, SECRET)).toBe(rateLimitKey(IP, SECRET));
  });

  it('separates two IPs', () => {
    expect(rateLimitKey(IP, SECRET)).not.toBe(rateLimitKey(OTHER_IP, SECRET));
  });

  it('separates two secrets, so the mapping cannot be rebuilt without the secret', () => {
    expect(rateLimitKey(IP, SECRET)).not.toBe(rateLimitKey(IP, 'another-secret'));
  });
});

describe('APPOINTMENT_LOOKUP: 30 per 10 minutes (FR-038)', () => {
  it('allows the first 30 openings and rejects the 31st', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 0; i < 30; i += 1) {
      const result = await limiter.check('APPOINTMENT_LOOKUP', IP);
      expect(result.allowed).toBe(true);
    }

    expect((await limiter.check('APPOINTMENT_LOOKUP', IP)).allowed).toBe(false);
  });

  it('lets the window slide: the oldest attempt stops counting once it ages out', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 0; i < 30; i += 1) await limiter.check('APPOINTMENT_LOOKUP', IP);
    expect((await limiter.check('APPOINTMENT_LOOKUP', IP)).allowed).toBe(false);

    clock.advanceMinutes(11);

    expect((await limiter.check('APPOINTMENT_LOOKUP', IP)).allowed).toBe(true);
  });

  it('keeps one IP from spending another IP allowance', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 0; i < 30; i += 1) await limiter.check('APPOINTMENT_LOOKUP', IP);

    expect((await limiter.check('APPOINTMENT_LOOKUP', OTHER_IP)).allowed).toBe(true);
  });

  it('keeps the two buckets apart', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 0; i < 30; i += 1) await limiter.check('APPOINTMENT_LOOKUP', IP);

    expect((await limiter.check('BOOKING_CONFIRMATION', IP)).allowed).toBe(true);
  });
});

describe('BOOKING_CONFIRMATION: 5 per hour and 15 per 24 hours (FR-039)', () => {
  it('allows five confirmations in an hour and rejects the sixth', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 0; i < 5; i += 1) {
      expect((await limiter.check('BOOKING_CONFIRMATION', IP)).allowed).toBe(true);
    }

    expect((await limiter.check('BOOKING_CONFIRMATION', IP)).allowed).toBe(false);
  });

  it('reopens the hourly window once the hour has passed', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 0; i < 5; i += 1) await limiter.check('BOOKING_CONFIRMATION', IP);
    clock.advanceMinutes(61);

    expect((await limiter.check('BOOKING_CONFIRMATION', IP)).allowed).toBe(true);
  });

  it('still stops at 15 in 24 hours even when every hourly window reopens', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    // Three full hourly allowances, spread over three hours: 15 in total.
    for (let hour = 0; hour < 3; hour += 1) {
      for (let i = 0; i < 5; i += 1) {
        expect((await limiter.check('BOOKING_CONFIRMATION', IP)).allowed).toBe(true);
      }
      clock.advanceMinutes(61);
    }

    expect((await limiter.check('BOOKING_CONFIRMATION', IP)).allowed).toBe(false);
  });

  it('reopens the daily window once 24 hours have passed', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let hour = 0; hour < 3; hour += 1) {
      for (let i = 0; i < 5; i += 1) await limiter.check('BOOKING_CONFIRMATION', IP);
      clock.advanceMinutes(61);
    }
    expect((await limiter.check('BOOKING_CONFIRMATION', IP)).allowed).toBe(false);

    clock.advanceMinutes(24 * 60);

    expect((await limiter.check('BOOKING_CONFIRMATION', IP)).allowed).toBe(true);
  });
});

describe('what check() reveals', () => {
  it('returns allowed and nothing else: no remaining count, no retry time', async () => {
    const limiter = createRateLimiter({ secret: SECRET, now: fakeClock().now });

    const result = await limiter.check('APPOINTMENT_LOOKUP', IP);

    expect(Object.keys(result)).toEqual(['allowed']);
  });
});

describe('aggregate rejection counter (FR-040)', () => {
  it('starts at zero for both buckets', () => {
    const limiter = createRateLimiter({ secret: SECRET, now: fakeClock().now });

    expect(limiter.rejections()).toEqual({ APPOINTMENT_LOOKUP: 0, BOOKING_CONFIRMATION: 0 });
  });

  it('counts rejections per bucket without recording any key or IP', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 0; i < 32; i += 1) await limiter.check('APPOINTMENT_LOOKUP', IP);
    for (let i = 0; i < 7; i += 1) await limiter.check('BOOKING_CONFIRMATION', OTHER_IP);

    const rejections = limiter.rejections();

    expect(rejections.APPOINTMENT_LOOKUP).toBe(2);
    expect(rejections.BOOKING_CONFIRMATION).toBe(2);

    // The counter is a number per bucket. There is nowhere to put an IP.
    const serialised = JSON.stringify(rejections);
    expect(serialised).not.toContain(IP);
    expect(serialised).not.toContain(OTHER_IP);
    expect(serialised).not.toContain(rateLimitKey(IP, SECRET));
  });

  it('forgets the key once its window has closed', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    await limiter.check('APPOINTMENT_LOOKUP', IP);
    expect(limiter.trackedKeyCount()).toBe(1);

    clock.advanceMinutes(11);
    await limiter.check('APPOINTMENT_LOOKUP', OTHER_IP);

    // The first IP aged out: nothing about it is kept beyond its own window.
    expect(limiter.trackedKeyCount()).toBe(1);
  });
});

/**
 * An IPv6 subscriber gets a whole /64 and can hop between its addresses at will;
 * counting each address apart would hand them 2^64 allowances. The /64 is the
 * smallest block a network hands out, so it is what the limiter counts.
 */
describe('rateLimitSubject: what one allowance belongs to', () => {
  it('leaves an IPv4 address as it is', () => {
    expect(rateLimitSubject('203.0.113.7')).toBe('203.0.113.7');
  });

  it('reduces an IPv6 address to its /64', () => {
    expect(rateLimitSubject('2001:db8:85a3:42:8a2e:370:7334:1')).toBe('2001:db8:85a3:42::/64');
  });

  it('gives every address of the same /64 the same subject, however it is written', () => {
    const subjects = [
      '2001:db8:85a3:42::1',
      '2001:DB8:85A3:42:ffff:ffff:ffff:ffff',
      '2001:0db8:85a3:0042:0000:0000:0000:0002',
      '2001:db8:85a3:42::abcd%eth0',
    ].map(rateLimitSubject);

    expect(new Set(subjects)).toEqual(new Set(['2001:db8:85a3:42::/64']));
  });

  it('compresses zeros inside the prefix the same way every time', () => {
    expect(rateLimitSubject('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitSubject('::1')).toBe('0:0:0:0::/64');
  });

  it('separates two neighbouring /64', () => {
    expect(rateLimitSubject('2001:db8:85a3:42::1')).not.toBe(
      rateLimitSubject('2001:db8:85a3:43::1'),
    );
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address it carries', () => {
    expect(rateLimitSubject('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('leaves anything that is not an IP as it is, so it still has its own allowance', () => {
    expect(rateLimitSubject('unknown')).toBe('unknown');
    expect(rateLimitSubject('not:an:ip')).toBe('not:an:ip');
  });
});

describe('IPv6: one allowance per /64', () => {
  it('stops whoever rotates addresses inside one /64', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 1; i <= 30; i += 1) {
      const result = await limiter.check(
        'APPOINTMENT_LOOKUP',
        `2001:db8:85a3:42::${i.toString(16)}`,
      );
      expect(result.allowed).toBe(true);
    }

    expect((await limiter.check('APPOINTMENT_LOOKUP', '2001:db8:85a3:42::ffff')).allowed).toBe(
      false,
    );
  });

  it('keeps a neighbouring /64 out of it', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    for (let i = 0; i < 30; i += 1)
      await limiter.check('APPOINTMENT_LOOKUP', '2001:db8:85a3:42::1');

    expect((await limiter.check('APPOINTMENT_LOOKUP', '2001:db8:85a3:43::1')).allowed).toBe(true);
  });

  it('keeps one window for the whole /64', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ secret: SECRET, now: clock.now });

    await limiter.check('BOOKING_CONFIRMATION', '2001:db8:85a3:42::1');
    await limiter.check('BOOKING_CONFIRMATION', '2001:db8:85a3:42::2');

    expect(limiter.trackedKeyCount()).toBe(1);
  });
});
