import { createHash, randomBytes } from 'node:crypto';
import type { TokenGenerator } from '@/application/ports';

/**
 * The management link is the credential (D-005).
 *
 * 32 bytes of CSPRNG — 256 bits, well past the 128 FR-017 asks for, at the same
 * cost. Nothing in it derives from the appointment or the client, so knowing one
 * link says nothing about any other (BR-016).
 *
 * Only the SHA-256 reaches the database: a database dump hands out no usable
 * links. With 256 bits of entropy there is no dictionary to attack, so an
 * unsalted digest is enough — and it makes FR-035 a single `NULL`.
 */

const TOKEN_BYTES = 32;

/** 32 bytes in base64url, unpadded. */
export const TOKEN_LENGTH = 43;

/** base64url: URL safe with nothing to escape, and shorter than hex to retype. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generate(): { token: string; hash: Uint8Array } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hash(token) };
}

export function hash(token: string): Uint8Array {
  return createHash('sha256').update(token, 'utf8').digest();
}

export const tokenGenerator: TokenGenerator = { generate, hash };
