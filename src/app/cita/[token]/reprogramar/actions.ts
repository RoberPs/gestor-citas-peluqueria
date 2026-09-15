'use server';

import { redirect } from 'next/navigation';
import { container } from '@/app/_lib/container';

/**
 * Moving the appointment from the screen.
 *
 * Like cancelling, it redirects back to the appointment whatever happens: the
 * next render re-reads the row and shows what is actually true, so the screen
 * cannot claim a move the database refused (FR-025, BR-006).
 *
 * The one case worth carrying across is the hour the client already had, which
 * is not a failure and deserves saying out loud (escenario 5).
 */
export async function rescheduleAction(formData: FormData): Promise<void> {
  const token = formData.get('token');
  const startsAt = formData.get('startsAt');

  if (typeof token !== 'string' || token === '') redirect('/');
  if (typeof startsAt !== 'string' || startsAt === '') redirect(`/cita/${token}/reprogramar`);

  const result = await container().rescheduleAppointment(token, startsAt);

  if (result.ok && result.value.unchanged) {
    redirect(`/cita/${token}/reprogramar?sinCambios=1`);
  }

  if (!result.ok && result.error.kind === 'REJECTED') {
    redirect(`/cita/${token}/reprogramar?ocupada=1`);
  }

  redirect(`/cita/${token}`);
}
