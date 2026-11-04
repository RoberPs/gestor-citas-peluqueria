'use client';

import type { cancelAppointment, editAppointment, moveAppointment } from '@/app/gestion/agenda/appointment-actions';
import { messages } from '@/messages/es-ES';
import { AppointmentForm, CustomerFields, DayAndTime } from './appointment-form';

/**
 * Moving, editing and cancelling an appointment from the agenda (002,
 * Historias 5 y 11). Moving keeps its services, duration, data and link
 * (FR-039, FR-041); editing keeps its start (FR-073), with the services
 * chosen just above with the picker of 005; cancelling asks first, naming
 * the appointment (FR-040), and is final.
 */

const T = messages.owner.appointments;

export function MoveForm({
  action,
  appointmentId,
  date,
  time,
  closeHref,
}: {
  readonly action: typeof moveAppointment;
  readonly appointmentId: string;
  readonly date: string;
  readonly time: string;
  readonly closeHref: string;
}) {
  return (
    <AppointmentForm
      action={action}
      initialValues={{ cita: appointmentId, fecha: date, hora: time }}
      headingId="action-heading"
      savedMessage={T.moved}
      submitLabel={T.moveSubmit}
      closeHref={closeHref}
    >
      {(values) => (
        <>
          <input type="hidden" name="cita" value={appointmentId} />
          <DayAndTime values={values} />
        </>
      )}
    </AppointmentForm>
  );
}

export function CancelForm({
  action,
  appointmentId,
  question,
  closeHref,
}: {
  readonly action: typeof cancelAppointment;
  readonly appointmentId: string;
  /** Names the appointment: whose, which day, what time (FR-040). */
  readonly question: string;
  readonly closeHref: string;
}) {
  return (
    <AppointmentForm
      action={action}
      initialValues={{ cita: appointmentId }}
      headingId="action-heading"
      savedMessage={T.cancelled}
      submitLabel={T.cancelYes}
      closeHref={closeHref}
      closeLabel={T.cancelNo}
    >
      {() => (
        <div className="notice-warning">
          <p>
            <strong>{question}</strong>
          </p>
          <p>{T.cancelWarning}</p>
          <input type="hidden" name="cita" value={appointmentId} />
          <input type="hidden" name="confirmed" value="true" />
        </div>
      )}
    </AppointmentForm>
  );
}

export function EditForm({
  action,
  appointmentId,
  serviceIds,
  customer,
  endsAt,
  closeHref,
}: {
  readonly action: typeof editAppointment;
  readonly appointmentId: string;
  /** The picker's selection, in catalogue order. */
  readonly serviceIds: readonly string[];
  readonly customer: { readonly name: string; readonly phone: string; readonly email: string | null };
  /** The end the domain works out for that selection; `null` while it is not valid. */
  readonly endsAt: string | null;
  readonly closeHref: string;
}) {
  return (
    <AppointmentForm
      action={action}
      initialValues={{ cita: appointmentId, nombre: customer.name, telefono: customer.phone, email: customer.email ?? '' }}
      headingId="action-heading"
      savedMessage={T.edited}
      submitLabel={T.editSubmit}
      closeHref={closeHref}
    >
      {(values, invalid) => (
        <>
          <input type="hidden" name="cita" value={appointmentId} />
          <input type="hidden" name="serviceIds" value={serviceIds.join(',')} />
          {endsAt !== null && (
            <p aria-live="polite">
              {T.endsAt} <strong>{endsAt}</strong>
            </p>
          )}
          <CustomerFields values={values} invalid={invalid} />
        </>
      )}
    </AppointmentForm>
  );
}
