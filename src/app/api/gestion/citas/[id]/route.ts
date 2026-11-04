import { container } from '@/app/_lib/container';
import { jsonError } from '../../../_lib/responses';
import {
  appointmentIdSchema,
  appointmentResponse,
  editAppointmentSchema,
  malformedAppointment,
} from '../../_lib/appointment-params';
import { requireOwnerSession } from '../../_lib/require-owner-session';

export const dynamic = 'force-dynamic';

/**
 * Editing an appointment's services and its client's data (002, Historia 11,
 * D-035), with the same two steps as moving it when it grows over something.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const id = appointmentIdSchema.safeParse((await context.params).id);
  const body = editAppointmentSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return jsonError(400, malformedAppointment);

  return appointmentResponse(await container().ownerAppointments.edit({ id: id.data, ...body.data }), 200);
}
