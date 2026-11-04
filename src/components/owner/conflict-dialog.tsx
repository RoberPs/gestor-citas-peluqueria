'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { AppointmentFormState } from '@/app/gestion/agenda/appointment-actions';
import { messages } from '@/messages/es-ES';

/**
 * What is in the way, named, before anything is touched (002, Historia 6,
 * FR-033, FR-034).
 *
 * A native modal `dialog`: the browser keeps the focus inside it, Escape
 * closes it, and on closing the focus goes back to the button that opened it
 * (Principio VII). It lives inside the form it answers, so confirming sends
 * the owner's choices with everything she had typed, plus the `stateToken`
 * she was shown. The only ways out are explicit ones: cancel the appointment
 * in the way, delete or shorten the period, or leave with nothing changed.
 * There is no "keep both" (FR-035).
 */

const T = messages.owner.conflict;

type Conflict = Extract<AppointmentFormState, { kind: 'conflict' }>;

function span(conflict: Conflict['conflicts'][number]): string {
  const sameDay = conflict.startsAt.localDate === conflict.endsAt.localDate;
  const to = sameDay ? conflict.endsAt.localTime : `${conflict.endsAt.localDate} ${conflict.endsAt.localTime}`;
  return `${conflict.startsAt.localTime}–${to}`;
}

export function ConflictDialog({
  state,
  pending,
  onAbandon,
  returnFocusTo,
}: {
  readonly state: Conflict;
  readonly pending: boolean;
  readonly onAbandon: () => void;
  /** The button that sent the form: it was disabled while sending, so it is not `activeElement` now. */
  readonly returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    const opener = returnFocusTo.current;
    if (element !== null && !element.open) element.showModal();
    return () => opener?.focus();
  }, [state.stateToken, returnFocusTo]);

  const appointments = state.conflicts.filter((conflict) => conflict.kind === 'APPOINTMENT');
  const periods = state.conflicts.filter((conflict) => conflict.kind === 'UNAVAILABLE_PERIOD');

  return (
    <dialog
      ref={dialog}
      className="conflict-dialog"
      aria-labelledby="conflict-title"
      aria-describedby="conflict-summary"
      onCancel={(event) => {
        event.preventDefault();
        onAbandon();
      }}
    >
      <h2 id="conflict-title">{T.title}</h2>
      <div id="conflict-summary" role="alert">
        <p>{state.message}</p>
        <p>{state.nextAction}</p>
      </div>

      <input type="hidden" name="confirmar" value="1" />
      <input type="hidden" name="stateToken" value={state.stateToken} />

      {appointments.length > 0 && (
        <fieldset>
          <legend>{T.appointmentsTitle}</legend>
          <p className="muted">{T.noKeepBoth}</p>
          <ul className="conflict-list">
            {appointments.map((conflict) => (
              <li key={conflict.id}>
                <p>
                  <strong>{span(conflict)}</strong>{' '}
                  {conflict.kind === 'APPOINTMENT' && `${conflict.customerName} · ${conflict.serviceNames.join(', ')}`}
                </p>
                <label className="choice">
                  <input type="checkbox" name="cancelar" value={conflict.id} required />{' '}
                  {T.cancelAppointment}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {periods.map((conflict) => (
        <fieldset key={conflict.id}>
          <legend>
            {T.periodsTitle}: <strong>{span(conflict)}</strong>
            {conflict.kind === 'UNAVAILABLE_PERIOD' && conflict.reason !== null && ` · ${conflict.reason}`}
          </legend>
          <label className="choice">
            <input type="radio" name={`periodo:${conflict.id}`} value="eliminar" required /> {T.deletePeriod}
          </label>
          {conflict.shortenings.map((shortening) => (
            <label key={shortening.value} className="choice">
              <input type="radio" name={`periodo:${conflict.id}`} value={shortening.value} />{' '}
              {T.shortenTo.replace('{from}', shortening.from).replace('{to}', shortening.to)}
            </label>
          ))}
        </fieldset>
      ))}

      {state.warnings.length > 0 && (
        <fieldset>
          <legend>{T.warningsTitle}</legend>
          <ul>
            {state.warnings.map((warning) => (
              <li key={warning.code}>
                {warning.message}
                <input type="hidden" name="aviso" value={warning.code} />
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <p className="muted">{T.atomic}</p>
      <div className="actions">
        <button type="submit" className="button" disabled={pending} aria-busy={pending}>
          {pending ? messages.owner.busy : T.confirm}
        </button>
        <button type="button" className="button-secondary" onClick={onAbandon}>
          {T.abandon}
        </button>
      </div>
    </dialog>
  );
}
