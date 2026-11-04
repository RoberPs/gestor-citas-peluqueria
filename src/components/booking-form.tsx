'use client';

import { useActionState } from 'react';
import { submitBooking } from '@/app/(booking)/reservar/actions';
import { emptyBookingFormState, type BookingFormState } from '@/app/(booking)/reservar/form-state';
import { useBookingDraft } from '@/components/booking-draft';
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
 *
 * What is typed is also copied into the booking draft, so that on desktop,
 * where the client can change day or hour with the form in view, nothing
 * typed is lost (003, FR-009). After a rejected attempt the server's values win.
 */
export function BookingForm({
  serviceIds,
  startsAt,
  emailConsentOffered,
}: {
  readonly serviceIds: readonly string[];
  readonly startsAt: string;
  /** 004, FR-004: the checkbox exists only while the email channel is on. */
  readonly emailConsentOffered: boolean;
}) {
  const [state, action, pending] = useActionState<BookingFormState, FormData>(
    submitBooking,
    emptyBookingFormState,
  );
  const { draft, update } = useBookingDraft();

  return (
    <form action={action} noValidate>
      <input type="hidden" name="serviceIds" value={serviceIds.join(',')} />
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
        defaultValue={state.values.name || draft.name}
        onChange={(value) => update('name', value)}
        error={state.fieldErrors.name}
      />
      <Field
        name="phone"
        label={messages.booking.phoneLabel}
        hint={messages.booking.phoneHint}
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        defaultValue={state.values.phone || draft.phone}
        onChange={(value) => update('phone', value)}
        error={state.fieldErrors.phone}
      />
      <Field
        name="email"
        label={messages.booking.emailLabel}
        hint={messages.booking.emailHint}
        type="email"
        autoComplete="email"
        inputMode="email"
        defaultValue={state.values.email || draft.email}
        onChange={(value) => update('email', value)}
        error={state.fieldErrors.email}
      />

      {/* 004, FR-001: unticked until the client ticks it, and kept as it was
          after a rejected attempt, like the fields above. */}
      {emailConsentOffered && (
        <div className="field field-check">
          <input
            id="emailConsent"
            name="emailConsent"
            type="checkbox"
            defaultChecked={state.values.emailConsent}
            aria-describedby="emailConsent-hint"
          />
          <label htmlFor="emailConsent">{messages.booking.emailConsentLabel}</label>
          <p className="muted" id="emailConsent-hint">
            {messages.booking.emailConsentHint}
          </p>
        </div>
      )}

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
  onChange,
  type = 'text',
  autoComplete,
  inputMode,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly error: string | undefined;
  readonly defaultValue: string;
  readonly onChange: (value: string) => void;
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
        onChange={(event) => onChange(event.target.value)}
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
