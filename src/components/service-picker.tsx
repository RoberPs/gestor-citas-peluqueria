import { durationLabel } from '@/app/_lib/format';
import type { ServiceDto } from '@/app/api/_lib/serializers';
import { NavForm } from '@/components/nav-form';
import { messages } from '@/messages/es-ES';

/**
 * The catalogue, as a selection of one or more services (FR-001, 005 D-004).
 * Presentation only: it decides nothing.
 *
 * Each service is a submit button of a GET form whose value is the selection
 * that **results** from pressing it: the current one with that service added or
 * removed. Reloading the page therefore repeats a selection rather than
 * toggling it again, and with no JavaScript at all every press is a plain step
 * in the history. Whether the selection is valid is the server's call, through
 * the domain; this only lists the ids in the order the catalogue shows them.
 *
 * With JavaScript, `NavForm` makes each press a client navigation that keeps
 * what was typed in the form (003, D-003).
 */
export function ServicePicker({
  services,
  selectedIds,
  totalDurationMinutes,
  action = '/',
  keep = {},
}: {
  /** In catalogue order. */
  readonly services: readonly ServiceDto[];
  readonly selectedIds: readonly string[];
  /** The domain's total for the selection; `null` while nothing is chosen. */
  readonly totalDurationMinutes: number | null;
  /** The screen the choice navigates within. */
  readonly action?: string;
  /** What else in the URL survives a change of selection: the day, the hour. */
  readonly keep?: Readonly<Record<string, string | undefined>>;
}) {
  const selected = services.filter((service) => selectedIds.includes(service.id));

  return (
    <section aria-labelledby="service-heading">
      <h2 id="service-heading">{messages.availability.serviceSectionTitle}</h2>
      <p className="muted">{messages.availability.serviceSectionHint}</p>

      <NavForm action={action} className="service-list">
        {Object.entries(keep).map(([name, value]) =>
          value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />,
        )}

        {services.map((service) => {
          const isSelected = selectedIds.includes(service.id);
          const resulting = services
            .filter((candidate) =>
              candidate.id === service.id ? !isSelected : selectedIds.includes(candidate.id),
            )
            .map((candidate) => candidate.id)
            .join(',');

          return (
            <button
              key={service.id}
              type="submit"
              name="serviceIds"
              value={resulting}
              className={isSelected ? 'service-option is-selected' : 'service-option'}
              aria-pressed={isSelected}
            >
              <span className="service-name">{service.name}</span>
              <span className="service-meta">
                {durationLabel(service.durationMinutes)} · {service.priceLabel}
              </span>
              {/* Said in words and a mark, never by colour alone (FR-023). A
                  screen reader already hears it through aria-pressed. */}
              {isSelected && (
                <span className="service-badge" aria-hidden="true">
                  ✓ {messages.availability.selectedServiceMark}
                </span>
              )}
            </button>
          );
        })}
      </NavForm>

      {/* Always on screen, and announced without moving the focus (FR-005, FR-023). */}
      <div className="selection-summary" aria-live="polite">
        {totalDurationMinutes === null || selected.length === 0 ? (
          <p>{messages.availability.emptySelection}</p>
        ) : (
          <>
            <p>
              {messages.availability.selectedServicesLabel}:{' '}
              <strong>{selected.map((service) => service.name).join(', ')}</strong>
            </p>
            <p>
              {messages.availability.totalDurationLabel}:{' '}
              <strong>{durationLabel(totalDurationMinutes)}</strong>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
