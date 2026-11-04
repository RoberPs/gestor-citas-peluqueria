import 'dotenv/config';
import { Pool } from 'pg';
import { createDispatchNotifications } from '../src/application/use-cases/dispatch-notifications';
import { createNotificationRepository } from '../src/infrastructure/db/notification-repository';
import { createSalonConfigRepository } from '../src/infrastructure/db/salon-config-repository';
import { confirmationEmailRenderer } from '../src/infrastructure/notifications/confirmation-email';
import { emailNotifier, emailTokenSealer } from '../src/infrastructure/notifications/email-channel';
import { env } from '../src/infrastructure/config/env';
import { systemClock } from '../src/infrastructure/time/system-clock';

/**
 * The dispatch command (004, D-003). A cron entry runs it every minute:
 *
 *   npm run notifications:dispatch
 *
 * It sends every pending notification whose next attempt has come, with the
 * system clock. The first attempt of each one already ran right after its
 * booking; this picks up the retries and whatever that first attempt missed.
 *
 * It prints counts and ids, never an address, a name or a link (FR-022). An
 * unexpected error ends it with a non-zero code, so cron says so.
 */

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

if (env().notifications.email === null) {
  console.log('the email channel is off (NOTIFICATIONS_EMAIL=off): nothing to dispatch.');
  process.exit(0);
}

const pool = new Pool({ connectionString, max: 2 });

try {
  const dispatch = createDispatchNotifications({
    config: createSalonConfigRepository(() => pool),
    notifications: createNotificationRepository(() => pool, emailTokenSealer),
    notifier: emailNotifier,
    render: confirmationEmailRenderer,
    clock: systemClock,
  });

  const { counts, reports } = await dispatch.dispatchDue();

  for (const report of reports) {
    console.log(`${report.notificationId} appointment ${report.appointmentId}: ${report.status} (attempt ${report.attempts})`);
  }
  console.log(
    `dispatched ${reports.length} notification(s): ${counts.SENT} sent, ${counts.PENDING} to retry, ` +
      `${counts.FAILED} failed, ${counts.NOT_SENT} not sent.`,
  );
} catch (error) {
  console.error(`dispatch failed: ${error instanceof Error ? error.constructor.name : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
