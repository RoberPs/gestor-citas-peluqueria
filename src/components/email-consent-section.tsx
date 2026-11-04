import { stopEmailsAction } from '@/app/cita/[token]/actions';
import { messages } from '@/messages/es-ES';

/**
 * 004, FR-017: on the appointment screen, while the appointment receives
 * emails, it says so and offers to stop them. A form, so it works without
 * JavaScript; once stopped, the screen comes back without the section and says
 * the appointment did not change.
 */
export function EmailConsentSection({
  token,
  active,
  justStopped,
}: {
  readonly token: string;
  readonly active: boolean;
  readonly justStopped: boolean;
}) {
  const T = messages.appointment.emailNotifications;

  if (!active) {
    return justStopped ? (
      <div className="notice" role="status">
        <p>{T.stopped}</p>
      </div>
    ) : null;
  }

  return (
    <div className="card">
      <p>{T.active}</p>
      <form action={stopEmailsAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="button-secondary">
          {T.stop}
        </button>
      </form>
    </div>
  );
}
