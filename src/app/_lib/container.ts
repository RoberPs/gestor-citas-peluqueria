import { createCancelAppointment } from '@/application/use-cases/cancel-appointment';
import { createConfirmBooking } from '@/application/use-cases/confirm-booking';
import { createGetAvailability } from '@/application/use-cases/get-availability';
import { createListServices } from '@/application/use-cases/list-services';
import { createRescheduleAppointment } from '@/application/use-cases/reschedule-appointment';
import { createViewAppointment } from '@/application/use-cases/view-appointment';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { pool } from '@/infrastructure/db/client';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { tokenGenerator } from '@/infrastructure/security/token';
import { systemClock } from '@/infrastructure/time/system-clock';

/**
 * The composition root: the one place where use cases meet adapters.
 *
 * Everything above this line is wired by hand and knows only ports, which is
 * what keeps `application` and `domain` free of Next, Drizzle and `pg`.
 */

const globalForContainer = globalThis as unknown as { __salonContainer?: Container };

type Container = ReturnType<typeof build>;

function build() {
  const config = createSalonConfigRepository(pool);
  const appointments = createAppointmentRepository(pool);
  const periods = createUnavailablePeriodRepository(pool);

  return {
    config,
    appointments,
    clock: systemClock,
    listServices: createListServices({ config }),
    getAvailability: createGetAvailability({ config, appointments, periods, clock: systemClock }),
    confirmBooking: createConfirmBooking({
      config,
      appointments,
      periods,
      tokens: tokenGenerator,
      clock: systemClock,
    }),
    viewAppointment: createViewAppointment({
      config,
      appointments,
      tokens: tokenGenerator,
      clock: systemClock,
    }),
    cancelAppointment: createCancelAppointment({
      config,
      appointments,
      tokens: tokenGenerator,
      clock: systemClock,
    }),
    rescheduleAppointment: createRescheduleAppointment({
      config,
      appointments,
      periods,
      tokens: tokenGenerator,
      clock: systemClock,
    }),
  };
}

export function container(): Container {
  globalForContainer.__salonContainer ??= build();
  return globalForContainer.__salonContainer;
}
