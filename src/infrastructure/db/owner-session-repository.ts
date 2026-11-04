import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import type { OwnerSessionRepository } from '@/application/ports';

/**
 * The owner's live sessions (002, D-015). Only the SHA-256 of the cookie is
 * stored, so a dump of this table hands out no usable session.
 */

type SessionRow = {
  readonly id: string;
  readonly account_id: string;
  readonly last_seen_at: Date;
};

function dateOf(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

export function createOwnerSessionRepository(getPool: () => Pool): OwnerSessionRepository {
  return {
    async create(session) {
      await getPool().query(
        `INSERT INTO owner_session (id, account_id, token_hash, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [session.id, session.accountId, Buffer.from(session.tokenHash), dateOf(session.at)],
      );
    },

    async findByTokenHash(hash) {
      const { rows } = await getPool().query<SessionRow>(
        'SELECT id, account_id, last_seen_at FROM owner_session WHERE token_hash = $1',
        [Buffer.from(hash)],
      );
      const row = rows[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            accountId: row.account_id,
            lastSeenAt: Temporal.Instant.fromEpochMilliseconds(row.last_seen_at.getTime()),
          };
    },

    async touch(id, at) {
      await getPool().query('UPDATE owner_session SET last_seen_at = $2 WHERE id = $1', [
        id,
        dateOf(at),
      ]);
    },

    async deleteByTokenHash(hash) {
      await getPool().query('DELETE FROM owner_session WHERE token_hash = $1', [Buffer.from(hash)]);
    },

    async deleteAllExcept(accountId, keepHash) {
      await getPool().query('DELETE FROM owner_session WHERE account_id = $1 AND token_hash <> $2', [
        accountId,
        Buffer.from(keepHash),
      ]);
    },

    async deleteIdleSince(cutoff) {
      const { rowCount } = await getPool().query(
        'DELETE FROM owner_session WHERE last_seen_at <= $1',
        [dateOf(cutoff)],
      );
      return rowCount ?? 0;
    },
  };
}
