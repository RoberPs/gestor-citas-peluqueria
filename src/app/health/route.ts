import { pool } from '@/infrastructure/db/client';
import { databaseIsReachable } from '@/infrastructure/db/health';

/**
 * `/health`, what the image's HEALTHCHECK asks. Public, because Caddy forwards
 * every path, so it answers one word and nothing about versions or causes.
 */

export const dynamic = 'force-dynamic';

const DATABASE_TIMEOUT_MS = 2_000;

export async function GET(): Promise<Response> {
  const healthy = await databaseIsReachable(pool(), DATABASE_TIMEOUT_MS);

  return Response.json(
    { status: healthy ? 'ok' : 'unavailable' },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
