'use server';

import { redirect } from 'next/navigation';
import { container } from '@/app/_lib/container';

/**
 * Cancelling from the screen.
 *
 * Whatever the outcome, it redirects back to the appointment, which re-reads
 * the appointment and shows the truth: cancelled if it went through, and the
 * domain's own reason if it did not. There is no error state to plumb through
 * and therefore no way for the screen to claim something the database does not
 * say.
 */
export async function cancelAppointmentAction(formData: FormData): Promise<void> {
  const token = formData.get('token');
  const confirmed = formData.get('confirmed');

  if (typeof token !== 'string' || token === '') redirect('/');

  // FR-022: the explicit confirmation is restated in the payload, so a stray
  // request cannot cancel anything.
  if (confirmed !== 'true') redirect(`/cita/${token}`);

  await container().cancelAppointment(token);

  redirect(`/cita/${token}`);
}
