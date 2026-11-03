import type { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import {
  evaluateLockout,
  LOCKOUT_POLICY,
  MIN_PASSWORD_LENGTH,
  registerFailure,
  validateNewPassword,
  type LockoutState,
} from '@/domain/owner/account';
import { at } from '../availability/_fixtures';

/**
 * 002, T032, FR-009 and D-017: five failures within fifteen minutes lock the
 * account for fifteen minutes. All of it over an injected clock, so the suite
 * never waits a quarter of an hour.
 */

const OPEN: LockoutState = { failedAttempts: 0, firstFailedAttemptAt: null, lockedUntil: null };

function failTimes(times: number, from: Temporal.Instant, everyMinutes = 1): LockoutState {
  let state = OPEN;
  for (let attempt = 0; attempt < times; attempt += 1) {
    state = registerFailure({ ...state, now: from.add({ minutes: attempt * everyMinutes }) });
  }
  return state;
}

const START = at('2026-09-15', '10:00');

describe('registerFailure', () => {
  it('opens the window on the first failure', () => {
    expect(registerFailure({ ...OPEN, now: START })).toEqual({
      failedAttempts: 1,
      firstFailedAttemptAt: START,
      lockedUntil: null,
    });
  });

  it('locks on the fifth failure inside fifteen minutes, for fifteen minutes', () => {
    const state = failTimes(LOCKOUT_POLICY.maxFailedAttempts, START, 3);
    const fifth = START.add({ minutes: 12 });

    expect(state.failedAttempts).toBe(5);
    expect(state.lockedUntil?.equals(fifth.add({ minutes: 15 }))).toBe(true);
  });

  it('does not lock after four failures', () => {
    expect(failTimes(4, START).lockedUntil).toBeNull();
  });

  it('starts a new window when the old one has run out, so slow guesses never lock', () => {
    const state = failTimes(5, START, 4);

    expect(state.lockedUntil).toBeNull();
    expect(state.failedAttempts).toBeLessThan(5);
  });

  it('starts afresh after a lock has expired', () => {
    const locked = failTimes(5, START);
    const later = locked.lockedUntil?.add({ minutes: 1 }) ?? START;

    expect(registerFailure({ ...locked, now: later })).toEqual({
      failedAttempts: 1,
      firstFailedAttemptAt: later,
      lockedUntil: null,
    });
  });
});

describe('evaluateLockout', () => {
  it('reports an untouched account as open', () => {
    expect(evaluateLockout({ ...OPEN, now: START }).isLocked).toBe(false);
  });

  it('reports the account locked until the lock runs out, and open from then on', () => {
    const locked = failTimes(5, START);
    const until = locked.lockedUntil ?? START;

    expect(evaluateLockout({ ...locked, now: until.subtract({ seconds: 1 }) }).isLocked).toBe(true);
    expect(evaluateLockout({ ...locked, now: until }).isLocked).toBe(false);
  });

  it('keeps it locked whatever the attempt: a correct password does not lift it (D-017)', () => {
    // The use case asks before comparing anything; the answer depends only on time.
    const locked = failTimes(5, START);

    expect(evaluateLockout({ ...locked, now: START.add({ minutes: 6 }) }).isLocked).toBe(true);
  });

  it('says when the failure window has run out', () => {
    const once = failTimes(1, START);

    expect(evaluateLockout({ ...once, now: START.add({ minutes: 14 }) }).windowExpired).toBe(false);
    expect(evaluateLockout({ ...once, now: START.add({ minutes: 15 }) }).windowExpired).toBe(true);
  });
});

describe('validateNewPassword (D-016)', () => {
  it('asks for twelve characters and nothing else', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(validateNewPassword('a'.repeat(11))).toEqual({ ok: false, error: 'TOO_SHORT' });
    expect(validateNewPassword('a'.repeat(12)).ok).toBe(true);
    expect(validateNewPassword('todo minúsculas sin números').ok).toBe(true);
  });

  it('counts characters, so twelve with accents are twelve', () => {
    expect(validateNewPassword('ñáéíóúñáéíóú').ok).toBe(true);
  });
});
