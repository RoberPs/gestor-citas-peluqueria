import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { container } from '@/app/_lib/container';
import { longDateLabel } from '@/app/_lib/format';
import { serviceIdsFrom } from '@/app/_lib/service-ids';
import { serviceDto } from '@/app/api/_lib/serializers';
import { agendaDayDto, ownerAppointmentDto, type AgendaDayDto } from '@/app/api/gestion/_lib/serializers';
import { appointmentIdSchema } from '@/app/api/gestion/_lib/appointment-params';
import { NavForm } from '@/components/nav-form';
import { ManualBookingForm } from '@/components/owner/manual-booking-form';
import { CancelForm, EditForm, MoveForm } from '@/components/owner/move-form';
import { OwnerHeader } from '@/components/owner/owner-header';
import { PeriodForm } from '@/components/owner/period-form';
import { Timeline, type AppointmentLinks } from '@/components/owner/timeline';
import { ServicePicker } from '@/components/service-picker';
import { durationOfServices, mergeServiceSelection, selectServices } from '@/domain/catalog/selection';
import { addMinutes, formatLocalTime } from '@/domain/shared/time';
import { messages } from '@/messages/es-ES';
import { requireOwnerPage } from '../_lib/require-owner-page';
import { blockPeriod, releasePeriod } from './actions';
import { cancelAppointment, createAppointment, editAppointment, moveAppointment } from './appointment-actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: messages.owner.agenda.title };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function agendaHref(date: string, withCancelled: boolean): string {
  return `/gestion/agenda?fecha=${date}${withCancelled ? '&canceladas=1' : ''}`;
}

type AppointmentDto = Extract<AgendaDayDto['entries'][number], { kind: 'APPOINTMENT' }>['appointment'];

function appointmentOf(day: AgendaDayDto, id: string | undefined): AppointmentDto | undefined {
  for (const entry of day.entries) {
    if (entry.kind === 'APPOINTMENT' && entry.appointment.id === id) return entry.appointment;
  }
  return undefined;
}

/** A panel of the side column, reached by its anchor from the timeline. */
function ActionPanel({ title, hint, children }: { readonly title: string; readonly hint?: string; readonly children: ReactNode }) {
  return (
    <section id="accion" aria-labelledby="action-heading" className="card">
      <h2 id="action-heading">{title}</h2>
      {hint !== undefined && <p className="muted">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * The owner's agenda of one day (002, Historia 2): any date, past or future,
 * and back to today in one gesture (FR-012). The timeline goes in the main
 * column and the day navigation beside it on a desktop (D-034). On a day that
 * is not over, time is blocked beside the timeline and released from it
 * (Historia 3).
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireOwnerPage();

  const query = await searchParams;
  const withCancelled = single(query['canceladas']) === '1';
  const releasedParam = single(query['liberado']);
  const released = releasedParam === undefined ? undefined : releasedParam === 'si';
  const { getAgendaDay, clock } = container();

  let result = await getAgendaDay({ date: single(query['fecha']), includeCancelled: withCancelled });
  // An unreadable date in the address is not an error worth a screen: today it is.
  if (!result.ok) result = await getAgendaDay({ includeCancelled: withCancelled });
  if (!result.ok) throw new Error('today could not be read');

  const { day, today, salon, confirmationCalls } = result.value;
  const dto = agendaDayDto(day, clock.now(), salon.timezone, confirmationCalls);
  const date = dto.date;
  const previous = day.date.subtract({ days: 1 }).toString();
  const next = day.date.add({ days: 1 }).toString();
  const here = agendaHref(date, withCancelled);

  // Historias 4 y 5: one change at a time, opened from the timeline by address.
  const links: AppointmentLinks | undefined = dto.isReadOnly
    ? undefined
    : {
        newAt: (time) => `${here}&nueva=${encodeURIComponent(time)}#accion`,
        move: (id) => `${here}&mover=${id}#accion`,
        edit: (id) => `${here}&editar=${id}#accion`,
        cancel: (id) => `${here}&cancelar=${id}#accion`,
      };
  const newAt = links === undefined ? undefined : single(query['nueva']);
  const toMove = links === undefined ? undefined : appointmentOf(dto, single(query['mover']));
  const editId = appointmentIdSchema.safeParse(single(query['editar']));
  const toEdit = links === undefined || !editId.success ? null : await container().appointments.findById(editId.data);
  // Looked up by id, not on the timeline: once cancelled it leaves the timeline, and
  // the panel still has to say so, with whom to call (FR-043).
  const cancelId = appointmentIdSchema.safeParse(single(query['cancelar']));
  const found = links === undefined || !cancelId.success ? null : await container().appointments.findById(cancelId.data);
  const toCancel = found === null ? undefined : ownerAppointmentDto(found, clock.now(), salon.timezone);

  let panel: ReactNode = null;
  if (newAt !== undefined) {
    const catalogue = (await container().listServices()).services;
    const serviceIds = serviceIdsFrom(typeof query['serviceIds'] === 'string' ? query['serviceIds'] : undefined, catalogue);
    const selection = selectServices(catalogue, serviceIds);
    panel = (
      <ActionPanel title={messages.owner.appointments.newTitle} hint={messages.owner.appointments.newHint}>
        <ServicePicker
          services={catalogue.map(serviceDto)}
          selectedIds={serviceIds}
          totalDurationMinutes={selection.ok ? selection.value.durationMinutes : null}
          action="/gestion/agenda"
          keep={{ fecha: date, nueva: newAt, canceladas: withCancelled ? '1' : undefined }}
        />
        <ManualBookingForm
          action={createAppointment}
          date={date}
          time={newAt}
          serviceIds={serviceIds}
          closeHref={here}
        />
      </ActionPanel>
    );
  } else if (toMove !== undefined) {
    panel = (
      <ActionPanel title={messages.owner.appointments.moveTitle} hint={messages.owner.appointments.moveHint}>
        <MoveForm
          key={toMove.id}
          action={moveAppointment}
          appointmentId={toMove.id}
          date={toMove.startsAt.localDate}
          time={toMove.startsAt.localTime}
          closeHref={here}
        />
      </ActionPanel>
    );
  } else if (toEdit !== null && toEdit.status === 'CONFIRMED') {
    // Today's offer, plus the retired services it already has: it keeps them (FR-072).
    const current = toEdit.services.map((service) => service.serviceId);
    const catalogue = (await container().config.loadCatalogue()).filter(
      (service) => service.isActive || current.includes(service.id),
    );
    const requested = query['serviceIds'];
    const serviceIds =
      typeof requested === 'string'
        ? serviceIdsFrom(requested, catalogue)
        : catalogue.filter((service) => current.includes(service.id)).map((service) => service.id);
    const merged = mergeServiceSelection({ catalogue, current: toEdit.services, requestedIds: serviceIds });
    const minutes = merged.ok ? durationOfServices(merged.value) : null;
    panel = (
      <ActionPanel title={messages.owner.appointments.editTitle} hint={messages.owner.appointments.editHint}>
        <ServicePicker
          services={catalogue.map(serviceDto)}
          selectedIds={serviceIds}
          totalDurationMinutes={minutes}
          action="/gestion/agenda"
          keep={{ fecha: date, editar: toEdit.id, canceladas: withCancelled ? '1' : undefined }}
        />
        <EditForm
          key={toEdit.id}
          action={editAppointment}
          appointmentId={toEdit.id}
          serviceIds={serviceIds}
          customer={toEdit.customer ?? { name: '', phone: '', email: null }}
          endsAt={minutes === null ? null : formatLocalTime(addMinutes(toEdit.startsAt, minutes), salon.timezone)}
          closeHref={here}
        />
      </ActionPanel>
    );
  } else if (toCancel !== undefined && toCancel.status === 'CANCELLED') {
    const phone = toCancel.hasManagementLink && toCancel.customer !== null ? toCancel.customer.phone : null;
    panel = (
      <ActionPanel title={messages.owner.appointments.cancelTitle}>
        <div role="status" className="notice">
          <p>{messages.owner.appointments.cancelled}</p>
          {phone !== null && (
            <p>
              {messages.owner.appointments.callCustomer}{' '}
              <a className="touch-link" href={`tel:${phone.replace(/[\s.-]/g, '')}`}>
                {phone}
              </a>
            </p>
          )}
          <p>
            <a className="touch-link" href={here}>
              {messages.owner.appointments.close}
            </a>
          </p>
        </div>
      </ActionPanel>
    );
  } else if (toCancel !== undefined) {
    const question = messages.owner.appointments.cancelQuestion
      .replace('{name}', toCancel.customer?.name ?? messages.owner.agenda.anonymized)
      .replace('{date}', longDateLabel(toCancel.startsAt.localDate))
      .replace('{time}', toCancel.startsAt.localTime);
    panel = (
      <ActionPanel title={messages.owner.appointments.cancelTitle}>
        <CancelForm
          key={toCancel.id}
          action={cancelAppointment}
          appointmentId={toCancel.id}
          question={question}
          closeHref={here}
        />
      </ActionPanel>
    );
  }

  return (
    <>
      <OwnerHeader current="agenda" split />
      <main className="page--split">
        <h1>
          {messages.owner.agenda.title}
          <span className="h1-sub">{longDateLabel(date)}</span>
        </h1>
        <p className="muted">{messages.common.timezoneNotice}</p>

        <div className="col-main">
          {released !== undefined && (
            <div role="status" className={released ? 'notice' : 'notice-error'}>
              {released ? (
                <p>{messages.owner.periods.released}</p>
              ) : (
                <>
                  <p>{messages.owner.errors.periodNotFound.message}</p>
                  <p>{messages.owner.errors.periodNotFound.nextAction}</p>
                </>
              )}
            </div>
          )}
          <Timeline
            day={dto}
            release={dto.isReadOnly ? undefined : { action: releasePeriod, withCancelled }}
            {...(links === undefined ? {} : { links })}
          />
        </div>

        <div className="col-side">
          {panel}
          <section aria-labelledby="day-picker-heading" className="card">
            <h2 id="day-picker-heading">{messages.owner.agenda.dayPicker}</h2>
            <ul className="agenda-steps">
              <li>
                <a href={agendaHref(previous, withCancelled)}>{messages.owner.agenda.previous}</a>
              </li>
              <li>
                <a
                  href={agendaHref(today.toString(), withCancelled)}
                  aria-current={date === today.toString() ? 'date' : undefined}
                >
                  {messages.owner.agenda.today}
                </a>
              </li>
              <li>
                <a href={agendaHref(next, withCancelled)}>{messages.owner.agenda.next}</a>
              </li>
            </ul>

            <NavForm action="/gestion/agenda">
              <div className="field">
                <label htmlFor="fecha">{messages.owner.agenda.dateLabel}</label>
                <input id="fecha" name="fecha" type="date" className="input" defaultValue={date} required />
              </div>
              {withCancelled && <input type="hidden" name="canceladas" value="1" />}
              <button type="submit" className="button-secondary">
                {messages.owner.agenda.go}
              </button>
            </NavForm>

            <p>
              <a className="touch-link" href={agendaHref(date, !withCancelled)}>
                {withCancelled ? messages.owner.agenda.hideCancelled : messages.owner.agenda.showCancelled}
              </a>
            </p>
          </section>

          {!dto.isReadOnly && (
            // Keyed by day, so moving to another day starts the form afresh from it.
            <PeriodForm key={date} action={blockPeriod} date={date} abandonHref={agendaHref(date, withCancelled)} />
          )}
        </div>
      </main>
    </>
  );
}
