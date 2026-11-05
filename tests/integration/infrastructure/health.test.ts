import { createServer, type Server } from 'node:net';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseIsReachable } from '@/infrastructure/db/health';
import { closeTestDb, ensureSchema, testPool } from '../helpers/test-db';

/**
 * `/health`, what the image's HEALTHCHECK asks (deploy/README.md). Healthy
 * means the process answers and its database does; it says nothing else, since
 * anyone on the internet can ask.
 */

const { GET } = await import('@/app/health/route');

/** A server that accepts the connection and never says a word: a hung database. */
let silent: Server;
let silentPort = 0;

beforeAll(async () => {
  await ensureSchema();
  silent = createServer(() => undefined);
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const address = silent.address();
  silentPort = typeof address === 'object' && address !== null ? address.port : 0;
});

afterAll(async () => {
  silent.close();
  await closeTestDb();
});

describe('databaseIsReachable', () => {
  it('is true when the database answers', async () => {
    expect(await databaseIsReachable(testPool(), 2_000)).toBe(true);
  });

  it('is false, and within its time limit, when the database never answers', async () => {
    const hung = new Pool({ connectionString: `postgresql://postgres:x@127.0.0.1:${silentPort}/salon` });
    const started = Date.now();

    expect(await databaseIsReachable(hung, 300)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    void hung.end().catch(() => undefined);
  });
});

describe('GET /health', () => {
  it('answers 200 {"status":"ok"} and is never cached', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
