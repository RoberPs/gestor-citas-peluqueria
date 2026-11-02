import { durationLabel, priceLabel } from '@/app/_lib/format';
import type { ServiceDto } from '@/app/api/_lib/serializers';
import { messages } from '@/messages/es-ES';

/**
 * The catalogue (FR-001). Presentation only: it decides nothing.
 *
 * A plain GET form, so choosing a service works with no JavaScript at all and
 * the booking route keeps its budget (SC-004).
 */
export function ServicePicker({
  services,
  selectedServiceId,
}: {
  readonly services: readonly ServiceDto[];
  readonly selectedServiceId: string;
}) {
  return (
    <section aria-labelledby="service-heading">
      <h2 id="service-heading">{messages.availability.serviceSectionTitle}</h2>
      <p className="muted">{messages.availability.serviceSectionHint}</p>

      <form method="get" action="/" className="service-list">
        {services.map((service) => {
          const isSelected = service.id === selectedServiceId;

          return (
            <button
              key={service.id}
              type="submit"
              name="serviceId"
              value={service.id}
              className={isSelected ? 'service-option is-selected' : 'service-option'}
              aria-pressed={isSelected}
            >
              <span className="service-name">{service.name}</span>
              <span className="service-meta">
                {durationLabel(service.durationMinutes)} · {priceLabel(service.priceCents)}
              </span>
            </button>
          );
        })}
      </form>
    </section>
  );
}
