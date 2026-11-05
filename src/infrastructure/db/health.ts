import type { Pool } from 'pg';

/**
 * Whether the database answers a trivial query within `timeoutMs`.
 *
 * A database that accepts the connection and then hangs is as down as one that
 * refuses it, so the answer is bounded in time and never throws.
 */
export async function databaseIsReachable(pool: Pool, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  const answered = pool.query('SELECT 1').then(
    () => true,
    () => false,
  );

  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
