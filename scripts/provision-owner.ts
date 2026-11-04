import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import { Pool } from 'pg';
import { validateNewPassword } from '../src/domain/owner/account';
import { err, ok, type Result } from '../src/domain/shared/result';
import { createOwnerAccountRepository } from '../src/infrastructure/db/owner-account-repository';
import { passwordHasher } from '../src/infrastructure/security/password';

/**
 * `npm run owner:provision` — the owner's account, provisioned outside the
 * application (002, FR-003). It is also what to run when she forgets her
 * password: there is no recovery in the app (FR-005).
 *
 * It reads OWNER_USERNAME and OWNER_INITIAL_PASSWORD, which are single-use:
 * the running application never reads them, and the password should leave the
 * server's environment once this has run (quickstart.md). It replaces any
 * account there was, and with it every open session, and it says so. The
 * password is never printed, not even in part (FR-010).
 */

export type ProvisionFailure = 'USERNAME_MISSING' | 'PASSWORD_TOO_SHORT';

export async function provisionOwnerAccount(input: {
  readonly connectionString: string;
  readonly username: string;
  readonly password: string;
}): Promise<Result<{ readonly replaced: boolean }, ProvisionFailure>> {
  const username = input.username.trim();
  if (username === '') return err('USERNAME_MISSING');

  const password = validateNewPassword(input.password);
  if (!password.ok) return err('PASSWORD_TOO_SHORT');

  const pool = new Pool({ connectionString: input.connectionString, max: 1 });
  try {
    const outcome = await createOwnerAccountRepository(() => pool).replace({
      id: randomUUID(),
      username,
      passwordHash: await passwordHasher.hash(password.value),
      at: Temporal.Now.instant(),
    });
    return ok(outcome);
  } finally {
    await pool.end();
  }
}

const isCli = process.argv[1] !== undefined && path.basename(process.argv[1]).startsWith('provision-owner');

if (isCli) {
  const connectionString = process.env['DATABASE_URL'] ?? '';
  if (connectionString === '') {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const outcome = await provisionOwnerAccount({
    connectionString,
    username: process.env['OWNER_USERNAME'] ?? '',
    password: process.env['OWNER_INITIAL_PASSWORD'] ?? '',
  });

  if (!outcome.ok) {
    console.error(
      outcome.error === 'USERNAME_MISSING'
        ? 'OWNER_USERNAME is not set.'
        : 'OWNER_INITIAL_PASSWORD must be at least 12 characters long.',
    );
    process.exit(1);
  }

  console.log(
    outcome.value.replaced
      ? 'Replaced the existing owner account. Every open session has been closed.'
      : 'Created the owner account.',
  );
  console.log('Remove OWNER_INITIAL_PASSWORD from the environment now: the app never reads it.');
}
