import { describe, expect, it } from 'vitest';
import {
  isSessionAlive,
  SESSION_IDLE_TIMEOUT_HOURS,
  SESSION_TOUCH_INTERVAL_MINUTES,
  shouldTouchSession,
} from '@/domain/owner/session';
import { at } from '../availability/_fixtures';

/** 002, T033, FR-007 and D-015: twelve idle hours, refreshed at most every five minutes. */

const SEEN = at('2026-09-15', '10:00');

describe('isSessionAlive', () => {
  it('is alive until twelve idle hours have passed, and dead from then on', () => {
    expect(SESSION_IDLE_TIMEOUT_HOURS).toBe(12);
    expect(isSessionAlive(SEEN, SEEN.add({ hours: 11, minutes: 59 }))).toBe(true);
    expect(isSessionAlive(SEEN, SEEN.add({ hours: 12 }))).toBe(false);
  });
});

describe('shouldTouchSession', () => {
  it('leaves last_seen_at alone for five minutes, so not every request writes', () => {
    expect(SESSION_TOUCH_INTERVAL_MINUTES).toBe(5);
    expect(shouldTouchSession(SEEN, SEEN.add({ minutes: 4, seconds: 59 }))).toBe(false);
    expect(shouldTouchSession(SEEN, SEEN.add({ minutes: 5 }))).toBe(true);
  });
});
