import { monthLabel } from '@/app/_lib/format';
import type { AvailabilityDto } from '@/app/api/_lib/serializers';
import { NavForm } from '@/components/nav-form';
import { messages } from '@/messages/es-ES';

/**
 * The 14 day grid (D-014).
 *
 * Every day states itself three ways at once — visible text, a shape, and
 * colour — because with three states in a compact grid the temptation to solve
 * it with colour alone is exactly what SC-010 forbids.
 *
 * Closed and full days are `aria-disabled` but stay focusable, so somebody
 * moving through the grid by keyboard learns that the day exists and why it
 * cannot be chosen, instead of finding a hole in the tab order.
 */

type Day = AvailabilityDto['days'][number];

const STATUS = {
  AVAILABLE: messages.availability.status.available,
  FULL: messages.availability.status.full,
  CLOSED: messages.availability.status.closed,
} as const;

export function DayRangePicker({
  availability,
  serviceIds,
  previousRangeStart,
  nextRangeStart,
  action = '/',
}: {
  readonly availability: AvailabilityDto;
  /** The selection in view, carried by every choice made here (005, D-004). */
  readonly serviceIds: readonly string[];
  readonly previousRangeStart: string;
  readonly nextRangeStart: string;
  /** The screen the grid navigates within. Rescheduling reuses it on its own. */
  readonly action?: string;
}) {
  const { days, range, selectedDate } = availability;

  return (
    <section aria-labelledby="day-heading">
      <h2 id="day-heading">{messages.availability.daySectionTitle}</h2>

      <NavForm action={action}>
        <input type="hidden" name="serviceIds" value={serviceIds.join(',')} />
        <input type="hidden" name="rangeStart" value={range.start} />

        <ul className="day-grid" aria-label={messages.availability.dayGridLabel}>
          {days.map((day) => (
            <li key={day.date}>
              <DayCell day={day} isSelected={day.date === selectedDate} />
            </li>
          ))}
        </ul>
      </NavForm>

      <NavForm action={action} className="range-nav">
        <input type="hidden" name="serviceIds" value={serviceIds.join(',')} />

        <button
          type="submit"
          name="rangeStart"
          value={previousRangeStart}
          className="button-secondary"
          disabled={!range.canGoBack}
        >
          ← {messages.availability.previousRange}
        </button>

        <button
          type="submit"
          name="rangeStart"
          value={nextRangeStart}
          className="button-secondary"
          disabled={!range.canGoForward}
        >
          {messages.availability.nextRange} →
        </button>
      </NavForm>

      {!range.canGoBack && <p className="muted">{messages.availability.cannotGoBack}</p>}
      {!range.canGoForward && <p className="muted">{messages.availability.cannotGoForward}</p>}
    </section>
  );
}

function DayCell({ day, isSelected }: { readonly day: Day; readonly isSelected: boolean }) {
  const status = STATUS[day.status as keyof typeof STATUS];
  const selectable = day.status === 'AVAILABLE';

  const accessibleName = messages.availability.dayAccessibleName({
    weekday: day.weekdayLabel,
    day: day.dayLabel,
    month: monthLabel(day.date),
    status: status.label,
    slotCount: day.slotCount,
  });

  const className = [
    'day-cell',
    `is-${day.status.toLowerCase()}`,
    isSelected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="day-weekday">{day.weekdayLabel}</span>
      <span className="day-number">{day.dayLabel}</span>
      <span className="day-icon" aria-hidden="true">
        {status.icon}
      </span>
      <span className="visually-hidden">{status.label}</span>
    </>
  );

  // A closed or full day stays in the tab order and says why, rather than
  // disappearing from it.
  if (!selectable) {
    return (
      <button type="button" className={className} aria-disabled="true" aria-label={accessibleName}>
        {content}
      </button>
    );
  }

  return (
    <button
      type="submit"
      name="selectedDate"
      value={day.date}
      className={className}
      aria-label={accessibleName}
      {...(isSelected ? { 'aria-current': 'date' as const } : {})}
    >
      {content}
    </button>
  );
}
