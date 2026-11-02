import Link from 'next/link';
import { cancelAppointmentAction } from '@/app/cita/[token]/actions';
import { messages } from '@/messages/es-ES';

/**
 * The explicit confirmation FR-022 asks for.
 *
 * It is a second screen state rather than a JavaScript dialog: a client with no
 * JavaScript still gets asked, and a screen reader meets an ordinary heading
 * and two buttons instead of a widget that has to announce itself.
 */
export function CancelDialog({
  token,
  confirming,
}: {
  readonly token: string;
  readonly confirming: boolean;
}) {
  if (!confirming) {
    return (
      <Link className="button-secondary" href={`/cita/${token}?cancelar=1`}>
        {messages.appointment.cancelAction}
      </Link>
    );
  }

  return (
    <section aria-labelledby="cancel-heading" className="notice-warning confirm-panel">
      <h3 id="cancel-heading">{messages.cancellation.confirmTitle}</h3>
      <p>{messages.cancellation.confirmQuestion}</p>
      <p>{messages.cancellation.confirmWarning}</p>

      <div className="actions">
        <form action={cancelAppointmentAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="confirmed" value="true" />
          <button type="submit" className="button">
            {messages.cancellation.confirmYes}
          </button>
        </form>

        <Link className="button-secondary" href={`/cita/${token}`}>
          {messages.cancellation.confirmNo}
        </Link>
      </div>
    </section>
  );
}
