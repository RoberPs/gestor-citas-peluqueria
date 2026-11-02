'use client';

import { useActionState } from 'react';
import { submitBooking } from '@/app/(booking)/reservar/actions';
import { emptyBookingFormState, type BookingFormState } from '@/app/(booking)/reservar/form-state';
import { messages } from '@/messages/es-ES';

/**
 * Exactly three fields, and no fourth one (FR-008, Principio III).
 *
 * The only client component in the feature, and it earns its place: it is what
 * lets a rejected phone number come back with the name and the email still in
 * the boxes, without ever putting any of the three in a URL. Without
 * JavaScript the form still posts and still re-renders with its errors — Next
 * runs the action either way.
 *
 * Each error is tied to its field with `aria-describedby`, and the summary sits
 * in a live region so it is announced rather than merely appearing (FR-037).
 */
export function BookingForm({
  serviceId,
  startsAt,
}: {
  readonly serviceId: string;
  readonly startsAt: string;
}) {
  const [state, action, pending] = useActionState<BookingFormState, FormData>(
    submitBooking,
    emptyBookingFormState,
  );

  return (
    <form action={action} noValidate>
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="startsAt" value={startsAt} />

      <div aria-live="polite">
        {state.summaryError !== null && (
          <div className="notice-error" role="alert">
            <p>
              <strong>{messages.booking.errorSummaryTitle}</strong>
            </p>
            <p>{state.summaryError.message}</p>
            <p>{state.summaryError.nextAction}</p>
          </div>
        )}
      </div>

      <Field
        name="name"
        label={messages.booking.nameLabel}
        hint={messages.booking.nameHint}
        autoComplete="name"
        defaultValue={state.values.name}
        error={state.fieldErrors.name}
      />
      <Field
        name="phone"
        label={messages.booking.phoneLabel}
        hint={messages.booking.phoneHint}
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        defaultValue={state.values.phone}
        error={state.fieldErrors.phone}
      />
      <Field
        name="email"
        label={messages.booking.emailLabel}
        hint={messages.booking.emailHint}
        type="email"
        autoComplete="email"
        inputMode="email"
        defaultValue={state.values.email}
        error={state.fieldErrors.email}
      />

      <p className="muted">{messages.booking.dataUse}</p>

      <button type="submit" className="button" disabled={pending}>
        {pending ? messages.common.loading : messages.booking.submit}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  error,
  defaultValue,
  type = 'text',
  autoComplete,
  inputMode,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly error: string | undefined;
  readonly defaultValue: string;
  readonly type?: string;
  readonly autoComplete?: string;
  readonly inputMode?: 'tel' | 'email';
}) {
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;

  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <p className="muted" id={hintId}>
        {hint}
      </p>

      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        className={error === undefined ? 'input' : 'input is-invalid'}
        aria-describedby={error === undefined ? hintId : `${hintId} ${errorId}`}
        aria-invalid={error !== undefined}
        {...(autoComplete === undefined ? {} : { autoComplete })}
        {...(inputMode === undefined ? {} : { inputMode })}
        required
      />

      {error !== undefined && (
        <p className="field-error" id={errorId}>
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </div>
  );
}
