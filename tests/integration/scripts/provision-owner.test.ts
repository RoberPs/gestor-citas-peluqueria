import { randomBytes, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOwnerSessionRepository } from '@/infrastructure/db/owner-session-repository';
import { passwordHasher } from '@/infrastructure/security/password';
import { provisionOwnerAccount } from '../../../scripts/provision-owner';
import { closeTestDb, ensureSchema, testPool } from '../helpers/test-db';

/**
 * 002, T056 and FR-003: the account is provisioned outside the application, by
 * `npm run owner:provision`, and the same way again if the password is
 * forgotten (FR-005). And T057: the nightly sweep tidies idle sessions away.
 */

const connectionString = process.env['DATABASE_URL_TEST'] ?? '';

async function accountRows() {
  const { rows } = await testPool().query<{ username: string; password_hash: string }>(
    'SELECT username, password_hash FROM owner_account',
  );
  return rows;
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await testPool().query('TRUNCATE owner_account CASCADE');
});

afterAll(async () => {
  await testPool().query('TRUNCATE owner_account CASCADE');
  await closeTestDb();
});

describe('provisionOwnerAccount', () => {
  it('creates the one account, with the password hashed and never stored in clear', async () => {
    const outcome = await provisionOwnerAccount({
      connectionString,
      username: 'duena',
      password: 'una contraseña muy larga',
    });

    expect(outcome).toEqual({ ok: true, value: { replaced: false } });
    const [row] = await accountRows();
    expect(row?.username).toBe('duena');
    expect(row?.password_hash).toMatch(/^scrypt\$/);
    expect(await passwordHasher.verify('una contraseña muy larga', row?.password_hash ?? '')).toBe(true);
  });

  it('refuses a password shorter than twelve characters, and writes nothing', async () => {
    const outcome = await provisionOwnerAccount({ connectionString, username: 'duena', password: 'corta' });

    expect(outcome).toEqual({ ok: false, error: 'PASSWORD_TOO_SHORT' });
    expect(await accountRows()).toEqual([]);
  });

  it('refuses a missing username', async () => {
    const outcome = await provisionOwnerAccount({
      connectionString,
      username: '  ',
      password: 'una contraseña muy larga',
    });

    expect(outcome).toEqual({ ok: false, error: 'USERNAME_MISSING' });
  });

  it('replaces an existing account, says so, and closes every session it had', async () => {
    await provisionOwnerAccount({ connectionString, username: 'duena', password: 'la primera, larga' });
    const [{ id } = { id: '' }] = (
      await testPool().query<{ id: string }>('SELECT id FROM owner_account')
    ).rows;
    await createOwnerSessionRepository(testPool).create({
      id: randomUUID(),
      accountId: id,
      tokenHash: randomBytes(32),
      at: Temporal.Now.instant(),
    });

    const outcome = await provisionOwnerAccount({
      connectionString,
      username: 'duena',
      password: 'la segunda, también larga',
    });

    expect(outcome).toEqual({ ok: true, value: { replaced: true } });
    expect(await accountRows()).toHaveLength(1);
    expect((await testPool().query('SELECT 1 FROM owner_session')).rows).toHaveLength(0);
  });
});

describe('tidying idle sessions (T057)', () => {
  it('deletes the sessions idle since before the cutoff, and only those', async () => {
    await provisionOwnerAccount({ connectionString, username: 'duena', password: 'una contraseña muy larga' });
    const [{ id } = { id: '' }] = (
      await testPool().query<{ id: string }>('SELECT id FROM owner_account')
    ).rows;
    const sessions = createOwnerSessionRepository(testPool);
    const now = Temporal.Instant.from('2026-09-15T20:00:00Z');
    await sessions.create({ id: randomUUID(), accountId: id, tokenHash: randomBytes(32), at: now.subtract({ hours: 13 }) });
    await sessions.create({ id: randomUUID(), accountId: id, tokenHash: randomBytes(32), at: now.subtract({ hours: 1 }) });

    const removed = await sessions.deleteIdleSince(now.subtract({ hours: 12 }));

    expect(removed).toBe(1);
    expect((await testPool().query('SELECT 1 FROM owner_session')).rows).toHaveLength(1);
  });
});
