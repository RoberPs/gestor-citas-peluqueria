import { Temporal } from '@js-temporal/polyfill';
import Link from 'next/link';
import { container } from '@/app/_lib/container';
import { durationLabel, longDateLabel, priceLabel } from '@/app/_lib/format';
import { BookingForm } from '@/components/booking-form';
import { formatLocalTime, localDateOf } from '@/domain/shared/time';
import { messages } from '@/messages/es-ES';

export const dynamic = 'force-dynamic';

/**
 * The data screen (Historia 2).
 *
 * Before the three fields it restates what is being booked — service, day,
 * hour, duration and the cancellation deadline — because FR-010 asks the client
 * to see all of it before committing, not after.
 */

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function BookingDetailsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const serviceId = first(params, 'serviceId');
  const startsAt = first(params, 'startsAt');

  const { salon, services } = await container().listServices();
  const service = services.find((candidate) => candidate.id === serviceId);
  // The deadline is a domain parameter, read from the configuration and never
  // restated in the interface (Principio I).
  const { policy } = await container().config.load();

  let start: Temporal.Instant | null = null;
  try {
    start = startsAt === undefined ? null : Temporal.Instant.from(startsAt);
  } catch {
    start = null;
  }

  if (service === undefined || start === null || serviceId === undefined) {
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
      <header className="site-header">
        <p>
          {salon.name} · {salon.address}
        </p>
      </header>

      <main>
        <h1>{messages.booking.title}</h1>

        <section aria-labelledby="summary-heading" className="card">
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
          <BookingForm serviceId={serviceId} startsAt={start.toString()} />
        </section>

        <p>
          {/* A button-sized target: WCAG 2.2 AA asks for one, and a bare link
              at the foot of a form is the easiest one to miss on a phone. */}
          <Link
            className="button-secondary"
            href={`/?serviceId=${serviceId}&selectedDate=${date.toString()}`}
          >
            {messages.common.back}
          </Link>
        </p>
      </main>
    </>
  );
}
