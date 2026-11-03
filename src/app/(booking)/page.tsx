import { Temporal } from '@js-temporal/polyfill';
import { container } from '@/app/_lib/container';
import { durationLabel } from '@/app/_lib/format';
import { serviceIdsFrom } from '@/app/_lib/service-ids';
import { availabilityResponse, serviceDto } from '@/app/api/_lib/serializers';
import { DayRangePicker } from '@/components/day-range-picker';
import { ServicePicker } from '@/components/service-picker';
import { SlotList } from '@/components/slot-list';
import { messages, withPhone } from '@/messages/es-ES';

export const dynamic = 'force-dynamic';

/**
 * The booking screen (Historia 1).
 *
 * Rendered on the server with the availability already computed, so the first
 * paint on a phone does not wait for a JavaScript bundle (SC-004). Navigation
 * is GET forms: choosing services, a day or a range works with no client
 * JavaScript at all, and the chosen services survive every step (escenario 7).
 *
 * The selection is one or more services (005). With none there are no days or
 * hours to show, only the request to choose one (FR-004); with one longer than
 * any opening stretch, the hours give way to why and what to do (FR-010).
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

  if (services.length === 0) {
    // No catalogue means the configuration was never loaded (FR-007).
    return (
      <main>
        <h1>{messages.availability.title}</h1>
        <p className="notice-error">{messages.errors.unknownService.message}</p>
      </main>
    );
  }

  const serviceIds = serviceIdsFrom(first(params, 'serviceIds'), services);
  const rangeStart = first(params, 'rangeStart');
  const selectedDate = first(params, 'selectedDate');
  // A change of services keeps the day the client was looking at (FR-009).
  const keep = { rangeStart, selectedDate };

  const requested =
    serviceIds.length === 0 ? null : await getAvailability({ serviceIds, rangeStart, selectedDate });

  // Out-of-bounds dates fall back to the default range rather than dead-ending
  // the client on an error page.
  const result =
    requested === null || requested.ok ? requested : await getAvailability({ serviceIds });

  if (result !== null && !result.ok) {
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

  const availability = result === null ? null : availabilityResponse(result.value);
  const hourRemoved = first(params, 'horaQuitada') === '1';

  return (
    <>
      <header className="site-header site-header--split">
        <p>
          {catalogue.salon.name} · {catalogue.salon.address}
        </p>
      </header>

      {/* On desktop, services and days on the left and the hours on the right
          (003, FR-007); below 1024 px, one column in this same order. */}
      <main className="page--split">
        <h1>{messages.availability.title}</h1>

        {requested !== null && !requested.ok && (
          <div className="notice-warning">
            <p>{messages.errors.rangeOutOfBounds.message}</p>
            <p>{messages.errors.rangeOutOfBounds.nextAction}</p>
          </div>
        )}

        <div className="col-main">
          {/* With nothing chosen, the picker itself asks for a service in place
              of the days and hours (FR-004). */}
          <ServicePicker
            services={services}
            selectedIds={availability?.serviceIds ?? []}
            totalDurationMinutes={availability?.durationMinutes ?? null}
            keep={keep}
          />

          {availability !== null && (
            <DayRangePicker
              availability={availability}
              serviceIds={availability.serviceIds}
              previousRangeStart={shiftRange(availability.range.start, -availability.days.length)}
              nextRangeStart={shiftRange(availability.range.end, 1)}
            />
          )}
        </div>

        <div className="col-side">
          {/* FR-011, D-005: the hour chosen on desktop no longer fit the new selection. */}
          {hourRemoved && (
            <div className="notice-warning" role="status">
              <p>{messages.availability.hourRemoved.message}</p>
              <p>{messages.availability.hourRemoved.nextAction}</p>
            </div>
          )}

          {availability !== null &&
            (availability.fitsOpeningHours ? (
              <>
                <SlotList availability={availability} serviceIds={availability.serviceIds} />
                <p className="muted wide-only">{messages.availability.chooseHourHint}</p>
              </>
            ) : (
              <div className="notice-warning">
                <p>
                  {messages.availability.selectionTooLong.message.replace(
                    '{duration}',
                    durationLabel(availability.durationMinutes),
                  )}
                </p>
                <p>
                  {withPhone(
                    messages.availability.selectionTooLong.nextAction,
                    catalogue.salon.phone,
                  )}
                </p>
              </div>
            ))}
        </div>
      </main>
    </>
  );
}
