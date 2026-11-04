import { container } from '@/app/_lib/container';
import { jsonError, jsonOk } from '../../../_lib/responses';
import {
  invalidPeriod,
  malformedPeriod,
  periodIdSchema,
  periodNotFound,
  periodSpanSchema,
} from '../../_lib/period-params';
import { requireOwnerSession } from '../../_lib/require-owner-session';
import { periodDto } from '../../_lib/serializers';

export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly id: string }> };

/** Shortening a period to make room without deleting it (FR-019). */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const id = periodIdSchema.safeParse((await context.params).id);
  if (!id.success) return jsonError(404, periodNotFound);

  const body = periodSpanSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(422, malformedPeriod);

  const result = await container().unavailablePeriods.shorten({ id: id.data, ...body.data });
  if (result.ok) return jsonOk(periodDto(result.value.period, result.value.timezone));
  return result.error.kind === 'NOT_FOUND'
    ? jsonError(404, periodNotFound)
    : jsonError(422, invalidPeriod(result.error));
}

/** Releasing the time: the starts come back in the client's next query (SC-003). */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const id = periodIdSchema.safeParse((await context.params).id);
  if (!id.success) return jsonError(404, periodNotFound);

  const result = await container().unavailablePeriods.remove(id.data);
  return result.ok ? new Response(null, { status: 204 }) : jsonError(404, periodNotFound);
}
