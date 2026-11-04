import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { PasswordHasher } from '@/application/ports';

/**
 * The owner's password, derived with scrypt from the standard library (002,
 * D-016). Argon2id would need a native dependency, and with one account and a
 * sign-in every twelve hours at most nothing pays for it.
 *
 * The parameters travel with the hash, `scrypt$N$r$p$salt$hash`, so raising
 * them later invalidates nothing. Comparison is in constant time. Nothing here
 * logs, and nothing derivable from the password leaves this file but the key.
 */

const N = 2 ** 17;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
/** 128 · N · r bytes is 128 MiB; Node's default ceiling of 32 MiB would refuse it. */
const MAX_MEMORY = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...options, maxmem: MAX_MEMORY }, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}

function encode(salt: Buffer, key: Buffer): string {
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

type Decoded = { readonly salt: Buffer; readonly key: Buffer; readonly options: ScryptOptions };

function decode(encoded: string): Decoded | null {
  const [scheme, n, r, p, salt, key, ...rest] = encoded.split('$');
  if (scheme !== 'scrypt' || rest.length > 0 || salt === undefined || key === undefined) return null;

  const cost = Number(n);
  const blockSize = Number(r);
  const parallelization = Number(p);
  if (![cost, blockSize, parallelization].every(Number.isInteger) || cost < 2) return null;

  return {
    salt: Buffer.from(salt, 'base64url'),
    key: Buffer.from(key, 'base64url'),
    options: { N: cost, r: blockSize, p: parallelization },
  };
}

/**
 * Derived once, lazily: what the decoy verification compares against when the
 * user does not exist or the account is locked (D-017). Same parameters, so it
 * costs what a real verification costs.
 */
let decoy: Promise<string> | undefined;

async function verify(password: string, encoded: string): Promise<boolean> {
  const stored = decode(encoded);
  if (stored === null || stored.key.length !== KEY_BYTES) return false;

  try {
    const key = await derive(password, stored.salt, stored.options);
    return timingSafeEqual(key, stored.key);
  } catch {
    // Parameters scrypt refuses: not a hash this application wrote.
    return false;
  }
}

export const passwordHasher: PasswordHasher = {
  async hash(password) {
    const salt = randomBytes(SALT_BYTES);
    return encode(salt, await derive(password, salt, { N, r: R, p: P }));
  },

  verify,

  async verifyDecoy(password) {
    decoy ??= this.hash('decoy password nobody has');
    await verify(password, await decoy);
  },
};
