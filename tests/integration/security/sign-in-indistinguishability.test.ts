import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, testPool } from '../helpers/test-db';
import { OWNER, provisionOwner, signInRequest } from '../../contract/owner/helpers';

/**
 * 002, T036, FR-008, FR-009 and D-017: an unknown user, a wrong password and a
 * locked account get the same answer, byte for byte — status, body and every
 * header. Nothing in it says which case it was, nor that a limit exists.
 */

const { POST: signIn } = await import('@/app/api/gestion/sesion/route');

type Snapshot = {
  readonly status: number;
  readonly body: string;
  readonly headers: readonly [string, string][];
};

async function snapshot(body: unknown): Promise<Snapshot> {
  const response = await signIn(signInRequest(body));
  return { status: response.status, body: await response.text(), headers: [...response.headers] };
}

beforeAll(async () => {
  await provisionOwner();
});

beforeEach(async () => {
  await testPool().query(
    'UPDATE owner_account SET failed_attempts = 0, first_failed_attempt_at = NULL, locked_until = NULL',
  );
});

afterAll(async () => {
  await testPool().query('TRUNCATE owner_account CASCADE');
  await closeTestDb();
});

describe('a rejected sign-in gives nothing away', () => {
  it('answers an unknown user, a wrong password and a locked account identically', async () => {
    const unknownUser = await snapshot({ username: 'nadie', password: OWNER.password });
    const wrongPassword = await snapshot({ username: OWNER.username, password: 'no es esta' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn(signInRequest({ username: OWNER.username, password: `mal ${attempt}` }));
    }
    // Locked now: even the right password gets the very same answer.
    const locked = await snapshot(OWNER);

    expect(unknownUser.status).toBe(401);
    expect(wrongPassword).toEqual(unknownUser);
    expect(locked).toEqual(unknownUser);
  });

  it('carries no header that would hint at a limit', async () => {
    const { headers } = await snapshot({ username: 'nadie', password: 'x' });
    const names = headers.map(([name]) => name.toLowerCase());

    expect(names).not.toContain('retry-after');
    expect(names.some((name) => name.includes('ratelimit'))).toBe(false);
    expect(names).not.toContain('set-cookie');
  });
});
