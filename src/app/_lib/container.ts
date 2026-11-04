import { createAuthorizeOwnerSession } from '@/application/use-cases/authorize-owner-session';
import { createCancelAppointment } from '@/application/use-cases/cancel-appointment';
import { createChangeOwnerPassword } from '@/application/use-cases/change-owner-password';
import { createConfirmBooking } from '@/application/use-cases/confirm-booking';
import { createDispatchNotifications } from '@/application/use-cases/dispatch-notifications';
import { createGetAgendaDay } from '@/application/use-cases/get-agenda-day';
import { createGetAvailability } from '@/application/use-cases/get-availability';
import { createListBookings } from '@/application/use-cases/list-bookings';
import { createListServices } from '@/application/use-cases/list-services';
import { createManageOwnerAppointments } from '@/application/use-cases/manage-owner-appointments';
import { createManageUnavailablePeriods } from '@/application/use-cases/manage-unavailable-periods';
import { createRescheduleAppointment } from '@/application/use-cases/reschedule-appointment';
import { createRevokeEmailConsent } from '@/application/use-cases/revoke-email-consent';
import { createSignInOwner } from '@/application/use-cases/sign-in-owner';
import { createSignOutOwner } from '@/application/use-cases/sign-out-owner';
import { createViewAppointment } from '@/application/use-cases/view-appointment';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createBookingListReader } from '@/infrastructure/db/booking-list-reader';
import { pool } from '@/infrastructure/db/client';
import { createConsentRepository } from '@/infrastructure/db/consent-repository';
import { createNotificationRepository } from '@/infrastructure/db/notification-repository';
import { createOwnerAppointmentWriter } from '@/infrastructure/db/owner-appointment-writer';
import { createOwnerAccountRepository } from '@/infrastructure/db/owner-account-repository';
import { createOwnerSessionRepository } from '@/infrastructure/db/owner-session-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { logger } from '@/infrastructure/logging/logger';
import { createChannelSettings } from '@/infrastructure/notifications/channel-settings';
import { confirmationEmailRenderer } from '@/infrastructure/notifications/confirmation-email';
import { emailNotifier, emailTokenSealer } from '@/infrastructure/notifications/email-channel';
import { passwordHasher } from '@/infrastructure/security/password';
import { stateHash } from '@/infrastructure/security/state-hash';
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
  const writer = createOwnerAppointmentWriter(pool);
  // 002: the owner's side. Sessions reuse the management link's generator —
  // 32 bytes of CSPRNG and their SHA-256 (D-005, D-015).
  const owner = {
    accounts: createOwnerAccountRepository(pool),
    sessions: createOwnerSessionRepository(pool),
    passwords: passwordHasher,
    tokens: tokenGenerator,
    clock: systemClock,
  };
  // 004: the confirmation by email, from the booking to the provider.
  const consents = createConsentRepository(pool);
  const notifications = { channels: createChannelSettings(), sealer: emailTokenSealer };
  const dispatch = createDispatchNotifications({
    config,
    notifications: createNotificationRepository(pool, emailTokenSealer),
    notifier: emailNotifier,
    render: confirmationEmailRenderer,
    clock: systemClock,
  });

  return {
    config,
    appointments,
    notificationChannels: notifications.channels,
    clock: systemClock,
    listServices: createListServices({ config }),
    getAvailability: createGetAvailability({ config, appointments, periods, clock: systemClock }),
    confirmBooking: createConfirmBooking({
      config,
      appointments,
      periods,
      tokens: tokenGenerator,
      clock: systemClock,
      notifications,
    }),
    /**
     * The first attempt of a confirmation, run by `after()` once the booking
     * has answered (D-003). It never throws: whatever goes wrong, the dispatch
     * command picks the notification up on its next run. The log carries ids,
     * the state and the attempt, and nothing else (FR-022).
     */
    async sendConfirmation(notificationId: string): Promise<void> {
      try {
        const report = await dispatch.dispatchOne(notificationId);
        if (report !== null) logger().info(report, 'confirmation email attempted');
      } catch (error) {
        logger().error({ notificationId, err: error }, 'confirmation email attempt failed');
      }
    },
    revokeEmailConsent: createRevokeEmailConsent({
      config,
      appointments,
      consents,
      tokens: tokenGenerator,
      clock: systemClock,
    }),
    viewAppointment: createViewAppointment({
      config,
      appointments,
      tokens: tokenGenerator,
      clock: systemClock,
      consents,
    }),
    cancelAppointment: createCancelAppointment({
      config,
      appointments,
      tokens: tokenGenerator,
      clock: systemClock,
      consents,
    }),
    signInOwner: createSignInOwner(owner),
    signOutOwner: createSignOutOwner(owner),
    authorizeOwnerSession: createAuthorizeOwnerSession(owner),
    changeOwnerPassword: createChangeOwnerPassword(owner),
    getAgendaDay: createGetAgendaDay({ config, appointments, periods, clock: systemClock }),
    listBookings: createListBookings({
      config,
      bookings: createBookingListReader(pool),
      clock: systemClock,
    }),
    unavailablePeriods: createManageUnavailablePeriods({
      config,
      appointments,
      periods,
      writer,
      stateHash,
      clock: systemClock,
    }),
    ownerAppointments: createManageOwnerAppointments({
      config,
      appointments,
      periods,
      writer,
      stateHash,
      clock: systemClock,
    }),
    rescheduleAppointment: createRescheduleAppointment({
      config,
      appointments,
      periods,
      tokens: tokenGenerator,
      clock: systemClock,
      consents,
    }),
  };
}

export function container(): Container {
  globalForContainer.__salonContainer ??= build();
  return globalForContainer.__salonContainer;
}
