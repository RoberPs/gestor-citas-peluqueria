'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';

/**
 * The button of the unsubscribe page (004, FR-015). A form, so it works without
 * JavaScript, and a POST-Redirect-GET back to the page, which then says it is
 * done. Whatever happened, the page reads the truth again: a token that does
 * not resolve gets the neutral screen there.
 */
export async function unsubscribeAction(formData: FormData): Promise<void> {
  const token = formData.get('token');
  if (typeof token !== 'string' || token === '') redirect('/');

  const clientIp = resolveClientIp({
    forwardedFor: (await headers()).get('x-forwarded-for'),
    remoteAddress: null,
  });
  const { allowed } = await rateLimiter().check('APPOINTMENT_LOOKUP', clientIp);

  if (allowed) await container().revokeEmailConsent.byUnsubscribeToken(token);

  redirect(`/baja/${token}?hecha=1`);
}
