'use client';

import { useState } from 'react';
import { messages } from '@/messages/es-ES';

/**
 * Signing out (002, FR-006). A full navigation afterwards, not a client-side
 * one: no screen of the owner's side stays in memory to come back with the
 * browser's Back button.
 */
export function SignOutButton({ className = 'button-secondary' }: { readonly className?: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch('/api/gestion/sesion', { method: 'DELETE' }).catch(() => undefined);
    window.location.replace('/gestion/acceso');
  }

  return (
    <button type="button" className={className} onClick={signOut} disabled={busy} aria-busy={busy}>
      {busy ? messages.owner.busy : messages.owner.nav.signOut}
    </button>
  );
}
