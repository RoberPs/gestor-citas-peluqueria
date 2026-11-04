import { z } from 'zod';
import { container } from '@/app/_lib/container';
import { jsonError, jsonOk } from '../../_lib/responses';
import { encodeCursor, listErrorOf, listInputOf, paramsOf } from '../_lib/booking-list-params';
import { requireOwnerSession } from '../_lib/require-owner-session';
import { ownerAppointmentDto } from '../_lib/serializers';

export const dynamic = 'force-dynamic';

/** Shape and length only: what each value means is the domain's (D-033). */
const querySchema = z
  .object({
    orden: z.string().max(20),
    estado: z.string().max(20),
    origen: z.string().max(20),
    desde: z.string().max(10),
    hasta: z.string().max(10),
    buscar: z.string().max(100),
    despues: z.string().max(200),
  })
  .partial()
  .strict();

/** A page of the bookings list (002, Historia 10), in one query (FR-066). */
export async function GET(request: Request): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return jsonError(400, listErrorOf('INVALID_CURSOR'));

  const input = listInputOf(parsed.data);
  if (input === 'INVALID') return jsonError(400, listErrorOf('INVALID_CURSOR'));

  const result = await container().listBookings(input);
  if (!result.ok) return jsonError(400, listErrorOf(result.error));

  const { query, page, salon, confirmationCalls } = result.value;
  const now = container().clock.now();

  return jsonOk({
    query: paramsOf(query, parsed.data.buscar),
    rows: page.rows.map((row) => ownerAppointmentDto(row, now, salon.timezone, confirmationCalls)),
    next: page.next === null ? null : encodeCursor(page.next),
  });
}
