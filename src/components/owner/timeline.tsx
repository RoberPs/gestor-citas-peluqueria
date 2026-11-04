import type { AgendaDayDto } from '@/app/api/gestion/_lib/serializers';
import { ConfirmationFailed } from '@/components/owner/confirmation-failed';
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

/**
 * Where each change of an appointment, or a new one, is opened (Historias 4,
 * 5 y 11). Absent on a day that is over. The links are plain addresses, so
 * the agenda works with no JavaScript.
 */
export type AppointmentLinks = {
  readonly newAt: (localTime: string) => string;
  readonly move: (id: string) => string;
  readonly edit: (id: string) => string;
  readonly cancel: (id: string) => string;
};

function AppointmentCard({
  appointment,
  date,
  links,
}: {
  readonly appointment: AppointmentEntry;
  readonly date: string;
  readonly links: AppointmentLinks | undefined;
}) {
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
      <ConfirmationFailed appointment={appointment} />

      <dl className="summary">
        <ServiceSummary
          services={appointment.services.map((service, index) => ({ ...service, id: String(index) }))}
          durationMinutes={appointment.durationMinutes}
          price={appointment.price}
        />
      </dl>

      {links !== undefined && !cancelled && !appointment.isPast && (
        <ul className="timeline-actions">
          {(
            [
              [links.move(appointment.id), messages.owner.appointments.move],
              [links.edit(appointment.id), messages.owner.appointments.edit],
              [links.cancel(appointment.id), messages.owner.appointments.cancel],
            ] as const
          ).map(([href, label]) => (
            <li key={label}>
              <a className="button-secondary" href={href}>
                {label}
                <span className="visually-hidden">
                  {' '}
                  {messages.owner.appointments.of} {appointment.startsAt.localTime}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Releasing a period from where it shows (Historia 3). Absent on a day that is over. */
export type ReleasePeriod = {
  readonly action: (form: FormData) => Promise<void>;
  readonly withCancelled: boolean;
};

export function Timeline({
  day,
  release,
  links,
}: {
  readonly day: AgendaDayDto;
  readonly release?: ReleasePeriod;
  readonly links?: AppointmentLinks;
}) {
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
                    <AppointmentCard appointment={entry.appointment} date={day.date} links={links} />
                  </li>
                );
              case 'UNAVAILABLE':
                return (
                  <li key={`p-${entry.period.id}`} className="timeline-unavailable">
                    <span className="timeline-time">{span(day.date, entry.period.startsAt, entry.period.endsAt)}</span>{' '}
                    <span aria-hidden="true">⊘</span> {messages.owner.agenda.unavailable}
                    {entry.period.reason !== null && ` · ${entry.period.reason}`}
                    {release !== undefined && (
                      <form action={release.action}>
                        <input type="hidden" name="periodo" value={entry.period.id} />
                        <input type="hidden" name="fecha" value={day.date} />
                        {release.withCancelled && <input type="hidden" name="canceladas" value="1" />}
                        <button type="submit" className="button-secondary">
                          {messages.owner.periods.release}
                          <span className="visually-hidden">
                            {' '}
                            {span(day.date, entry.period.startsAt, entry.period.endsAt)}
                          </span>
                        </button>
                      </form>
                    )}
                  </li>
                );
              case 'FREE':
                return (
                  <li key={`f-${entry.startsAt.instant}`} className="timeline-free">
                    <span className="timeline-time">{span(day.date, entry.startsAt, entry.endsAt)}</span>{' '}
                    {messages.owner.agenda.free}
                    {links !== undefined && (
                      <>
                        {' '}
                        <a className="touch-link" href={links.newAt(entry.startsAt.localTime)}>
                          {messages.owner.appointments.newHere}
                          <span className="visually-hidden"> {entry.startsAt.localTime}</span>
                        </a>
                      </>
                    )}
                  </li>
                );
            }
          })}
        </ol>
      )}
    </>
  );
}
