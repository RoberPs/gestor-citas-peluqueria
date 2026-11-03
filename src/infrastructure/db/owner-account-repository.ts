import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import type { OwnerAccountRecord, OwnerAccountRepository } from '@/application/ports';

/**
 * The one staff account (002, FR-001). The table can hold at most one row, and
 * nothing in it is about a client or an origin (FR-009).
 */

type AccountRow = {
  readonly id: string;
  readonly username: string;
  readonly password_hash: string;
  readonly failed_attempts: number;
  readonly first_failed_attempt_at: Date | null;
  readonly locked_until: Date | null;
};

function instantOrNull(value: Date | null): Temporal.Instant | null {
  return value === null ? null : Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

function dateOrNull(value: Temporal.Instant | null): Date | null {
  return value === null ? null : new Date(value.epochMilliseconds);
}

function toRecord(row: AccountRow): OwnerAccountRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    lockout: {
      failedAttempts: row.failed_attempts,
      firstFailedAttemptAt: instantOrNull(row.first_failed_attempt_at),
      lockedUntil: instantOrNull(row.locked_until),
    },
  };
}

const COLUMNS = 'id, username, password_hash, failed_attempts, first_failed_attempt_at, locked_until';

export function createOwnerAccountRepository(getPool: () => Pool): OwnerAccountRepository {
  return {
    async findByUsername(username) {
      const { rows } = await getPool().query<AccountRow>(
        `SELECT ${COLUMNS} FROM owner_account WHERE username = $1`,
        [username],
      );
      return rows[0] === undefined ? null : toRecord(rows[0]);
    },

    async findById(id) {
      const { rows } = await getPool().query<AccountRow>(
        `SELECT ${COLUMNS} FROM owner_account WHERE id = $1`,
        [id],
      );
      return rows[0] === undefined ? null : toRecord(rows[0]);
    },

    async saveLockout(id, state) {
      await getPool().query(
        `UPDATE owner_account
            SET failed_attempts = $2, first_failed_attempt_at = $3, locked_until = $4
          WHERE id = $1`,
        [id, state.failedAttempts, dateOrNull(state.firstFailedAttemptAt), dateOrNull(state.lockedUntil)],
      );
    },

    async updatePassword(id, encoded, at) {
      await getPool().query(
        'UPDATE owner_account SET password_hash = $2, password_changed_at = $3 WHERE id = $1',
        [id, encoded, new Date(at.epochMilliseconds)],
      );
    },

    async replace(account) {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        // Deleting the account closes every session with it (ON DELETE CASCADE).
        const { rowCount } = await client.query('DELETE FROM owner_account');
        await client.query(
          `INSERT INTO owner_account (id, username, password_hash, password_changed_at)
           VALUES ($1, $2, $3, $4)`,
          [account.id, account.username, account.passwordHash, new Date(account.at.epochMilliseconds)],
        );
        await client.query('COMMIT');
        return { replaced: (rowCount ?? 0) > 0 };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
