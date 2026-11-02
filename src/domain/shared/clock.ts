import type { Temporal } from '@js-temporal/polyfill';

/**
 * The domain never calls `Date.now()`. It receives the clock (FR-032, BR-015, D-004).
 *
 * Without this, the tests for the two hour lead time and the twenty four hour
 * cancellation deadline would depend on the hour the suite happens to run at.
 */
export interface Clock {
  now(): Temporal.Instant;
}
