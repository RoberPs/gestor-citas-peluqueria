import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { messages } from '@/messages/es-ES';
import { closeTestDb, ensureSchema } from '../helpers/test-db';

/**
 * 002, T035, SC-001 and D-018: without a session, NO owner route answers with
 * anything but the neutral 401.
 *
 * The routes are found in the file system, as Next finds them, not listed by
 * hand: a list goes stale the day someone adds an endpoint, and that endpoint
 * is the one that would leak. Every exported method of every `route.ts` under
 * `api/gestion` is called with no cookie and with made-up path parameters.
 *
 * The one exception is signing in, which is the door itself (FR-002).
 */

const API_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'app',
  'api',
  'gestion',
);

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const SIGN_IN = 'POST /api/gestion/sesion';
const SOME_UUID = '00000000-0000-4000-8000-000000000999';

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return entry.startsWith('_') ? [] : routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

/** `.../api/gestion/citas/[id]/route.ts` → `/api/gestion/citas/[id]` */
function urlPathOf(file: string): string {
  const relative = path.relative(path.join(API_ROOT, '..'), path.dirname(file));
  return `/api/${relative.split(path.sep).join('/')}`;
}

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const endpoints = await Promise.all(
  routeFiles(API_ROOT).map(async (file) => {
    const module = (await import(file)) as Partial<Record<(typeof METHODS)[number], Handler>>;
    const route = urlPathOf(file);
    return METHODS.filter((method) => typeof module[method] === 'function').map((method) => ({
      name: `${method} ${route}`,
      method,
      route,
      handler: module[method] as Handler,
    }));
  }),
).then((lists) => lists.flat());

const guarded = endpoints.filter((endpoint) => endpoint.name !== SIGN_IN);

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  await closeTestDb();
});

describe('the owner API sweep (SC-001)', () => {
  it('finds the routes at all, sign-in among them, so an empty sweep cannot pass', () => {
    expect(endpoints.map((endpoint) => endpoint.name)).toContain(SIGN_IN);
    expect(guarded.length).toBeGreaterThanOrEqual(2);
  });

  it.each(guarded.map((endpoint) => [endpoint.name, endpoint] as const))(
    '%s answers 401 with no data without a session',
    async (_name, endpoint) => {
      const params = Object.fromEntries(
        [...endpoint.route.matchAll(/\[(\w+)\]/g)].map(([, key]) => [key ?? '', SOME_UUID]),
      );
      const url = `http://localhost${endpoint.route.replace(/\[\w+\]/g, SOME_UUID)}`;
      const request = new Request(url, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        ...(endpoint.method === 'GET' || endpoint.method === 'DELETE' ? {} : { body: '{}' }),
      });

      const response = await endpoint.handler(request, { params: Promise.resolve(params) });

      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        code: 'UNAUTHENTICATED',
        ...messages.owner.errors.unauthenticated,
      });
    },
  );
});
