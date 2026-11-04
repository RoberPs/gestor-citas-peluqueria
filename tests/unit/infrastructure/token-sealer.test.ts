import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTokenSealer } from '@/infrastructure/security/token-sealer';

/**
 * 004, D-002: the links of a pending confirmation, sealed with AES-256-GCM.
 * Anything that is not exactly what was sealed, with exactly that key, opens
 * to nothing.
 */

const KEY = randomBytes(32).toString('base64');
const TOKENS = {
  management: 'kJ8x2mQvR7tY1pL4wN6bC3dF5gH9jK0mZxA2sD4fG6h',
  unsubscribe: 'Zq1w2e3r4t5y6u7i8o9p0aAsSdDfFgGhHjJkKlLzZxX',
};

describe('TokenSealer', () => {
  it('opens what it sealed', () => {
    const sealer = createTokenSealer(KEY);
    expect(sealer.open(sealer.seal(TOKENS))).toEqual(TOKENS);
  });

  it('never writes a token in clear', () => {
    const sealed = Buffer.from(createTokenSealer(KEY).seal(TOKENS));
    expect(sealed.toString('utf8')).not.toContain(TOKENS.management);
    expect(sealed.toString('base64url')).not.toContain(TOKENS.management);
  });

  it('opens to null when one byte has changed', () => {
    const sealer = createTokenSealer(KEY);
    const sealed = Buffer.from(sealer.seal(TOKENS));
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 0x01;
    expect(sealer.open(sealed)).toBeNull();
  });

  it('opens to null when truncated', () => {
    const sealer = createTokenSealer(KEY);
    const sealed = sealer.seal(TOKENS);
    expect(sealer.open(sealed.subarray(0, sealed.length - 4))).toBeNull();
    expect(sealer.open(sealed.subarray(0, 10))).toBeNull();
    expect(sealer.open(new Uint8Array())).toBeNull();
  });

  it('opens to null with another key', () => {
    const sealed = createTokenSealer(KEY).seal(TOKENS);
    expect(createTokenSealer(randomBytes(32).toString('base64')).open(sealed)).toBeNull();
  });

  it('seals the same tokens differently each time: the IV is random', () => {
    const sealer = createTokenSealer(KEY);
    expect(Buffer.from(sealer.seal(TOKENS)).equals(Buffer.from(sealer.seal(TOKENS)))).toBe(false);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => createTokenSealer(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
