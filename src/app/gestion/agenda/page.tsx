import type { Metadata } from 'next';
import { container } from '@/app/_lib/container';
import { longDateLabel } from '@/app/_lib/format';
import { agendaDayDto } from '@/app/api/gestion/_lib/serializers';
import { NavForm } from '@/components/nav-form';
import { OwnerHeader } from '@/components/owner/owner-header';
import { PeriodForm } from '@/components/owner/period-form';
import { Timeline } from '@/components/owner/timeline';
import { messages } from '@/messages/es-ES';
import { requireOwnerPage } from '../_lib/require-owner-page';
import { blockPeriod, releasePeriod } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: messages.owner.agenda.title };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function agendaHref(date: string, withCancelled: boolean): string {
  return `/gestion/agenda?fecha=${date}${withCancelled ? '&canceladas=1' : ''}`;
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

  const { day, today, salon } = result.value;
  const dto = agendaDayDto(day, clock.now(), salon.timezone);
  const date = dto.date;
  const previous = day.date.subtract({ days: 1 }).toString();
  const next = day.date.add({ days: 1 }).toString();

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
          <Timeline day={dto} release={dto.isReadOnly ? undefined : { action: releasePeriod, withCancelled }} />
        </div>

        <div className="col-side">
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
