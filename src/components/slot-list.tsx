import { longDateLabel } from '@/app/_lib/format';
import type { AvailabilityDto } from '@/app/api/_lib/serializers';
import { NavForm } from '@/components/nav-form';
import { messages } from '@/messages/es-ES';

/**
 * The hours of the selected day (FR-005a).
 *
 * Every hour shown is bookable at the moment it is shown, because the same
 * domain code that produced it is the one that later authorises the booking
 * (SC-003). When the day has none, the way out of the dead end is offered right
 * here rather than left to the client to find (FR-006).
 */
export function SlotList({
  availability,
  serviceId,
  action = '/reservar',
  browseAction = '/',
  selectedStartsAt,
  live = true,
}: {
  readonly availability: AvailabilityDto;
  readonly serviceId: string;
  /** Where a chosen hour goes. */
  readonly action?: string;
  /** Where the jump to the next free day goes. */
  readonly browseAction?: string;
  /** The hour already chosen, marked as such on screens that keep the list in view. */
  readonly selectedStartsAt?: string;
  /**
   * Whether the list announces its changes. Off where another region already
   * announces them, so nothing is read out twice (003, D-007).
   */
  readonly live?: boolean;
}) {
  const { slots, selectedDate, nextAvailableDate, days } = availability;
  const selectedDay = days.find((day) => day.date === selectedDate);
  const isClosed = selectedDay?.status === 'CLOSED';

  return (
    <section aria-labelledby="slot-heading">
      <h2 id="slot-heading">{messages.availability.slotSectionTitle}</h2>
      {/* Announced without moving the focus when the day changes (D-014), the
          day itself included, so the announcement says which day it is. */}
      <div {...(live ? { 'aria-live': 'polite' as const, 'aria-atomic': true } : {})}>
        <p className="muted">{longDateLabel(selectedDate)}</p>

        {slots.length > 0 ? (
          <>
            <p className="visually-hidden">{messages.availability.slotCountSummary(slots.length)}</p>

            <NavForm action={action}>
              <input type="hidden" name="serviceId" value={serviceId} />
              {/* The range and day in view travel with the hour, so a screen
                  that keeps them on display knows which ones to draw. */}
              <input type="hidden" name="rangeStart" value={availability.range.start} />
              <input type="hidden" name="selectedDate" value={selectedDate} />

              <ul className="slot-list" aria-label={messages.availability.slotsLabel}>
                {slots.map((slot) => {
                  const isSelected = slot.startsAt === selectedStartsAt;
                  const className = [
                    'slot',
                    slot.isCurrentAppointment ? 'is-current-appointment' : '',
                    isSelected ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <li key={slot.startsAt}>
                      <button
                        type="submit"
                        name="startsAt"
                        value={slot.startsAt}
                        className={className}
                        {...(selectedStartsAt === undefined ? {} : { 'aria-pressed': isSelected })}
                      >
                        <span aria-hidden="true">{slot.localTime}</span>
                        <span className="visually-hidden">
                          {slot.localTime} a {slot.endsLocalTime}
                          {slot.isCurrentAppointment ? `. ${messages.reschedule.currentSlot}` : ''}
                          {isSelected ? `. ${messages.availability.selectedSlot}` : ''}
                        </span>
                        {slot.isCurrentAppointment && (
                          <span className="slot-badge">{messages.reschedule.currentSlot}</span>
                        )}
                        {/* Chosen is shown in words and a mark, never by colour alone.
                            A screen reader already hears it in the hidden text above. */}
                        {isSelected && (
                          <span className="slot-badge" aria-hidden="true">
                            ✓ {messages.availability.selectedSlot}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </NavForm>
          </>
        ) : (
          <div className="notice-warning">
            <p>
              {isClosed ? messages.availability.dayClosed : messages.availability.noSlotsToday}
            </p>

            {nextAvailableDate === null ? (
              <p>{messages.availability.noneInHorizon}</p>
            ) : (
              <NavForm action={browseAction}>
                <input type="hidden" name="serviceId" value={serviceId} />
                <input type="hidden" name="selectedDate" value={nextAvailableDate} />
                <button type="submit" name="rangeStart" value={nextAvailableDate} className="button">
                  {messages.availability.jumpToNext(longDateLabel(nextAvailableDate))}
                </button>
              </NavForm>
            )}
          </div>
        )}
      </div>

      <p className="muted">{messages.common.timezoneNotice}</p>
    </section>
  );
}
