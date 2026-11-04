import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { NotificationTokens, TokenSealer } from '@/application/ports';

/**
 * The links of a pending confirmation, sealed (004, D-002).
 *
 * The database keeps only the hash of the management token, yet a retry half
 * an hour later has to put the link in the email. So the two tokens travel in
 * the notification row, encrypted with AES-256-GCM, and the row loses them the
 * moment it reaches a final state. Without the key a database dump yields no
 * link; with both, at most those of the last hour.
 *
 * Layout: IV (12 bytes) ‖ authentication tag (16) ‖ ciphertext.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function createTokenSealer(keyBase64: string): TokenSealer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('NOTIFICATION_SEAL_KEY must be 32 bytes in base64');

  return {
    seal(tokens) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const plain = Buffer.from(JSON.stringify([tokens.management, tokens.unsubscribe]), 'utf8');
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },

    open(sealed): NotificationTokens | null {
      if (sealed.length <= IV_BYTES + TAG_BYTES) return null;
      const bytes = Buffer.from(sealed);
      try {
        const decipher = createDecipheriv(ALGORITHM, key, bytes.subarray(0, IV_BYTES));
        decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        const plain = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
        const parsed: unknown = JSON.parse(plain.toString('utf8'));
        if (!Array.isArray(parsed) || parsed.length !== 2) return null;
        const [management, unsubscribe] = parsed as unknown[];
        if (typeof management !== 'string' || typeof unsubscribe !== 'string') return null;
        return { management, unsubscribe };
      } catch {
        // A wrong key, a changed byte or a truncated value: all the same to the caller.
        return null;
      }
    },
  };
}
