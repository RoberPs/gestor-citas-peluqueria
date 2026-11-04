'use client';

import { useActionState, useState } from 'react';
import type { blockPeriod, PeriodFormState, PeriodFormValues } from '@/app/gestion/agenda/actions';
import type { ConflictDto } from '@/app/api/gestion/_lib/serializers';
import { messages } from '@/messages/es-ES';

/**
 * Blocking time from the agenda (002, Historia 3): some hours of one day, or
 * whole days, on the 15 minute grid (FR-018), with an internal reason the
 * client never sees (FR-021).
 *
 * Over confirmed appointments the server answers with them, named, and the
 * owner either blocks anyway — nobody is cancelled (FR-022) — or leaves it.
 * The form anticipates nothing: what is valid is decided on the server.
 */

const T = messages.owner.periods;

/** 00:00, 00:15 … 23:45: the grid of FR-018, so an off-grid time cannot be picked. */
const TIMES = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

function span(conflict: ConflictDto): string {
  const sameDay = conflict.startsAt.localDate === conflict.endsAt.localDate;
  const to = sameDay ? conflict.endsAt.localTime : `${conflict.endsAt.localDate} ${conflict.endsAt.localTime}`;
  return `${conflict.startsAt.localTime}–${to}`;
}

function TimeSelect({ id, label, value }: { readonly id: string; readonly label: string; readonly value: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={id} className="input" defaultValue={value}>
        {TIMES.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateField({ id, label, value }: { readonly id: string; readonly label: string; readonly value: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} type="date" className="input" defaultValue={value} required />
    </div>
  );
}

export function PeriodForm({
  action,
  date,
  abandonHref,
}: {
  readonly action: typeof blockPeriod;
  /** The agenda's day, `YYYY-MM-DD`, which every date starts at. */
  readonly date: string;
  readonly abandonHref: string;
}) {
  const initial: PeriodFormValues = {
    tipo: 'horas',
    dia: date,
    desde: '13:00',
    hasta: '14:00',
    primerDia: date,
    ultimoDia: date,
    motivo: '',
  };
  const [state, submit, pending] = useActionState<PeriodFormState, FormData>(action, { kind: 'idle', values: initial });
  const [kind, setKind] = useState(state.values.tipo);
  const values = state.values;

  return (
    <section aria-labelledby="period-heading" className="card">
      <h2 id="period-heading">{T.title}</h2>
      <p className="muted">{T.hint}</p>

      <div role="status" aria-live="polite">
        {state.kind === 'saved' && (
          <div className="notice">
            <p>{T.saved}</p>
          </div>
        )}
      </div>

      <form action={submit}>
        {state.kind === 'error' && (
          <div className="notice-error" role="alert">
            <p>{state.message}</p>
            <p>{state.nextAction}</p>
          </div>
        )}

        <div className="field">
          <label htmlFor="tipo">{T.kind}</label>
          <select
            id="tipo"
            name="tipo"
            className="input"
            value={kind}
            onChange={(event) => setKind(event.target.value === 'dias' ? 'dias' : 'horas')}
          >
            <option value="horas">{T.kinds.horas}</option>
            <option value="dias">{T.kinds.dias}</option>
          </select>
        </div>

        {kind === 'horas' ? (
          <>
            <DateField id="dia" label={T.day} value={values.dia} />
            <TimeSelect id="desde" label={T.from} value={values.desde} />
            <TimeSelect id="hasta" label={T.to} value={values.hasta} />
          </>
        ) : (
          <>
            <DateField id="primerDia" label={T.firstDay} value={values.primerDia} />
            <DateField id="ultimoDia" label={T.lastDay} value={values.ultimoDia} />
          </>
        )}

        <div className="field">
          <label htmlFor="motivo">{T.reason}</label>
          <p id="motivo-hint" className="muted">
            {T.reasonHint}
          </p>
          <input
            id="motivo"
            name="motivo"
            className="input"
            maxLength={200}
            aria-describedby="motivo-hint"
            defaultValue={values.motivo}
          />
        </div>

        {state.kind === 'conflict' ? (
          <div className="notice-warning" role="alert">
            <p>{messages.owner.errors.periodConflict.message}</p>
            <p>{messages.owner.errors.periodConflict.nextAction}</p>
            <h3>{T.conflictList}</h3>
            <ul>
              {state.conflicts.map((conflict) => (
                <li key={conflict.id}>
                  <strong>{span(conflict)}</strong>{' '}
                  {conflict.kind === 'APPOINTMENT'
                    ? `${conflict.customerName} · ${conflict.serviceNames.join(', ')}`
                    : (conflict.reason ?? messages.owner.agenda.unavailable)}
                  <input type="hidden" name="confirmarCita" value={conflict.id} />
                </li>
              ))}
            </ul>
            <input type="hidden" name="stateToken" value={state.stateToken} />
            <button type="submit" className="button" disabled={pending} aria-busy={pending}>
              {pending ? messages.owner.busy : T.acknowledge}
            </button>{' '}
            <a className="touch-link" href={abandonHref}>
              {T.abandon}
            </a>
          </div>
        ) : (
          <button type="submit" className="button" disabled={pending} aria-busy={pending}>
            {pending ? messages.owner.busy : T.submit}
          </button>
        )}
      </form>
    </section>
  );
}
