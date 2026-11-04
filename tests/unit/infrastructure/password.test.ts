import { describe, expect, it } from 'vitest';
import { passwordHasher } from '@/infrastructure/security/password';

/**
 * 002, T034 and D-016: scrypt from node:crypto, N = 2^17, r = 8, p = 1, a
 * 16 byte salt and a 64 byte key, with the parameters stored alongside.
 *
 * Each derivation is meant to be slow: over a second when the whole unit
 * suite shares the CPU, and a test here runs up to four of them. The timeout
 * says so, rather than the parameters being weakened for the test's sake.
 */

const SCRYPT_TIMEOUT_MS = 30_000;

describe('passwordHasher', { timeout: SCRYPT_TIMEOUT_MS }, () => {
  it('stores scrypt$N$r$p$salt$hash, with the parameters of D-016', async () => {
    const encoded = await passwordHasher.hash('una contraseña larga');
    const [scheme, n, r, p, salt, key] = encoded.split('$');

    expect([scheme, n, r, p]).toEqual(['scrypt', '131072', '8', '1']);
    expect(Buffer.from(salt ?? '', 'base64url')).toHaveLength(16);
    expect(Buffer.from(key ?? '', 'base64url')).toHaveLength(64);
  });

  it('never stores the password, nor the same hash twice: each has its own salt', async () => {
    const first = await passwordHasher.hash('una contraseña larga');
    const second = await passwordHasher.hash('una contraseña larga');

    expect(first).not.toContain('contraseña');
    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects any other', async () => {
    const encoded = await passwordHasher.hash('una contraseña larga');

    expect(await passwordHasher.verify('una contraseña larga', encoded)).toBe(true);
    expect(await passwordHasher.verify('una contraseña largo', encoded)).toBe(false);
    expect(await passwordHasher.verify('', encoded)).toBe(false);
  });

  it('rejects anything that is not a hash it wrote, rather than throwing', async () => {
    expect(await passwordHasher.verify('x', 'bcrypt$whatever')).toBe(false);
    expect(await passwordHasher.verify('x', 'scrypt$1$1$1$AA$AA')).toBe(false);
  });

  it('spends a derivation on the decoy too, so a missing user answers as slowly (D-017)', async () => {
    const started = performance.now();
    await passwordHasher.verifyDecoy('lo que sea');
    const decoy = performance.now() - started;

    const encoded = await passwordHasher.hash('una contraseña larga');
    const real = performance.now();
    await passwordHasher.verify('lo que sea', encoded);
    const verify = performance.now() - real;

    // Same parameters, same cost: within a factor of three either way.
    expect(decoy).toBeGreaterThan(verify / 3);
    expect(decoy).toBeLessThan(verify * 3);
  });
});
