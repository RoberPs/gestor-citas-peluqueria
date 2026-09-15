import { Temporal } from '@js-temporal/polyfill';
import type { Appointment, AppointmentView } from './appointment';

/**
 * The state the client is shown (FR-031).
 *
 * `COMPLETED` is derived here and nowhere else. It is not a persisted state and
 * nothing in this system assigns it: the moment it became a row, somebody would
 * have to run a job to keep it true, and the agenda would show a stale state
 * whenever that job was late.
 */
export function deriveView(appointment: Appointment, now: Temporal.Instant): AppointmentView {
  if (appointment.status === 'CANCELLED') return 'CANCELLED';

  // The appointment is over the instant it ends, not the minute after.
  return Temporal.Instant.compare(now, appointment.endsAt) >= 0 ? 'COMPLETED' : 'CONFIRMED';
}
