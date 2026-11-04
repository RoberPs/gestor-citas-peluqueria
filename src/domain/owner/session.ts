import { Temporal } from '@js-temporal/polyfill';

/**
 * The owner's session expires after twelve idle hours (002, FR-007, D-015).
 *
 * Idleness is a comparison, not a stored state: no process marks sessions as
 * expired. The refresh is throttled to one write every five minutes so that
 * browsing the agenda does not turn every request into an UPDATE (Principio
 * VIII); against twelve hours, five minutes of slack is irrelevant.
 */

export const SESSION_IDLE_TIMEOUT_HOURS = 12;
export const SESSION_TOUCH_INTERVAL_MINUTES = 5;

export function isSessionAlive(lastSeenAt: Temporal.Instant, now: Temporal.Instant): boolean {
  return Temporal.Instant.compare(now, lastSeenAt.add({ hours: SESSION_IDLE_TIMEOUT_HOURS })) < 0;
}

export function shouldTouchSession(lastSeenAt: Temporal.Instant, now: Temporal.Instant): boolean {
  return (
    Temporal.Instant.compare(now, lastSeenAt.add({ minutes: SESSION_TOUCH_INTERVAL_MINUTES })) >= 0
  );
}
