import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import { schema } from './schema';

/**
 * One connection pool per process.
 *
 * Next.js reloads modules in development; without the global cache every reload
 * would leak a pool and the database would run out of connections before lunch.
 */
const globalForDb = globalThis as unknown as {
  __salonPool?: Pool;
};

export function pool(): Pool {
  globalForDb.__salonPool ??= new Pool({ connectionString: env().databaseUrl, max: 10 });
  return globalForDb.__salonPool;
}

export type Database = NodePgDatabase<typeof schema>;

export function db(): Database {
  return drizzle(pool(), { schema });
}
