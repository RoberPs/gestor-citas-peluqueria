import type { Temporal } from '@js-temporal/polyfill';
import type { NotificationId } from '@/domain/notifications/consent';
import { confirmationContent } from '@/domain/notifications/confirmation-content';
import { decideDelivery, nextAttemptAt } from '@/domain/notifications/delivery';
import type { Clock } from '@/domain/shared/clock';
import type {
  ConfirmationEmailRenderer,
  NotificationOutcome,
  NotificationRepository,
  NotificationWork,
  Notifier,
  SalonConfigRepository,
} from '../ports';

/**
 * Sending the confirmation (004, Historia 1 and Historia 3).
 *
 * `dispatchOne` is the first attempt, right after the booking answers;
 * `dispatchDue` is the command the cron runs every minute (D-003). Both take
 * the same path: the domain decides with the appointment as it is now
 * (FR-008), and only a `SEND` reaches the provider. A failure here never
 * touches the appointment (FR-010): the worst it does is mark the
 * notification as failed.
 */

/**
 * What an attempt came to, for the caller to log. Ids, the state and the
 * attempt number, and nothing else (FR-020, FR-022).
 */
export type DispatchReport = {
  readonly notificationId: NotificationId;
  readonly appointmentId: string;
  readonly status: NotificationOutcome['status'];
  readonly attempts: number;
};

export type DispatchCounts = Readonly<Record<NotificationOutcome['status'], number>>;

export function createDispatchNotifications(deps: {
  readonly config: SalonConfigRepository;
  readonly notifications: NotificationRepository;
  readonly notifier: Notifier;
  readonly render: ConfirmationEmailRenderer;
  readonly clock: Clock;
}) {
  async function attempt(work: NotificationWork, now: Temporal.Instant): Promise<NotificationOutcome> {
    const decision = decideDelivery({
      appointment: work.appointment,
      consent: work.consent,
      notification: work.notification,
      now,
    });

    switch (decision.kind) {
      case 'SKIP':
        return { status: 'NOT_SENT', attempted: false, reason: decision.reason };
      case 'EXPIRED':
        return { status: 'FAILED', attempted: false };
      case 'SEND':
        break;
    }

    const to = work.appointment.customer?.email ?? null;
    // Tokens that cannot be opened — a rotated key — leave an email that
    // cannot be written; trying again would not change that.
    if (work.tokens === null || to === null) return { status: 'FAILED', attempted: false };

    const { salon, policy } = await deps.config.load();
    const content = confirmationContent(work.appointment, salon, policy);
    if (!content.ok) return { status: 'NOT_SENT', attempted: false, reason: 'PERSONAL_DATA_DELETED' };

    const sent = await deps.notifier.send(
      { channel: 'EMAIL', to, fromName: salon.name, ...deps.render(content.value, work.tokens) },
      work.notification.id,
    );
    if (sent.ok) return { status: 'SENT', attempted: true };
    if (sent.error === 'PERMANENT') return { status: 'FAILED', attempted: true };

    const next = nextAttemptAt(work.notification.createdAt, now);
    return next === null
      ? { status: 'FAILED', attempted: true }
      : { status: 'PENDING', attempted: true, nextAttemptAt: next };
  }

  function reportOf(work: NotificationWork, outcome: NotificationOutcome): DispatchReport {
    return {
      notificationId: work.notification.id,
      appointmentId: work.notification.appointmentId,
      status: outcome.status,
      attempts: work.notification.attempts + (outcome.attempted ? 1 : 0),
    };
  }

  return {
    /** The first attempt. `null` when it is no longer pending or another process holds it. */
    async dispatchOne(id: NotificationId): Promise<DispatchReport | null> {
      const now = deps.clock.now();
      let report: DispatchReport | null = null;
      await deps.notifications.withOne(id, now, async (work) => {
        const outcome = await attempt(work, now);
        report = reportOf(work, outcome);
        return outcome;
      });
      return report;
    },

    /** The cron's run: every notification whose next attempt has come. */
    async dispatchDue(limit = 100): Promise<{ readonly counts: DispatchCounts; readonly reports: readonly DispatchReport[] }> {
      const now = deps.clock.now();
      const reports: DispatchReport[] = [];
      await deps.notifications.withDue(now, limit, async (work) => {
        const outcome = await attempt(work, now);
        reports.push(reportOf(work, outcome));
        return outcome;
      });

      const counts = { PENDING: 0, SENT: 0, FAILED: 0, NOT_SENT: 0 };
      for (const report of reports) counts[report.status] += 1;
      return { counts, reports };
    },
  };
}
