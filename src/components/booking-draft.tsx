'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * What the client has typed so far, kept while they move between days and
 * hours on the booking screens (003, FR-009, D-004).
 *
 * It lives in React state and nowhere else: never in `localStorage`,
 * `sessionStorage`, a cookie or the URL, because a name, a phone and an email
 * left on the device are personal data the salon would be keeping without
 * meaning to (Principio III). A reload or leaving the booking screens drops it.
 */

type Field = 'name' | 'phone' | 'email';
type Draft = Readonly<Record<Field, string>>;

const EMPTY: Draft = { name: '', phone: '', email: '' };

type BookingDraft = {
  readonly draft: Draft;
  readonly update: (field: Field, value: string) => void;
};

const BookingDraftContext = createContext<BookingDraft>({ draft: EMPTY, update: () => {} });

export function BookingDraftProvider({ children }: { readonly children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const update = useCallback((field: Field, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const value = useMemo(() => ({ draft, update }), [draft, update]);

  return <BookingDraftContext.Provider value={value}>{children}</BookingDraftContext.Provider>;
}

export function useBookingDraft(): BookingDraft {
  return useContext(BookingDraftContext);
}
