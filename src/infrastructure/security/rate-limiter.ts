import { createHmac } from 'node:crypto';
import type { RateLimitBucket, RateLimiter } from '@/application/ports';
import { env } from '../config/env';

/**
 * Sliding-window rate limiting in process memory (D-007).
 *
 * Three properties matter more than the numbers:
 *
 * 1. **The IP is never stored.** It becomes a key through an HMAC, and the key
 *    is dropped once its window closes (FR-040).
 * 2. **`check()` returns only `allowed`.** No remaining count, no retry time.
 *    If it returned either, it would end up in a header and whoever probes
 *    links at random would learn that a limit exists (FR-038, D-006).
 * 3. **Rejections are counted in aggregate**, per bucket, with nowhere to put a
 *    requester. It is the only thing needed to tell whether the numbers are
 *    miscalibrated.
 *
 * Living in memory, this **requires a single application worker per salon**,
 * which is what the deployment guarantees. More than one process would mean
 * moving the counter to PostgreSQL; the port makes that a swap of this adapter.
 */

type Rule = { readonly limit: number; readonly windowMs: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Both limits sit deliberately far above legitimate use: a client books once
 * and opens their link a handful of times. The margin also absorbs several
 * clients behind one shared IP — mobile NAT, shopping centre wifi.
 */
const RULES: Readonly<Record<RateLimitBucket, readonly Rule[]>> = {
  APPOINTMENT_LOOKUP: [{ limit: 30, windowMs: 10 * MINUTE }],
  BOOKING_CONFIRMATION: [
    { limit: 5, windowMs: HOUR },
    { limit: 15, windowMs: 24 * HOUR },
  ],
};

/**
 * Turns an IP into a non-reversible key.
 *
 * The secret is **fixed for the life of the process**: it is not rotated hot,
 * because rotating it would re-key every live window and silently reset them
 * all — precisely what an abuser would want. It rotates by restarting.
 */
export function rateLimitKey(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

export type InMemoryRateLimiter = RateLimiter & {
  /** FR-040: rejections per bucket, with no reference to any requester. */
  rejections(): Readonly<Record<RateLimitBucket, number>>;
  /** How many windows are alive. The gauge of this limiter's memory footprint. */
  trackedKeyCount(): number;
};

export function createRateLimiter(config: {
  readonly secret: string;
  readonly now: () => number;
}): InMemoryRateLimiter {
  const hits = new Map<string, number[]>();
  const rejections: Record<RateLimitBucket, number> = {
    APPOINTMENT_LOOKUP: 0,
    BOOKING_CONFIRMATION: 0,
  };

  function longestWindow(bucket: RateLimitBucket): number {
    return RULES[bucket].reduce((longest, rule) => Math.max(longest, rule.windowMs), 0);
  }

  /** Drops every key whose entries have all aged out of their longest window. */
  function prune(now: number): void {
    for (const [key, timestamps] of hits) {
      const bucket = key.slice(0, key.indexOf(':')) as RateLimitBucket;
      const horizon = now - longestWindow(bucket);
      const live = timestamps.filter((at) => at > horizon);

      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }

  return {
    async check(bucket, clientIp) {
      const now = config.now();
      prune(now);

      const key = `${bucket}:${rateLimitKey(clientIp, config.secret)}`;
      const timestamps = hits.get(key) ?? [];

      const allowed = RULES[bucket].every(
        (rule) => timestamps.filter((at) => at > now - rule.windowMs).length < rule.limit,
      );

      if (allowed) hits.set(key, [...timestamps, now]);
      else rejections[bucket] += 1;

      return { allowed };
    },

    rejections() {
      return { ...rejections };
    },

    trackedKeyCount() {
      prune(config.now());
      return hits.size;
    },
  };
}

const globalForLimiter = globalThis as unknown as { __salonRateLimiter?: InMemoryRateLimiter };

export function rateLimiter(): InMemoryRateLimiter {
  globalForLimiter.__salonRateLimiter ??= createRateLimiter({
    secret: env().rateLimitSecret,
    now: () => Date.now(),
  });
  return globalForLimiter.__salonRateLimiter;
}
