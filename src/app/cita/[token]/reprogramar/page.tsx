import { Temporal } from '@js-temporal/polyfill';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { container } from '@/app/_lib/container';
import { longDateLabel } from '@/app/_lib/format';
import { availabilityResponse, unavailableReason } from '@/app/api/_lib/serializers';
import { DayRangePicker } from '@/components/day-range-picker';
import { SlotList } from '@/components/slot-list';
import { formatLocalTime, localDateOf } from '@/domain/shared/time';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { messages } from '@/messages/es-ES';
import { rescheduleAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Choosing a new hour (Historia 6).
 *
 * It reuses the day grid and the slot list of the booking screen, pointed at
 * this route instead of at `/`. There is no service picker at all: the service
 * is not something this screen can change, so it is not something this screen
 * offers (FR-024).
 */

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function shiftRange(from: string, days: number): string {
  return Temporal.PlainDate.from(from).add({ days }).toString();
}

export default async function ReschedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { token } = await params;
  const query = await searchParams;

  const clientIp = resolveClientIp({
    forwardedFor: (await headers()).get('x-forwarded-for'),
    remoteAddress: null,
  });
  const { allowed } = await rateLimiter().check('APPOINTMENT_LOOKUP', clientIp);

  const detail = await container().viewAppointment(token);
  if (!allowed || detail === null) notFound();

  const here = `/cita/${token}/reprogramar`;
  const { appointment, salon } = detail;
  const timezone = salon.timezone;

  if (!detail.canReschedule) {
    // FR-028: the reason is the domain's, and the phone is the way out.
    return (
      <main>
        <h1>{messages.reschedule.title}</h1>
        <div className="notice-warning" role="status">
          <p>{messages.reschedule.blocked}</p>
          <p>{unavailableReason(detail)}</p>
        </div>
        <Link className="button" href={`/cita/${token}`}>
          {messages.common.back}
        </Link>
      </main>
    );
  }

  // Until the client navigates, the screen opens on the day they already have.
  // Landing on today instead would hide the very thing escenario 4 is about —
  // their own hour, marked as theirs — behind two taps.
  const ownDate = localDateOf(appointment.startsAt, timezone).toString();

  const currentAppointment = { services: appointment.services, startsAt: appointment.startsAt };
  const serviceIds = appointment.services.map((service) => service.serviceId);

  const result = await container().getAvailability({
    rangeStart: first(query, 'rangeStart') ?? ownDate,
    selectedDate: first(query, 'selectedDate') ?? ownDate,
    currentAppointment,
  });

  const fallback = result.ok ? result : await container().getAvailability({ currentAppointment });

  if (!fallback.ok) notFound();

  const availability = availabilityResponse(fallback.value);
  const chosen = first(query, 'startsAt');

  return (
    <>
      <header className="site-header site-header--split">
        <p>
          {salon.name} · {salon.address}
        </p>
      </header>

      {/* On desktop, the days on the left and the hours and the confirmation on
          the right, as when booking (003, FR-012). Once an hour is chosen the
          grid and the list stay in view there only: the phone keeps showing
          just the confirmation, as in 001. */}
      <main className="page--split">
        <h1>{messages.reschedule.title}</h1>

        <p>{messages.reschedule.sameServiceNotice(appointment.services[0].name)}</p>

        <div className="col-main">
          <div className="card">
            <p className="muted">
              {messages.reschedule.currentSlot}:{' '}
              <strong>
                {longDateLabel(localDateOf(appointment.startsAt, timezone).toString())},{' '}
                {formatLocalTime(appointment.startsAt, timezone)}
              </strong>
            </p>
            <p className="muted">{messages.reschedule.linkUnchanged}</p>
          </div>

          {query['sinCambios'] === '1' && (
            <div className="notice" role="status">
              <p>{messages.reschedule.unchanged.message}</p>
              <p>{messages.reschedule.unchanged.nextAction}</p>
            </div>
          )}

          {query['ocupada'] === '1' && (
            <div className="notice-error" role="alert">
              <p>{messages.reschedule.slotTaken.message}</p>
              <p>{messages.reschedule.slotTaken.nextAction}</p>
            </div>
          )}

          <div className={chosen === undefined ? undefined : 'wide-only'}>
            <DayRangePicker
              availability={availability}
              serviceIds={serviceIds}
              previousRangeStart={shiftRange(availability.range.start, -availability.days.length)}
              nextRangeStart={shiftRange(availability.range.end, 1)}
              action={here}
            />
          </div>
        </div>

        <div className="col-side">
          <div className={chosen === undefined ? undefined : 'wide-only'}>
            <SlotList
              availability={availability}
              serviceIds={serviceIds}
              action={here}
              browseAction={here}
              {...(chosen === undefined ? {} : { selectedStartsAt: chosen, live: false })}
            />
          </div>

          {/* Always on the page, so choosing an hour announces the confirmation
              it asks for, and only that, once (003, FR-016). */}
          <div aria-live="polite">
            {chosen !== undefined && (
              <ConfirmPanel token={token} startsAt={chosen} timezone={timezone} back={here} />
            )}
          </div>

          <p>
            <Link className="button-secondary" href={`/cita/${token}`}>
              {messages.common.back}
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}

/** The explicit confirmation a destructive change asks for (FR-022). */
function ConfirmPanel({
  token,
  startsAt,
  timezone,
  back,
}: {
  readonly token: string;
  readonly startsAt: string;
  readonly timezone: string;
  readonly back: string;
}) {
  let when = startsAt;
  try {
    const instant = Temporal.Instant.from(startsAt);
    when = `${longDateLabel(localDateOf(instant, timezone).toString())}, ${formatLocalTime(
      instant,
      timezone,
    )}`;
  } catch {
    when = startsAt;
  }

  return (
    <section aria-labelledby="confirm-heading" className="notice-warning confirm-panel">
      <h2 id="confirm-heading">{messages.reschedule.confirmTitle}</h2>
      <p>
        <strong>{when}</strong>
      </p>
      <p>{messages.reschedule.linkUnchanged}</p>

      <div className="actions">
        <form action={rescheduleAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="startsAt" value={startsAt} />
          <button type="submit" className="button">
            {messages.reschedule.confirmYes}
          </button>
        </form>

        <Link className="button-secondary" href={back}>
          {messages.reschedule.confirmNo}
        </Link>
      </div>
    </section>
  );
}
