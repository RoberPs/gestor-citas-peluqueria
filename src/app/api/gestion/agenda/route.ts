import { z } from 'zod';
import { container } from '@/app/_lib/container';
import { messages } from '@/messages/es-ES';
import { jsonError, jsonOk } from '../../_lib/responses';
import { requireOwnerSession } from '../_lib/require-owner-session';
import { agendaDayDto } from '../_lib/serializers';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  incluirCanceladas: z.enum(['true', 'false']).default('false'),
});

/** One day of the agenda, whole, in one response (002, FR-011, D-027). */
export async function GET(request: Request): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = querySchema.safeParse(params);
  if (!query.success) {
    return jsonError(400, { code: 'BAD_REQUEST', ...messages.owner.errors.badRequest });
  }

  const result = await container().getAgendaDay({
    date: query.data.fecha,
    includeCancelled: query.data.incluirCanceladas === 'true',
  });
  if (!result.ok) {
    return jsonError(400, { code: 'INVALID_DATE', ...messages.owner.errors.badRequest });
  }

  return jsonOk(agendaDayDto(result.value.day, container().clock.now(), result.value.salon.timezone));
}
