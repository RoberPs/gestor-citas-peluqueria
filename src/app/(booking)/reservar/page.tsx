import { Temporal } from '@js-temporal/polyfill';
import type { Metadata } from 'next';
import Link from 'next/link';
import { container } from '@/app/_lib/container';
import { durationLabel, longDateLabel, priceLabel } from '@/app/_lib/format';
import { availabilityResponse, serviceDto } from '@/app/api/_lib/serializers';
import { BookingForm } from '@/components/booking-form';
import { DayRangePicker } from '@/components/day-range-picker';
import { ServicePicker } from '@/components/service-picker';
import { SlotList } from '@/components/slot-list';
import { formatLocalTime, localDateOf } from '@/domain/shared/time';
import { messages } from '@/messages/es-ES';

export const dynamic = 'force-dynamic';

/**
 * The data screen (Historia 2).
 *
 * Before the three fields it restates what is being booked — service, day,
 * hour, duration and the cancellation deadline — because FR-010 asks the client
 * to see all of it before committing, not after.
 *
 * On desktop the same screen also keeps the service, the days and the hours in
 * view, so the client never leaves the booking view (003, FR-007, FR-008).
 * They are drawn always and hidden below 1024 px, which leaves the phone
 * exactly as it was (FR-002).
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

function shiftRange(from: string, days: number): string {
  return Temporal.PlainDate.from(from).add({ days }).toString();
}

export default async function BookingDetailsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const serviceIds = first(params, 'serviceIds')?.split(',') ?? [];
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

  // The day of the chosen hour on the salon's clock, never the device's.
  const startDate = start === null ? undefined : localDateOf(start, salon.timezone).toString();

  // One availability query, in parallel with the catalogue (D-008).
  const [catalogue, requested] = await Promise.all([
    listServices(),
    serviceIds.length === 0 || startDate === undefined
      ? null
      : getAvailability({
          serviceIds,
          rangeStart: first(params, 'rangeStart') ?? startDate,
          selectedDate: first(params, 'selectedDate') ?? startDate,
        }),
  ]);
  const service = catalogue.services.find((candidate) => candidate.id === serviceIds[0]);

  // A malformed or out-of-range day falls back to the range that starts on the
  // chosen hour's day, as `/` does: never an error page for these two.
  const result =
    requested === null || requested.ok
      ? requested
      : await getAvailability({ serviceIds, rangeStart: startDate, selectedDate: startDate });
  const availability = result?.ok ? availabilityResponse(result.value) : null;

  if (service === undefined || start === null) {
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
  const endsAt = start.add({ minutes: service.durationMinutes });

  return (
    <>
      <header className="site-header site-header--split">
        <p>
          {salon.name} · {salon.address}
        </p>
      </header>

      <main className="page--split">
        <h1>{messages.booking.title}</h1>

        {availability !== null && (
          <div className="col-main wide-only">
            <ServicePicker
              services={catalogue.services.map(serviceDto)}
              selectedServiceId={service.id}
            />
            <DayRangePicker
              availability={availability}
              serviceIds={serviceIds}
              previousRangeStart={shiftRange(availability.range.start, -availability.days.length)}
              nextRangeStart={shiftRange(availability.range.end, 1)}
            />
          </div>
        )}

        <div className="col-side">
          {availability !== null && (
            <div className="wide-only">
              <SlotList
                availability={availability}
                serviceIds={serviceIds}
                selectedStartsAt={start.toString()}
                live={false}
              />
            </div>
          )}

          {/* Changing the hour on desktop is announced here, once (D-007). */}
          <section aria-labelledby="summary-heading" className="card" aria-live="polite">
            <h2 id="summary-heading">{messages.booking.summaryTitle}</h2>

            <dl className="summary">
              <dt>{messages.booking.summaryService}</dt>
              <dd>{service.name}</dd>

              <dt>{messages.booking.summaryDate}</dt>
              <dd>{longDateLabel(date.toString())}</dd>

              <dt>{messages.booking.summaryTime}</dt>
              <dd>
                {formatLocalTime(start, salon.timezone)} – {formatLocalTime(endsAt, salon.timezone)}
              </dd>

              <dt>{messages.booking.summaryDuration}</dt>
              <dd>{durationLabel(service.durationMinutes)}</dd>

              <dt>{messages.booking.summaryPrice}</dt>
              <dd>{priceLabel(service.priceCents)}</dd>

              {/* FR-010: the deadline is shown before confirming, not after. */}
              <dt>{messages.booking.summaryCancellationPolicy}</dt>
              <dd>{messages.booking.cancellationPolicyValue(policy.cancellationDeadlineHours)}</dd>
            </dl>

            <p className="muted">{messages.common.timezoneNotice}</p>
          </section>

          <section aria-labelledby="form-heading">
            <h2 id="form-heading">{messages.booking.formTitle}</h2>
            <BookingForm serviceIds={serviceIds} startsAt={start.toString()} />
          </section>

          <p>
            {/* A button-sized target: WCAG 2.2 AA asks for one, and a bare link
                at the foot of a form is the easiest one to miss on a phone. */}
            <Link
              className="button-secondary"
              href={`/?serviceIds=${serviceIds.join(',')}&selectedDate=${date.toString()}`}
            >
              {messages.common.back}
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
