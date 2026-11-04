import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { messages } from '@/messages/es-ES';
import { unsubscribeAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: messages.unsubscribe.initial.title };

/**
 * The unsubscribe page an email links to (004, D-009). One column at every
 * width.
 *
 * Opening it unsubscribes nobody: it asks, with a button (FR-015). It names the
 * salon and nothing of the appointment — no day, no services, no name — since
 * its token is not the management link and must not open the appointment
 * (FR-024). Its opening counts in the same per-IP limit as a management link,
 * and the lookup runs even past it, so both answers take the same time.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { token } = await params;
  const justDone = (await searchParams)['hecha'] === '1';

  const clientIp = resolveClientIp({
    forwardedFor: (await headers()).get('x-forwarded-for'),
    remoteAddress: null,
  });
  const { allowed } = await rateLimiter().check('APPOINTMENT_LOOKUP', clientIp);
  const found = await container().revokeEmailConsent.inspect(token);

  if (!allowed || !found.ok) notFound();

  const { salonName, alreadyEnded } = found.value;
  const T = messages.unsubscribe;

  return (
    <>
      <header className="site-header">
        <p>{salonName}</p>
      </header>
      <main>
        {!alreadyEnded && (
          <>
            <h1>{T.initial.title}</h1>
            <p>
              {T.initial.bodyLead} <strong>{salonName}</strong> {T.initial.bodyRest}
            </p>
            <form action={unsubscribeAction}>
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="button">
                {T.initial.submit}
              </button>
            </form>
          </>
        )}

        {alreadyEnded && justDone && (
          <>
            <h1>{T.done.title}</h1>
            <div className="notice" role="status">
              <p>
                <span aria-hidden="true">{T.done.icon} </span>
                {T.done.body}
              </p>
            </div>
          </>
        )}

        {alreadyEnded && !justDone && (
          <>
            <h1>{T.already.title}</h1>
            <p>{T.already.body}</p>
          </>
        )}
      </main>
    </>
  );
}
