'use client';

import { useState, type FormEvent } from 'react';
import { messages } from '@/messages/es-ES';

/**
 * The sign-in form (002, Historia 1). It posts to the Route Handler, which is
 * the only one that decides (D-028); on a rejection it shows the one message
 * the server sent, the same whichever field was wrong (FR-008).
 */
export function SignInForm({ next }: { readonly next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; nextAction: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    const response = await fetch('/api/gestion/sesion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    }).catch(() => null);

    if (response?.status === 204) {
      window.location.assign(next);
      return;
    }

    const body = (await response?.json().catch(() => null)) as {
      message?: string;
      nextAction?: string;
    } | null;
    setError({
      message: body?.message ?? messages.owner.errors.unexpected.message,
      nextAction: body?.nextAction ?? messages.owner.errors.unexpected.nextAction,
    });
    setBusy(false);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div role="alert" aria-live="assertive">
        {error !== null && (
          <div className="notice-error">
            <p>{error.message}</p>
            <p>{error.nextAction}</p>
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="username">{messages.owner.signIn.username}</label>
        <input id="username" name="username" className="input" autoComplete="username" required />
      </div>

      <div className="field">
        <label htmlFor="password">{messages.owner.signIn.password}</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
        />
      </div>

      <button type="submit" className="button" disabled={busy} aria-busy={busy}>
        {busy ? messages.owner.signIn.submitting : messages.owner.signIn.submit}
      </button>
    </form>
  );
}
