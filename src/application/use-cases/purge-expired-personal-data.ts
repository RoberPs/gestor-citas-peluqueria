import type { Temporal } from '@js-temporal/polyfill';
import type { Clock } from '@/domain/shared/clock';
import type { SalonConfigRepository } from '../ports';

/**
 * Deleting personal data (D-012).
 *
 * Two jobs, one command, because they are the same act with different scopes:
 *
 * - The **nightly sweep** anonymises every appointment past its retention
 *   period (FR-035).
 * - **One appointment by id** is how the owner answers a client who asks for
 *   their data to be deleted. The constitution requires that to be possible and
 *   complete from day one; the screen for it belongs to a later feature, this
 *   does not.
 *
 * Both run as a single `UPDATE`, so there is no moment in which an appointment
 * is anonymised and its link still resolves.
 */

export type PersonalDataPurgePort = {
  anonymizeDueBefore(cutoff: Temporal.Instant): Promise<number>;
  anonymizeOne(id: string): Promise<number>;
  countDueBefore(cutoff: Temporal.Instant): Promise<number>;
  countOne(id: string): Promise<number>;
};

export type PurgeRequest = {
  /** Count what would go, write nothing. */
  readonly dryRun?: boolean;
  /** A single appointment, whatever its age: a deletion on request. */
  readonly appointmentId?: string | undefined;
};

export type PurgeOutcome = {
  readonly cutoff: string | null;
  readonly affected: number;
  readonly dryRun: boolean;
};

export function createPurgeExpiredPersonalData(deps: {
  readonly config: SalonConfigRepository;
  readonly purge: PersonalDataPurgePort;
  readonly clock: Clock;
}) {
  return async function purgeExpiredPersonalData(
    request: PurgeRequest = {},
  ): Promise<PurgeOutcome> {
    const dryRun = request.dryRun === true;

    if (request.appointmentId !== undefined) {
      const affected = dryRun
        ? await deps.purge.countOne(request.appointmentId)
        : await deps.purge.anonymizeOne(request.appointmentId);

      return { cutoff: null, affected, dryRun };
    }

    const { salon, policy } = await deps.config.load();

    // Twelve months is a calendar span, so it is measured on the salon's
    // calendar rather than as a fixed number of days.
    const cutoff = deps.clock
      .now()
      .toZonedDateTimeISO(salon.timezone)
      .subtract({ months: policy.retentionMonths })
      .toInstant();

    const affected = dryRun
      ? await deps.purge.countDueBefore(cutoff)
      : await deps.purge.anonymizeDueBefore(cutoff);

    return { cutoff: cutoff.toString(), affected, dryRun };
  };
}
