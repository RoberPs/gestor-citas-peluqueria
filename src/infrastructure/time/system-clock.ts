import { Temporal } from '@js-temporal/polyfill';
import type { Clock } from '@/domain/shared/clock';

/**
 * The server clock, and the only place it is read (FR-032, BR-015).
 *
 * Every temporal decision goes through the injected `Clock`, so the device
 * clock has no path into any of them.
 */
export const systemClock: Clock = {
  now: () => Temporal.Now.instant(),
};
