'use client';

import { useState, type FormEvent } from 'react';
import { messages, withMin } from '@/messages/es-ES';

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string; readonly nextAction: string };

/**
 * Changing the password from inside the session (002, FR-004). The minimum is
 * handed down from the domain, never restated here; the server checks it again
 * whatever this form shows.
 */
export function ChangePasswordForm({ minLength }: { readonly minLength: number }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);

    const response = await fetch('/api/gestion/cuenta/contrasena', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: form.get('currentPassword'),
        newPassword: form.get('newPassword'),
      }),
    }).catch(() => null);

    if (response?.status === 401) {
      window.location.assign('/gestion/acceso');
      return;
    }

    if (response?.status === 204) {
      formElement.reset();
      setOutcome({ kind: 'saved' });
    } else {
      const body = (await response?.json().catch(() => null)) as {
        message?: string;
        nextAction?: string;
      } | null;
      setOutcome({
        kind: 'error',
        message: body?.message ?? messages.owner.errors.unexpected.message,
        nextAction: body?.nextAction ?? messages.owner.errors.unexpected.nextAction,
      });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div role="status" aria-live="polite">
        {outcome.kind === 'saved' && (
          <div className="notice">
            <p>{messages.owner.account.saved}</p>
          </div>
        )}
        {outcome.kind === 'error' && (
          <div className="notice-error">
            <p>{outcome.message}</p>
            <p>{outcome.nextAction}</p>
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="currentPassword">{messages.owner.account.current}</label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          className="input"
          autoComplete="current-password"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="newPassword">{messages.owner.account.next}</label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          className="input"
          autoComplete="new-password"
          aria-describedby="newPassword-hint"
          minLength={minLength}
          required
        />
        <p id="newPassword-hint" className="muted">
          {withMin(messages.owner.account.nextHint, minLength)}
        </p>
      </div>

      <button type="submit" className="button" disabled={busy} aria-busy={busy}>
        {busy ? messages.owner.busy : messages.owner.account.submit}
      </button>
    </form>
  );
}
