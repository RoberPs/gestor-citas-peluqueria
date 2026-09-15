import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hash, generate, TOKEN_LENGTH } from '@/infrastructure/security/token';

/**
 * D-005: 32 bytes of CSPRNG, base64url, and only the SHA-256 reaches the
 * database. FR-017 asks for at least 128 bits; this gives 256 at the same cost.
 */

describe('token generator', () => {
  it('produces 43 base64url characters', () => {
    const { token } = generate();

    expect(token).toHaveLength(43);
    expect(TOKEN_LENGTH).toBe(43);
  });

  it('uses only the base64url alphabet, so the token survives a URL unescaped', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generate().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('hashes to a stable 32 byte SHA-256', () => {
    const { token, hash: fromGenerate } = generate();

    const rehashed = hash(token);

    expect(fromGenerate).toHaveLength(32);
    expect(Buffer.from(rehashed)).toEqual(Buffer.from(fromGenerate));
    expect(Buffer.from(rehashed)).toEqual(createHash('sha256').update(token, 'utf8').digest());
  });

  it('gives different tokens different hashes', () => {
    const a = generate();
    const b = generate();

    expect(Buffer.from(a.hash).equals(Buffer.from(b.hash))).toBe(false);
  });

  it('generates 10.000 tokens without a collision', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 10_000; i += 1) {
      seen.add(generate().token);
    }

    expect(seen.size).toBe(10_000);
  });
});
