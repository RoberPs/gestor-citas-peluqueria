import type { OwnerAppointmentDto } from '@/app/api/gestion/_lib/serializers';
import { messages } from '@/messages/es-ES';

/**
 * 004, FR-020a: the confirmation of this appointment failed for good, so the
 * client has no link but the one on their screen. Said with an icon and words,
 * never by colour alone, beside the phone to call and what to say.
 */
export function ConfirmationFailed({ appointment }: { readonly appointment: OwnerAppointmentDto }) {
  if (appointment.confirmationEmailFailed !== true || appointment.customer === null) return null;
  const T = messages.owner.confirmationEmailFailed;
  const { phone } = appointment.customer;

  return (
    <p className="confirmation-failed">
      <strong>
        <span aria-hidden="true">{T.icon} </span>
        {T.label}
      </strong>
      <br />
      <a className="touch-link" href={`tel:${phone.replace(/[\s.-]/g, '')}`}>
        {phone}
      </a>{' '}
      · {T.hint}
    </p>
  );
}
