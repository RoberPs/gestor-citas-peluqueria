import { Temporal } from '@js-temporal/polyfill';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { container } from '@/app/_lib/container';
import { longDateLabel } from '@/app/_lib/format';
import { serviceIdsFrom } from '@/app/_lib/service-ids';
import { availabilityResponse, serviceDto } from '@/app/api/_lib/serializers';
import { BookingForm } from '@/components/booking-form';
import { DayRangePicker } from '@/components/day-range-picker';
import { ServicePicker } from '@/components/service-picker';
import { ServiceSummary } from '@/components/service-summary';
import { SlotList } from '@/components/slot-list';
import { formatLocalTime, localDateOf } from '@/domain/shared/time';
import { messages } from '@/messages/es-ES';

export const dynamic = 'force-dynamic';

/**
 * The data screen (Historia 2).
 *
 * Before the three fields it restates what is being booked — each service,
 * day, hour, total duration, total price and the cancellation deadline —
 * because FR-010 asks the client to see all of it before committing, not after.
 *
 * On desktop the same screen also keeps the services, the days and the hours
 * in view, so the client never leaves the booking view (003, FR-007, FR-008).
 * They are drawn always and hidden below 1024 px, which leaves the phone
 * exactly as it was (FR-002).
 *
 * Changing the services here keeps the hour only while the domain still
 * offers it for the new selection; otherwise the client goes back to that
 * day's hours, told why (005, FR-011, D-005).
 */

/** Its own title, so the route announcer says where the client has arrived (D-007). */
export function generateMetadata(): Metadata {
  return { title: messages.booking.pageTitle };
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Set by the service picker of this screen, and only by it. */
const SERVICES_CHANGED = 'cambioServicios';

function shiftRange(from: string, days: number): string {
  return Temporal.PlainDate.from(from).add({ days }).toString();
}

export default async function BookingDetailsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const startsAt = first(params, 'startsAt');

  let start: Temporal.Instant | null = null;
  try {
    start = startsAt === undefined ? null : Temporal.Instant.from(startsAt);
  } catch {
    start = null;
  }

  const { listServices, getAvailability, config } = container();
  // The deadline and the timezone are domain parameters, read from the
  // configuration and never restated in the interface (Principio I). It is
  // cached after the first read, so awaiting it first costs nothing.
  const { salon, policy } = await config.load();
  const catalogue = await listServices();
  const services = catalogue.services.map(serviceDto);
  const serviceIds = serviceIdsFrom(first(params, 'serviceIds'), services);

  // The day of the chosen hour on the salon's clock, never the device's.
  const startDate = start === null ? undefined : localDateOf(start, salon.timezone).toString();

  // One availability query: the summary, the days and the hours all come from it (D-008).
  const requested =
    serviceIds.length === 0 || startDate === undefined
      ? null
      : await getAvailability({
          serviceIds,
          rangeStart: first(params, 'rangeStart') ?? startDate,
          selectedDate: first(params, 'selectedDate') ?? startDate,
        });

  // A malformed or out-of-range day falls back to the range that starts on the
  // chosen hour's day, as `/` does: never an error page for these two.
  const result =
    requested === null || requested.ok
      ? requested
      : await getAvailability({ serviceIds, rangeStart: startDate, selectedDate: startDate });
  const availability = result?.ok ? availabilityResponse(result.value) : null;

  if (first(params, SERVICES_CHANGED) === '1' && start !== null && startDate !== undefined) {
    // D-005: whether the hour survives the new selection is the domain's
    // answer — it is still among the hours it offers that day, or it is not.
    const chosen = start.toString();
    const stillOffered = availability?.slots.some((slot) => slot.startsAt === chosen) ?? false;
    const rangeStart = availability?.range.start ?? startDate;

    if (!stillOffered) {
      redirect(
        `/?${new URLSearchParams({
          serviceIds: serviceIds.join(','),
          rangeStart,
          selectedDate: startDate,
          horaQuitada: '1',
        }).toString()}`,
      );
    }

    // The hour stays. The flag goes, so that a later refresh of this screen —
    // after a slot taken at confirmation, say — is not read as a new change.
    redirect(
      `/reservar?${new URLSearchParams({
        serviceIds: serviceIds.join(','),
        startsAt: chosen,
        rangeStart,
        selectedDate: startDate,
      }).toString()}`,
    );
  }

  if (availability === null || start === null) {
    // Reached without a slot: nothing to confirm, so the way back is offered
    // instead of an empty form.
    return (
      <main>
        <h1>{messages.booking.title}</h1>
        <div className="notice-error">
          <p>{messages.booking.missingSlot.message}</p>
          <p>{messages.booking.missingSlot.nextAction}</p>
        </div>
        <Link className="button" href="/">
          {messages.common.back}
        </Link>
      </main>
    );
  }

  const date = localDateOf(start, salon.timezone);
  const endsAt = start.add({ minutes: availability.durationMinutes });

  return (
    <>
      <header className="site-header site-header--split">
        <p>
          {salon.name} · {salon.address}
        </p>
      </header>

      <main className="page--split">
        <h1>{messages.booking.title}</h1>

        <div className="col-main wide-only">
          <ServicePicker
            services={services}
            selectedIds={availability.serviceIds}
            totalDurationMinutes={availability.durationMinutes}
            action="/reservar"
            keep={{
              startsAt: start.toString(),
              rangeStart: availability.range.start,
              selectedDate: date.toString(),
              [SERVICES_CHANGED]: '1',
            }}
          />
          <DayRangePicker
            availability={availability}
            serviceIds={availability.serviceIds}
            previousRangeStart={shiftRange(availability.range.start, -availability.days.length)}
            nextRangeStart={shiftRange(availability.range.end, 1)}
          />
        </div>

        <div className="col-side">
          <div className="wide-only">
            <SlotList
              availability={availability}
              serviceIds={availability.serviceIds}
              selectedStartsAt={start.toString()}
              live={false}
            />
          </div>

          {/* Changing the hour on desktop is announced here, once (D-007). */}
          <section aria-labelledby="summary-heading" className="card" aria-live="polite">
            <h2 id="summary-heading">{messages.booking.summaryTitle}</h2>

            <dl className="summary">
              <ServiceSummary
                services={availability.services}
                durationMinutes={availability.durationMinutes}
                price={availability.price}
              >
                <dt>{messages.booking.summaryDate}</dt>
                <dd>{longDateLabel(date.toString())}</dd>

                <dt>{messages.booking.summaryTime}</dt>
                <dd>
                  {formatLocalTime(start, salon.timezone)} –{' '}
                  {formatLocalTime(endsAt, salon.timezone)}
                </dd>
              </ServiceSummary>

              {/* FR-010: the deadline is shown before confirming, not after. */}
              <dt>{messages.booking.summaryCancellationPolicy}</dt>
              <dd>{messages.booking.cancellationPolicyValue(policy.cancellationDeadlineHours)}</dd>
            </dl>

            <p className="muted">{messages.common.timezoneNotice}</p>
          </section>

          <section aria-labelledby="form-heading">
            <h2 id="form-heading">{messages.booking.formTitle}</h2>
            <BookingForm serviceIds={availability.serviceIds} startsAt={start.toString()} />
          </section>

          <p>
            {/* A button-sized target: WCAG 2.2 AA asks for one, and a bare link
                at the foot of a form is the easiest one to miss on a phone. */}
            <Link
              className="button-secondary"
              href={`/?${new URLSearchParams({
                serviceIds: availability.serviceIds.join(','),
                selectedDate: date.toString(),
              }).toString()}`}
            >
              {messages.common.back}
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
