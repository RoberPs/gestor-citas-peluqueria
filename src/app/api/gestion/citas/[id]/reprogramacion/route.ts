import { container } from '@/app/_lib/container';
import { jsonError } from '../../../../_lib/responses';
import {
  appointmentIdSchema,
  appointmentResponse,
  malformedAppointment,
  rescheduleSchema,
} from '../../../_lib/appointment-params';
import { requireOwnerSession } from '../../../_lib/require-owner-session';

export const dynamic = 'force-dynamic';

/** Moving an appointment (002, Historia 5), with the same two steps as writing one. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const id = appointmentIdSchema.safeParse((await context.params).id);
  const body = rescheduleSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return jsonError(400, malformedAppointment);

  return appointmentResponse(await container().ownerAppointments.reschedule({ id: id.data, ...body.data }), 200);
}
