import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { container } from '@/app/_lib/container';
import { longDateLabel } from '@/app/_lib/format';
import { priceTotalDto, snapshotDto, unavailableReason } from '@/app/api/_lib/serializers';
import { CancelDialog } from '@/components/cancel-dialog';
import { ServiceSummary } from '@/components/service-summary';
import { durationOf } from '@/domain/booking/appointment';
import { totalPriceOf } from '@/domain/catalog/selection';
import { formatLocalTime, localDateOf } from '@/domain/shared/time';
import { managementLink, resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { messages, withPhone } from '@/messages/es-ES';

export const dynamic = 'force-dynamic';

/**
 * The appointment screen (Historia 3, 4 and 5).
 *
 * It is the same screen in three states — confirmed, cancelled, completed —
 * and the same screen the confirmation lands on after `?nueva=1` (D-010). One
 * screen means the confirmation and the later lookup cannot disagree about what
 * the appointment says.
 *
 * A link that does not resolve, for any reason at all, renders the neutral
 * screen. So does one that has exceeded the per-IP limit: telling those cases
 * apart is precisely what FR-038 forbids.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const isFreshlyBooked = query['nueva'] === '1';
  const isConfirmingCancellation = query['cancelar'] === '1';

  const clientIp = resolveClientIp({
    forwardedFor: (await headers()).get('x-forwarded-for'),
    remoteAddress: null,
  });
  const { allowed } = await rateLimiter().check('APPOINTMENT_LOOKUP', clientIp);

  // The lookup runs even when the limit has been hit, so the two answers take
  // the same time as well as saying the same thing (D-006).
  const detail = await container().viewAppointment(token);

  if (!allowed || detail === null) notFound();

  const { appointment, salon, view } = detail;
  const timezone = salon.timezone;
  const date = localDateOf(appointment.startsAt, timezone).toString();
  const status = messages.appointment.status[view];
  const reason = unavailableReason(detail);

  return (
    <>
      <header className="site-header site-header--split">
        <p>
          {salon.name} · {salon.address}
        </p>
      </header>

      {/* On desktop, the appointment on the left and what can be done with it on
          the right (003, FR-011a). Below 1024 px, one column in this order. */}
      <main className="page--split">
        <h1>{isFreshlyBooked ? messages.confirmation.title : messages.appointment.title}</h1>

        {isFreshlyBooked && <p>{messages.confirmation.intro}</p>}

        <div className="col-main">
          <section aria-labelledby="appointment-heading" className="card">
            <h2 id="appointment-heading" className="visually-hidden">
              {messages.appointment.title}
            </h2>

            <dl className="summary">
              <dt>{messages.appointment.statusLabel}</dt>
              <dd>
                <span className={`status status-${view.toLowerCase()}`}>
                  <span aria-hidden="true">{status.icon} </span>
                  {status.label}
                </span>
              </dd>

              {/* Every service as it was booked, with the totals the domain
                  decides (005, FR-013, FR-014). One service reads as in 001. */}
              <ServiceSummary
                services={appointment.services.map(snapshotDto)}
                durationMinutes={durationOf(appointment)}
                price={priceTotalDto(totalPriceOf(appointment.services))}
              >
                <dt>{messages.booking.summaryDate}</dt>
                <dd>{longDateLabel(date)}</dd>

                <dt>{messages.booking.summaryTime}</dt>
                <dd>
                  {formatLocalTime(appointment.startsAt, timezone)} –{' '}
                  {formatLocalTime(appointment.endsAt, timezone)}
                </dd>
              </ServiceSummary>

              <dt>{messages.booking.summaryCancellationPolicy}</dt>
              <dd>{messages.booking.cancellationPolicyValue(detail.policy.cancellationDeadlineHours)}</dd>
            </dl>

            <p className="muted">{messages.common.timezoneNotice}</p>
          </section>

          {isFreshlyBooked && (
            <section aria-labelledby="save-link-heading" className="notice-warning">
              <h2 id="save-link-heading">{messages.confirmation.saveLinkTitle}</h2>
              <p>{messages.confirmation.saveLinkWarning}</p>
              <p>
                <strong>{messages.confirmation.linkLabel}:</strong>
                <br />
                <a className="management-link" href={managementLink(token)}>
                  {managementLink(token)}
                </a>
              </p>
            </section>
          )}
        </div>

        <div className="col-side">
          <section aria-labelledby="actions-heading">
            <h2 id="actions-heading">{messages.appointment.title}</h2>

            {view === 'CANCELLED' && detail.appointment.cancelledBy !== null && (
              <p>{withPhone(messages.appointment.cancelledBy[detail.appointment.cancelledBy], detail.salon.phone)}</p>
            )}
            {view === 'COMPLETED' && <p>{messages.appointment.completedNote}</p>}

            {reason !== null && (
              <div className="notice-warning" role="status" id="unavailable-reason">
                <p>{reason}</p>
              </div>
            )}

            {detail.canCancel && isConfirmingCancellation ? (
              <CancelDialog token={token} confirming />
            ) : (
              <div className="actions">
                {detail.canReschedule ? (
                  <Link className="button-secondary" href={`/cita/${token}/reprogramar`}>
                    {messages.appointment.rescheduleAction}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="button-secondary"
                    aria-disabled="true"
                    aria-describedby="unavailable-reason"
                  >
                    {messages.appointment.rescheduleAction}
                  </button>
                )}

                {detail.canCancel ? (
                  <CancelDialog token={token} confirming={false} />
                ) : (
                  <button
                    type="button"
                    className="button-secondary"
                    aria-disabled="true"
                    aria-describedby="unavailable-reason"
                  >
                    {messages.appointment.cancelAction}
                  </button>
                )}
              </div>
            )}

            <p>
              <Link className="button" href="/">
                {messages.appointment.bookAnother}
              </Link>
            </p>
          </section>

          <section aria-labelledby="salon-heading" className="card">
            <h2 id="salon-heading">{messages.appointment.salonTitle}</h2>
            <dl className="summary">
              <dt>{messages.appointment.salonName}</dt>
              <dd>{salon.name}</dd>
              <dt>{messages.appointment.salonAddress}</dt>
              <dd>{salon.address}</dd>
              <dt>{messages.appointment.salonPhone}</dt>
              <dd>
                <a href={`tel:${salon.phone.replace(/\s/g, '')}`}>{salon.phone}</a>
              </dd>
            </dl>
          </section>
        </div>
      </main>
    </>
  );
}
