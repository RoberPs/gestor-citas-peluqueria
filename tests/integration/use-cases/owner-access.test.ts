import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorizeOwnerSession } from '@/application/use-cases/authorize-owner-session';
import { createChangeOwnerPassword } from '@/application/use-cases/change-owner-password';
import { createSignInOwner } from '@/application/use-cases/sign-in-owner';
import { createSignOutOwner } from '@/application/use-cases/sign-out-owner';
import type { Clock } from '@/domain/shared/clock';
import { createOwnerAccountRepository } from '@/infrastructure/db/owner-account-repository';
import { createOwnerSessionRepository } from '@/infrastructure/db/owner-session-repository';
import { passwordHasher } from '@/infrastructure/security/password';
import { tokenGenerator } from '@/infrastructure/security/token';
import { closeTestDb, ensureSchema, testPool } from '../helpers/test-db';

/**
 * 002, T038: signing in, staying in, signing out and changing the password,
 * against a real PostgreSQL. The lock has to survive a restart, so it is the
 * database's, and every use case here is rebuilt as a restart would rebuild it.
 */

const PASSWORD = 'una contraseña muy larga';
const START = Temporal.Instant.from('2026-09-15T08:00:00Z');
const clock = { current: START };
const fixedClock: Clock = { now: () => clock.current };

const accounts = createOwnerAccountRepository(testPool);
const sessions = createOwnerSessionRepository(testPool);

function build() {
  const deps = { accounts, sessions, passwords: passwordHasher, tokens: tokenGenerator, clock: fixedClock };
  return {
    signIn: createSignInOwner(deps),
    signOut: createSignOutOwner(deps),
    authorize: createAuthorizeOwnerSession(deps),
    changePassword: createChangeOwnerPassword(deps),
  };
}

async function signedIn(): Promise<string> {
  const result = await build().signIn({ username: 'duena', password: PASSWORD });
  if (!result.ok) throw new Error('the fixture sign-in was rejected');
  return result.value.token;
}

async function failedAttempts(): Promise<number> {
  const { rows } = await testPool().query<{ failed_attempts: number }>(
    'SELECT failed_attempts FROM owner_account',
  );
  return rows[0]?.failed_attempts ?? -1;
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  clock.current = START;
  await accounts.replace({
    id: randomUUID(),
    username: 'duena',
    passwordHash: await passwordHasher.hash(PASSWORD),
    at: START,
  });
});

afterAll(async () => {
  await testPool().query('TRUNCATE owner_account CASCADE');
  await closeTestDb();
});

describe('signing in (Historia 1, escenarios 1 y 3)', () => {
  it('opens a session whose token works and whose row keeps only its hash (D-015)', async () => {
    const token = await signedIn();

    expect((await build().authorize(token)).ok).toBe(true);
    const { rows } = await testPool().query<{ token_hash: Buffer }>('SELECT token_hash FROM owner_session');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash.toString('utf8')).not.toContain(token);
  });

  it('answers a wrong password and an unknown user with the same single failure (FR-008)', async () => {
    const wrong = await build().signIn({ username: 'duena', password: 'otra contraseña cualquiera' });
    const unknown = await build().signIn({ username: 'nadie', password: PASSWORD });

    expect(wrong).toEqual({ ok: false, error: 'REJECTED' });
    expect(unknown).toEqual({ ok: false, error: 'REJECTED' });
  });

  it('puts the failure count back to zero on a correct sign-in', async () => {
    await build().signIn({ username: 'duena', password: 'mal' });
    await build().signIn({ username: 'duena', password: 'mal otra vez' });
    expect(await failedAttempts()).toBe(2);

    await signedIn();

    expect(await failedAttempts()).toBe(0);
  });
});

describe('the lock (Historia 1, escenario 4; FR-009, D-017)', () => {
  it('locks after five failures, keeps refusing the right password, and survives a restart', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await build().signIn({ username: 'duena', password: `mal ${attempt}` });
    }

    clock.current = START.add({ minutes: 5 });
    // A fresh build is what a restarted process would have: nothing in memory.
    expect(await build().signIn({ username: 'duena', password: PASSWORD })).toEqual({
      ok: false,
      error: 'REJECTED',
    });

    clock.current = START.add({ minutes: 16 });
    expect((await build().signIn({ username: 'duena', password: PASSWORD })).ok).toBe(true);
  });
});

describe('staying in and signing out (FR-006, FR-007)', () => {
  it('refuses no token, an unknown token and an idle one', async () => {
    const token = await signedIn();

    expect(await build().authorize(undefined)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(await build().authorize('no-es-un-token')).toEqual({ ok: false, error: 'UNAUTHENTICATED' });

    clock.current = START.add({ hours: 12 });
    expect(await build().authorize(token)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  it('slides the expiry as she keeps using it, writing at most every five minutes', async () => {
    const token = await signedIn();
    const seen = async () =>
      (await testPool().query<{ last_seen_at: Date }>('SELECT last_seen_at FROM owner_session'))
        .rows[0]?.last_seen_at.getTime();

    clock.current = START.add({ minutes: 3 });
    await build().authorize(token);
    expect(await seen()).toBe(START.epochMilliseconds);

    clock.current = START.add({ hours: 11 });
    await build().authorize(token);
    clock.current = START.add({ hours: 22 });
    expect((await build().authorize(token)).ok).toBe(true);
  });

  it('signs out by deleting the row: the token never works again', async () => {
    const token = await signedIn();

    await build().signOut(token);

    expect(await build().authorize(token)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    const { rows } = await testPool().query('SELECT 1 FROM owner_session');
    expect(rows).toHaveLength(0);
  });
});

describe('changing the password (FR-004)', () => {
  it('asks for the current password and twelve characters for the new one', async () => {
    const token = await signedIn();
    const session = await build().authorize(token);
    if (!session.ok) throw new Error('unreachable');

    expect(
      await build().changePassword(session.value, { current: 'no es esta', next: 'otra contraseña larga' }),
    ).toEqual({ ok: false, error: 'WRONG_CURRENT_PASSWORD' });
    expect(
      await build().changePassword(session.value, { current: PASSWORD, next: 'corta' }),
    ).toEqual({ ok: false, error: 'TOO_SHORT' });
  });

  it('changes it, keeps this session and closes every other one', async () => {
    const here = await signedIn();
    const elsewhere = await signedIn();
    const session = await build().authorize(here);
    if (!session.ok) throw new Error('unreachable');

    const changed = await build().changePassword(session.value, {
      current: PASSWORD,
      next: 'la nueva contraseña larga',
    });

    expect(changed.ok).toBe(true);
    expect((await build().authorize(here)).ok).toBe(true);
    expect((await build().authorize(elsewhere)).ok).toBe(false);
    expect((await build().signIn({ username: 'duena', password: 'la nueva contraseña larga' })).ok).toBe(true);
    expect((await build().signIn({ username: 'duena', password: PASSWORD })).ok).toBe(false);
  });
});
