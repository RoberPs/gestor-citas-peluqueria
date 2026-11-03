import type { AgendaDayDto } from '@/app/api/gestion/_lib/serializers';
import { ServiceSummary } from '@/components/service-summary';
import { messages } from '@/messages/es-ES';

/**
 * The owner's day (002, Historia 2), as an ordered LIST and not an absolutely
 * positioned grid: it reads in order with a screen reader and is walked with
 * the keyboard (Principio VII). Every state — origin, cancelled, who
 * cancelled, past — is said in words, with an icon beside it, never by colour
 * alone (FR-013, FR-058).
 *
 * Presentation only: what it shows arrives decided (`agendaDayDto`).
 */

type Entry = AgendaDayDto['entries'][number];
type AppointmentEntry = Extract<Entry, { kind: 'APPOINTMENT' }>['appointment'];
type Moment = { readonly localTime: string; readonly localDate: string };

function span(date: string, startsAt: Moment, endsAt: Moment): string {
  // A period that began another day says so; within the day, the hours are enough.
  const from = startsAt.localDate === date ? startsAt.localTime : `${startsAt.localDate} ${startsAt.localTime}`;
  const to = endsAt.localDate === date ? endsAt.localTime : `${endsAt.localDate} ${endsAt.localTime}`;
  return `${from}–${to}`;
}

function AppointmentCard({ appointment, date }: { readonly appointment: AppointmentEntry; readonly date: string }) {
  const origin = messages.owner.origin[appointment.origin];
  const cancelled = appointment.status === 'CANCELLED';

  return (
    <article className="card timeline-appointment" aria-label={span(date, appointment.startsAt, appointment.endsAt)}>
      <p className="timeline-time">{span(date, appointment.startsAt, appointment.endsAt)}</p>
      <ul className="timeline-tags">
        <li>
          <span aria-hidden="true">{origin.icon}</span> {origin.label}
        </li>
        {cancelled && (
          <li className="status status-cancelled">
            <span aria-hidden="true">{messages.appointment.status.CANCELLED.icon}</span>{' '}
            {appointment.cancelledBy === null
              ? messages.appointment.status.CANCELLED.label
              : messages.owner.cancelledBy[appointment.cancelledBy]}
          </li>
        )}
        {!cancelled && appointment.isPast && <li>{messages.owner.agenda.past}</li>}
      </ul>

      {appointment.customer === null ? (
        <p className="muted">{messages.owner.agenda.anonymized}</p>
      ) : (
        <p className="timeline-customer">
          <strong>{appointment.customer.name}</strong>
          <br />
          {messages.owner.agenda.phone}:{' '}
          <a className="touch-link" href={`tel:${appointment.customer.phone.replace(/[\s.-]/g, '')}`}>
            {appointment.customer.phone}
          </a>
        </p>
      )}

      <dl className="summary">
        <ServiceSummary
          services={appointment.services.map((service, index) => ({ ...service, id: String(index) }))}
          durationMinutes={appointment.durationMinutes}
          price={appointment.price}
        />
      </dl>
    </article>
  );
}

export function Timeline({ day }: { readonly day: AgendaDayDto }) {
  const hasAppointments = day.entries.some((entry) => entry.kind === 'APPOINTMENT');

  return (
    <>
      {day.isReadOnly && (
        <p className="notice" role="note">
          {messages.owner.agenda.readOnly}
        </p>
      )}
      {!hasAppointments && (
        <p className="notice">{day.isClosed ? messages.owner.agenda.closed : messages.owner.agenda.noAppointments}</p>
      )}

      {day.entries.length > 0 && (
        <ol className="timeline">
          {day.entries.map((entry) => {
            switch (entry.kind) {
              case 'APPOINTMENT':
                return (
                  <li key={`a-${entry.appointment.id}`}>
                    <AppointmentCard appointment={entry.appointment} date={day.date} />
                  </li>
                );
              case 'UNAVAILABLE':
                return (
                  <li key={`p-${entry.period.id}`} className="timeline-unavailable">
                    <span className="timeline-time">{span(day.date, entry.period.startsAt, entry.period.endsAt)}</span>{' '}
                    <span aria-hidden="true">⊘</span> {messages.owner.agenda.unavailable}
                    {entry.period.reason !== null && ` · ${entry.period.reason}`}
                  </li>
                );
              case 'FREE':
                return (
                  <li key={`f-${entry.startsAt.instant}`} className="timeline-free">
                    <span className="timeline-time">{span(day.date, entry.startsAt, entry.endsAt)}</span>{' '}
                    {messages.owner.agenda.free}
                  </li>
                );
            }
          })}
        </ol>
      )}
    </>
  );
}
