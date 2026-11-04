import { createHash } from 'node:crypto';
import type { StateHasher } from '@/application/ports';

/**
 * The hash behind the `stateToken` of a conflict (002, D-024): the SHA-256 of
 * what the warning shows, in base64url. It is a fingerprint to compare, not a
 * secret, so nothing here is keyed.
 */
export const stateHash: StateHasher = (input) => createHash('sha256').update(input, 'utf8').digest('base64url');
