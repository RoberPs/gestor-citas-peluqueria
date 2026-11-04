import { container } from '@/app/_lib/container';
import { jsonError } from '../../_lib/responses';
import { appointmentResponse, createAppointmentSchema, malformedAppointment } from '../_lib/appointment-params';
import { requireOwnerSession } from '../_lib/require-owner-session';

export const dynamic = 'force-dynamic';

/**
 * Writing an appointment by hand (002, Historia 4), in two steps: what is in
 * the way, or outside the opening hours, comes back as 409 with a
 * `stateToken`, and nothing is saved until the owner answers (FR-032, D-023).
 */
export async function POST(request: Request): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const body = createAppointmentSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, malformedAppointment);

  return appointmentResponse(await container().ownerAppointments.create(body.data), 201);
}
