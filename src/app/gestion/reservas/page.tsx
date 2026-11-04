import type { Metadata } from 'next';
import { container } from '@/app/_lib/container';
import {
  encodeCursor,
  listErrorOf,
  listInputOf,
  paramsOf,
  type BookingListParams,
} from '@/app/api/gestion/_lib/booking-list-params';
import { ownerAppointmentDto } from '@/app/api/gestion/_lib/serializers';
import { NavForm } from '@/components/nav-form';
import { BookingList } from '@/components/owner/booking-list';
import { OwnerHeader } from '@/components/owner/owner-header';
import { messages } from '@/messages/es-ES';
import { requireOwnerPage } from '../_lib/require-owner-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: messages.owner.bookings.title };

const T = messages.owner.bookings;

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** What the filters show: the decided query, or what was typed when it was refused. */
type Shown = {
  readonly orden: string;
  readonly estado: string;
  readonly origen: string;
  readonly desde: string | null;
  readonly hasta: string | null;
  readonly buscar: string | null;
};

/** The same filters and search, on another page or on the first. */
function hrefOf(shown: Shown, after?: string): string {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(shown)) if (value !== null) url.set(key, value);
  if (after !== undefined) url.set('despues', after);
  return `/gestion/reservas?${url.toString()}`;
}

function Choice<K extends string>({
  name,
  legend,
  options,
  current,
}: {
  readonly name: string;
  readonly legend: string;
  readonly options: Record<K, string>;
  readonly current: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{legend}</label>
      <select id={name} name={name} className="input" defaultValue={current}>
        {(Object.entries(options) as [K, string][]).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The owner's bookings list (002, Historia 10): filters and search beside the
 * rows on a desktop, above them on a phone (D-034). Everything the filters show
 * comes from the query as the domain decided it.
 */
export default async function BookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireOwnerPage();

  const raw = await searchParams;
  const params: BookingListParams = {
    orden: single(raw['orden']),
    estado: single(raw['estado']),
    origen: single(raw['origen']),
    desde: single(raw['desde']),
    hasta: single(raw['hasta']),
    buscar: single(raw['buscar']),
    despues: single(raw['despues']),
  };

  const input = listInputOf(params);
  const result = input === 'INVALID' ? null : await container().listBookings(input);
  const problem =
    input === 'INVALID' ? listErrorOf('INVALID_CURSOR') : result !== null && !result.ok ? listErrorOf(result.error) : null;

  // A refused query still paints the filters, as typed, so they can be fixed.
  const shown: Shown =
    result?.ok === true
      ? paramsOf(result.value.query, params.buscar)
      : {
          orden: params.orden ?? 'proximas',
          estado: params.estado ?? 'confirmadas',
          origen: params.origen ?? 'todos',
          desde: params.desde ?? null,
          hasta: params.hasta ?? null,
          buscar: params.buscar ?? null,
        };

  const now = container().clock.now();
  const rows =
    result?.ok === true
      ? result.value.page.rows.map((row) =>
          ownerAppointmentDto(row, now, result.value.salon.timezone, result.value.confirmationCalls),
        )
      : [];
  const next = result?.ok === true && result.value.page.next !== null ? encodeCursor(result.value.page.next) : null;

  return (
    <>
      <OwnerHeader current="bookings" split />
      <main className="page--split">
        <h1>{T.title}</h1>

        <div className="col-main">
          {problem !== null && (
            <div className="notice-error" role="alert">
              <p>{problem.message}</p>
              <p>{problem.nextAction}</p>
            </div>
          )}

          {problem === null && rows.length === 0 && (
            <div className="notice">
              <p>{T.empty}</p>
              <p>
                <a className="touch-link" href="/gestion/reservas">
                  {T.reset}
                </a>
              </p>
            </div>
          )}

          {rows.length > 0 && <BookingList rows={rows} />}

          <nav aria-label={T.results} className="agenda-steps">
            {params.despues !== undefined && params.despues !== '' && (
              <a className="touch-link" href={hrefOf(shown)}>
                {T.first}
              </a>
            )}
            {next !== null && (
              <a className="touch-link" href={hrefOf(shown, next)}>
                {T.next}
              </a>
            )}
          </nav>
        </div>

        <div className="col-side">
          <section aria-labelledby="filters-heading" className="card">
            <h2 id="filters-heading">{T.filters}</h2>
            <NavForm action="/gestion/reservas">
              <div className="field">
                <label htmlFor="buscar">{T.search}</label>
                <input
                  id="buscar"
                  name="buscar"
                  type="search"
                  className="input"
                  defaultValue={shown.buscar ?? ''}
                  maxLength={100}
                  aria-describedby="buscar-hint"
                />
                <p id="buscar-hint" className="muted">
                  {T.searchHint}
                </p>
              </div>
              <Choice name="orden" legend={T.order} options={T.orders} current={shown.orden} />
              <Choice name="estado" legend={T.status} options={T.statuses} current={shown.estado} />
              <Choice name="origen" legend={T.origin} options={T.origins} current={shown.origen} />
              <div className="field">
                <label htmlFor="desde">{T.from}</label>
                <input id="desde" name="desde" type="date" className="input" defaultValue={shown.desde ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="hasta">{T.to}</label>
                <input id="hasta" name="hasta" type="date" className="input" defaultValue={shown.hasta ?? ''} />
              </div>
              <button type="submit" className="button">
                {T.apply}
              </button>
            </NavForm>
            <p>
              <a className="touch-link" href="/gestion/reservas">
                {T.reset}
              </a>
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
