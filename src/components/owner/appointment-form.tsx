'use client';

import { useActionState, useRef, useState, type ReactNode } from 'react';
import type { AppointmentFormState } from '@/app/gestion/agenda/appointment-actions';
import { messages } from '@/messages/es-ES';
import { ConflictDialog } from './conflict-dialog';

/**
 * What the owner's appointment forms share (002, Historias 4, 5 y 11): the
 * outcome said in words — saved, with the phone to call when the client has
 * a link and v1 tells them nothing (FR-043); or what failed and what to do
 * next (FR-059) — and the conflict dialog of Historia 6 inside the form it
 * answers. What the fields are is each form's business.
 */

const T = messages.owner.appointments;

export type AppointmentAction = (previous: AppointmentFormState, form: FormData) => Promise<AppointmentFormState>;

export function AppointmentForm({
  action,
  initialValues,
  headingId,
  savedMessage,
  submitLabel,
  closeHref,
  closeLabel = T.close,
  children,
}: {
  readonly action: AppointmentAction;
  readonly initialValues: Readonly<Record<string, string>>;
  readonly headingId: string;
  readonly savedMessage: string;
  readonly submitLabel: string;
  readonly closeHref: string;
  /** How leaving without saving is said; «Cerrar» unless the form asks something. */
  readonly closeLabel?: string;
  /** The fields, given what was last sent and which contact fields failed. */
  readonly children: (values: Readonly<Record<string, string>>, invalid: readonly string[]) => ReactNode;
}) {
  const [state, submit, pending] = useActionState<AppointmentFormState, FormData>(action, {
    kind: 'idle',
    values: initialValues,
  });
  const [abandoned, setAbandoned] = useState<string | null>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const conflict = state.kind === 'conflict' && abandoned !== state.stateToken ? state : null;

  return (
    <>
      <div role="status" aria-live="polite">
        {state.kind === 'saved' && (
          <div className="notice">
            <p>{savedMessage}</p>
            {state.notifyPhone !== null && (
              <p>
                {T.callCustomer}{' '}
                <a className="touch-link" href={`tel:${state.notifyPhone.replace(/[\s.-]/g, '')}`}>
                  {state.notifyPhone}
                </a>
              </p>
            )}
            <p>
              <a className="touch-link" href={closeHref}>
                {T.close}
              </a>
            </p>
          </div>
        )}
      </div>

      {state.kind !== 'saved' && (
        <form action={submit} aria-labelledby={headingId} noValidate>
          {state.kind === 'error' && (
            <div className="notice-error" role="alert">
              <p>{state.message}</p>
              <p>{state.nextAction}</p>
            </div>
          )}

          {children(state.values, state.kind === 'error' ? state.fields : [])}

          <div className="actions">
            <button ref={submitButton} type="submit" className="button" disabled={pending} aria-busy={pending}>
              {pending ? messages.owner.busy : submitLabel}
            </button>
            <a className="touch-link" href={closeHref}>
              {closeLabel}
            </a>
          </div>

          {conflict !== null && (
            <ConflictDialog
              state={conflict}
              pending={pending}
              onAbandon={() => setAbandoned(conflict.stateToken)}
              returnFocusTo={submitButton}
            />
          )}
        </form>
      )}
    </>
  );
}

/** 00:00, 00:15 … 23:45: the owner's grid (D-025), so an off-grid start cannot be picked. */
export const QUARTER_HOURS = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

export function DayAndTime({ values }: { readonly values: Readonly<Record<string, string>> }) {
  return (
    <>
      <div className="field">
        <label htmlFor="fecha">{T.day}</label>
        <input id="fecha" name="fecha" type="date" className="input" defaultValue={values['fecha']} required />
      </div>
      <div className="field">
        <label htmlFor="hora">{T.time}</label>
        <p id="hora-hint" className="muted">
          {T.timeHint}
        </p>
        <select id="hora" name="hora" className="input" defaultValue={values['hora']} aria-describedby="hora-hint">
          {QUARTER_HOURS.map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/** Name, phone and an optional email, each marked when the server refused it (FR-031). */
export function CustomerFields({
  values,
  invalid,
}: {
  readonly values: Readonly<Record<string, string>>;
  readonly invalid: readonly string[];
}) {
  const fields = [
    { id: 'nombre', field: 'customer.name', label: T.name, type: 'text', autoComplete: 'name', required: true },
    { id: 'telefono', field: 'customer.phone', label: T.phone, type: 'tel', autoComplete: 'tel', required: true },
    { id: 'email', field: 'customer.email', label: T.email, type: 'email', autoComplete: 'email', required: false },
  ] as const;

  return (
    <>
      {fields.map((field) => (
        <div className="field" key={field.id}>
          <label htmlFor={field.id}>{field.label}</label>
          <input
            id={field.id}
            name={field.id}
            type={field.type}
            className="input"
            autoComplete={field.autoComplete}
            required={field.required}
            aria-invalid={invalid.includes(field.field) || undefined}
            defaultValue={values[field.id]}
          />
        </div>
      ))}
    </>
  );
}
