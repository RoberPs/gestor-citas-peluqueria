import { container } from '@/app/_lib/container';
import { jsonError } from '../../../../_lib/responses';
import {
  appointmentIdSchema,
  appointmentResponse,
  cancellationSchema,
  malformedAppointment,
} from '../../../_lib/appointment-params';
import { requireOwnerSession } from '../../../_lib/require-owner-session';

export const dynamic = 'force-dynamic';

/**
 * Cancelling an appointment (002, Historia 5). The body is the explicit
 * confirmation FR-040 asks for; there is no deadline (BR-007) and no way back
 * (FR-042).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const id = appointmentIdSchema.safeParse((await context.params).id);
  const body = cancellationSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return jsonError(400, malformedAppointment);

  return appointmentResponse(await container().ownerAppointments.cancel(id.data), 200);
}
