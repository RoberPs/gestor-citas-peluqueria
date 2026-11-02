import type { ReactNode } from 'react';

/**
 * The two booking screens, `/` and `/reservar`, grouped so that whatever they
 * share lives exactly as long as the client stays on them. The group adds no
 * segment to any URL.
 */
export default function BookingLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
