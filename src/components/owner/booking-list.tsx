import { longDateLabel } from '@/app/_lib/format';
import type { OwnerAppointmentDto } from '@/app/api/gestion/_lib/serializers';
import { ServiceSummary } from '@/components/service-summary';
import { messages } from '@/messages/es-ES';

/**
 * The rows of the bookings list (002, Historia 10, FR-060, FR-063). One card
 * per appointment, in the order the domain gave. State, origin and who
 * cancelled are words beside an icon, never colour alone; the secondary
 * columns — origin and when it was booked — only on a desktop (D-034).
 * Each row leads to that day of the agenda (FR-065).
 */

const T = messages.owner.bookings;

function StatusLine({ row }: { readonly row: OwnerAppointmentDto }) {
  if (row.status === 'CONFIRMED') {
    return (
      <span className="status status-confirmed">
        <span aria-hidden="true">{messages.appointment.status.CONFIRMED.icon}</span> {T.confirmed}
      </span>
    );
  }

  return (
    <span className="status status-cancelled">
      <span aria-hidden="true">{messages.appointment.status.CANCELLED.icon}</span>{' '}
      {row.cancelledBy === null ? messages.appointment.status.CANCELLED.label : messages.owner.cancelledBy[row.cancelledBy]}
      {row.cancelledAt !== null && ` ${T.cancelledOn} ${longDateLabel(row.cancelledAt.localDate)}`}
    </span>
  );
}

export function BookingList({ rows }: { readonly rows: readonly OwnerAppointmentDto[] }) {
  return (
    <ol className="booking-list" aria-label={T.results}>
      {rows.map((row) => {
        const origin = messages.owner.origin[row.origin];
        return (
          <li key={row.id} className="card">
            <p className="timeline-time">
              {longDateLabel(row.startsAt.localDate)}, {row.startsAt.localTime}–{row.endsAt.localTime}
            </p>
            <p>
              <StatusLine row={row} />
            </p>

            {row.customer === null ? (
              <p className="muted">{messages.owner.agenda.anonymized}</p>
            ) : (
              <p>
                <strong>{row.customer.name}</strong>
                <br />
                {messages.owner.agenda.phone}:{' '}
                <a className="touch-link" href={`tel:${row.customer.phone.replace(/[\s.-]/g, '')}`}>
                  {row.customer.phone}
                </a>
              </p>
            )}

            <dl className="summary">
              <ServiceSummary
                services={row.services.map((service, index) => ({ ...service, id: String(index) }))}
                durationMinutes={row.durationMinutes}
                price={row.price}
              />
            </dl>

            <p className="wide-only muted">
              <span aria-hidden="true">{origin.icon}</span> {origin.label} · {T.bookedAt}{' '}
              {longDateLabel(row.createdAt.localDate)}, {row.createdAt.localTime}
            </p>

            <p>
              <a className="touch-link" href={`/gestion/agenda?fecha=${row.startsAt.localDate}`}>
                {T.goToAgenda}
              </a>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
