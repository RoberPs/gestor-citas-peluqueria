'use client';

import type { cancelAppointment, moveAppointment } from '@/app/gestion/agenda/appointment-actions';
import { messages } from '@/messages/es-ES';
import { AppointmentForm, DayAndTime } from './appointment-form';

/**
 * Moving and cancelling an appointment from the agenda (002, Historia 5).
 * Moving keeps its services, duration, data and link (FR-039, FR-041);
 * cancelling asks first, naming the appointment (FR-040), and is final.
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
