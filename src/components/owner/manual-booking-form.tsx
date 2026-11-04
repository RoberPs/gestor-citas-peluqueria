'use client';

import type { createAppointment } from '@/app/gestion/agenda/appointment-actions';
import { messages } from '@/messages/es-ES';
import { AppointmentForm, CustomerFields, DayAndTime } from './appointment-form';

/**
 * Writing an appointment by hand from the agenda (002, Historia 4). The
 * services are chosen just above with the picker of 005, which shows their
 * total duration as the domain sums it; this form carries that choice, the
 * day and time on the 15 minute grid, and the client's name, phone and
 * optional email (FR-024, FR-027). The tap on a free stretch, a service, the
 * data and «Guardar»: four gestures from the agenda (SC-002).
 */

const T = messages.owner.appointments;

export function ManualBookingForm({
  action,
  date,
  time,
  serviceIds,
  closeHref,
}: {
  readonly action: typeof createAppointment;
  readonly date: string;
  readonly time: string;
  /** The picker's selection, in catalogue order. */
  readonly serviceIds: readonly string[];
  readonly closeHref: string;
}) {
  return (
    <AppointmentForm
      action={action}
      initialValues={{ fecha: date, hora: time, nombre: '', telefono: '', email: '' }}
      headingId="action-heading"
      savedMessage={T.created}
      submitLabel={T.create}
      closeHref={closeHref}
    >
      {(values, invalid) => (
        <>
          <input type="hidden" name="serviceIds" value={serviceIds.join(',')} />
          <DayAndTime values={values} />
          <CustomerFields values={values} invalid={invalid} />
        </>
      )}
    </AppointmentForm>
  );
}
