import { longDateLabel } from '@/app/_lib/format';
import type { AvailabilityDto } from '@/app/api/_lib/serializers';
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
}: {
  readonly availability: AvailabilityDto;
  readonly serviceId: string;
  /** Where a chosen hour goes. */
  readonly action?: string;
  /** Where the jump to the next free day goes. */
  readonly browseAction?: string;
}) {
  const { slots, selectedDate, nextAvailableDate, days } = availability;
  const selectedDay = days.find((day) => day.date === selectedDate);
  const isClosed = selectedDay?.status === 'CLOSED';

  return (
    <section aria-labelledby="slot-heading">
      <h2 id="slot-heading">{messages.availability.slotSectionTitle}</h2>
      <p className="muted">{longDateLabel(selectedDate)}</p>

      {/* Announced without moving the focus when the day changes (D-014). */}
      <div aria-live="polite" aria-atomic="true">
        {slots.length > 0 ? (
          <>
            <p className="visually-hidden">{messages.availability.slotCountSummary(slots.length)}</p>

            <form method="get" action={action}>
              <input type="hidden" name="serviceId" value={serviceId} />

              <ul className="slot-list" aria-label={messages.availability.slotsLabel}>
                {slots.map((slot) => (
                  <li key={slot.startsAt}>
                    <button
                      type="submit"
                      name="startsAt"
                      value={slot.startsAt}
                      className={
                        slot.isCurrentAppointment ? 'slot is-current-appointment' : 'slot'
                      }
                    >
                      <span aria-hidden="true">{slot.localTime}</span>
                      <span className="visually-hidden">
                        {slot.localTime} a {slot.endsLocalTime}
                        {slot.isCurrentAppointment ? `. ${messages.reschedule.currentSlot}` : ''}
                      </span>
                      {slot.isCurrentAppointment && (
                        <span className="slot-badge">{messages.reschedule.currentSlot}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </form>
          </>
        ) : (
          <div className="notice-warning">
            <p>
              {isClosed ? messages.availability.dayClosed : messages.availability.noSlotsToday}
            </p>

            {nextAvailableDate === null ? (
              <p>{messages.availability.noneInHorizon}</p>
            ) : (
              <form method="get" action={browseAction}>
                <input type="hidden" name="serviceId" value={serviceId} />
                <input type="hidden" name="selectedDate" value={nextAvailableDate} />
                <button type="submit" name="rangeStart" value={nextAvailableDate} className="button">
                  {messages.availability.jumpToNext(longDateLabel(nextAvailableDate))}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <p className="muted">{messages.common.timezoneNotice}</p>
    </section>
  );
}
