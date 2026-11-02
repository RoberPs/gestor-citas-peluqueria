import { Temporal } from '@js-temporal/polyfill';
import { container } from '@/app/_lib/container';
import { availabilityResponse, serviceDto } from '@/app/api/_lib/serializers';
import { DayRangePicker } from '@/components/day-range-picker';
import { ServicePicker } from '@/components/service-picker';
import { SlotList } from '@/components/slot-list';
import { messages } from '@/messages/es-ES';

export const dynamic = 'force-dynamic';

/**
 * The booking screen (Historia 1).
 *
 * Rendered on the server with the availability already computed, so the first
 * paint on a phone does not wait for a JavaScript bundle (SC-004). Navigation
 * is GET forms: choosing a service, a day or a range works with no client
 * JavaScript at all, and the chosen service survives every step (escenario 7).
 */

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function shiftRange(from: string, days: number): string {
  return Temporal.PlainDate.from(from).add({ days }).toString();
}

export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { listServices, getAvailability } = container();

  const catalogue = await listServices();
  const services = catalogue.services.map(serviceDto);
  const fallbackService = services[0];

  if (fallbackService === undefined) {
    // No catalogue means the configuration was never loaded (FR-007).
    return (
      <main>
        <h1>{messages.availability.title}</h1>
        <p className="notice-error">{messages.errors.unknownService.message}</p>
      </main>
    );
  }

  const requestedServiceId = first(params, 'serviceId');
  const serviceId =
    services.find((service) => service.id === requestedServiceId)?.id ?? fallbackService.id;

  const requested = await getAvailability({
    serviceId,
    rangeStart: first(params, 'rangeStart'),
    selectedDate: first(params, 'selectedDate'),
  });

  // Out-of-bounds dates fall back to the default range rather than dead-ending
  // the client on an error page.
  const result = requested.ok ? requested : await getAvailability({ serviceId });

  if (!result.ok) {
    return (
      <main>
        <h1>{messages.availability.title}</h1>
        <div className="notice-error">
          <p>{messages.errors.rangeOutOfBounds.message}</p>
          <p>{messages.errors.rangeOutOfBounds.nextAction}</p>
        </div>
      </main>
    );
  }

  const availability = availabilityResponse(result.value);
  const rangeLength = availability.days.length;

  return (
    <>
      <header className="site-header site-header--split">
        <p>
          {catalogue.salon.name} · {catalogue.salon.address}
        </p>
      </header>

      {/* On desktop, service and days on the left and the hours on the right
          (003, FR-007); below 1024 px, one column in this same order. */}
      <main className="page--split">
        <h1>{messages.availability.title}</h1>

        {!requested.ok && (
          <div className="notice-warning">
            <p>{messages.errors.rangeOutOfBounds.message}</p>
            <p>{messages.errors.rangeOutOfBounds.nextAction}</p>
          </div>
        )}

        <div className="col-main">
          <ServicePicker services={services} selectedServiceId={serviceId} />

          <DayRangePicker
            availability={availability}
            serviceId={serviceId}
            previousRangeStart={shiftRange(availability.range.start, -rangeLength)}
            nextRangeStart={shiftRange(availability.range.end, 1)}
          />
        </div>

        <div className="col-side">
          <SlotList availability={availability} serviceId={serviceId} />
          <p className="muted wide-only">{messages.availability.chooseHourHint}</p>
        </div>
      </main>
    </>
  );
}
