import Link from 'next/link';
import { messages } from '@/messages/es-ES';

/**
 * The neutral screen (FR-019, FR-038, D-006).
 *
 * The same words for a link that never existed, one that is malformed, one
 * whose appointment was deleted, one anonymised by retention, and one that hit
 * the per-IP limit. Nothing here hints that those cases are told apart, because
 * anything that did would confirm to whoever is probing links that they had
 * found something.
 */
export default function AppointmentNotFound() {
  return (
    <main>
      <h1>{messages.errors.appointmentNotFound.message}</h1>
      <p>{messages.errors.appointmentNotFound.nextAction}</p>

      <Link className="button" href="/">
        {messages.appointment.bookAnother}
      </Link>
    </main>
  );
}
