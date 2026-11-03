import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, ensureSchema, testPool } from '../helpers/test-db';

/**
 * `0004_owner_account_and_session.sql` (002, T014): the one staff account and
 * its sessions. Exercised against the database directly, as every guarantee.
 */

async function sqlStateOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function insertAccount(username = 'duena'): Promise<string> {
  const id = randomUUID();
  await testPool().query(
    `INSERT INTO owner_account (id, username, password_hash, password_changed_at)
     VALUES ($1, $2, 'scrypt$131072$8$1$salt$hash', now())`,
    [id, username],
  );
  return id;
}

async function insertSession(accountId: string, tokenHash = randomBytes(32)): Promise<void> {
  await testPool().query(
    `INSERT INTO owner_session (id, account_id, token_hash, created_at, last_seen_at)
     VALUES ($1, $2, $3, now(), now())`,
    [randomUUID(), accountId, tokenHash],
  );
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await testPool().query('TRUNCATE owner_account, owner_session CASCADE');
});

afterAll(async () => {
  await closeTestDb();
});

describe('owner_account (FR-001, FR-009)', () => {
  it('holds at most one account: a second one is rejected', async () => {
    await insertAccount('duena');

    expect(await sqlStateOf(() => insertAccount('otra'))).toBe('23505');
  });

  it('starts with no failed attempts and no lock', async () => {
    await insertAccount();

    const { rows } = await testPool().query<{
      failed_attempts: number;
      first_failed_attempt_at: Date | null;
      locked_until: Date | null;
    }>('SELECT failed_attempts, first_failed_attempt_at, locked_until FROM owner_account');

    expect(rows[0]).toEqual({ failed_attempts: 0, first_failed_attempt_at: null, locked_until: null });
  });

  it('rejects a failure count without the moment its window started', async () => {
    const id = await insertAccount();

    const code = await sqlStateOf(() =>
      testPool().query('UPDATE owner_account SET failed_attempts = 1 WHERE id = $1', [id]),
    );

    expect(code).toBe('23514');
  });

  it('has no column for an address or a device: the lock is per account (FR-009)', async () => {
    const { rows } = await testPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('owner_account', 'owner_session')
          AND (column_name LIKE '%ip%' OR column_name LIKE '%device%' OR column_name LIKE '%agent%')`,
    );

    expect(rows).toEqual([]);
  });
});

describe('owner_session (FR-006, D-015)', () => {
  it('rejects two sessions with the same token hash', async () => {
    const accountId = await insertAccount();
    const hash = randomBytes(32);
    await insertSession(accountId, hash);

    expect(await sqlStateOf(() => insertSession(accountId, hash))).toBe('23505');
  });

  it('closes every session when the account is deleted', async () => {
    const accountId = await insertAccount();
    await insertSession(accountId);
    await insertSession(accountId);

    await testPool().query('DELETE FROM owner_account WHERE id = $1', [accountId]);

    const { rows } = await testPool().query<{ count: string }>(
      'SELECT count(*) AS count FROM owner_session',
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('refuses a session for an account that does not exist', async () => {
    expect(await sqlStateOf(() => insertSession(randomUUID()))).toBe('23503');
  });
});
