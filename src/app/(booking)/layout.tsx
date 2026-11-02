import type { ReactNode } from 'react';
import { BookingDraftProvider } from '@/components/booking-draft';

/**
 * The two booking screens, `/` and `/reservar`, grouped so that the draft of
 * the form lives exactly as long as the client stays on them: it survives a
 * change of day or hour and is gone once the booking is confirmed (003, D-004).
 * The group adds no segment to any URL.
 */
export default function BookingLayout({ children }: { readonly children: ReactNode }) {
  return <BookingDraftProvider>{children}</BookingDraftProvider>;
}
