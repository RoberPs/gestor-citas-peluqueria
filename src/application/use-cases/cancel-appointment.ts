import { applyCancellation } from '@/domain/booking/cancel';
import { deriveView } from '@/domain/booking/derive-view';
import type { ModificationBlock } from '@/domain/booking/modification-rules';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import type { AppointmentRepository, SalonConfigRepository, TokenGenerator } from '../ports';
import type { AppointmentDetail } from './view-appointment';

/**
 * Cancelling from the management link (Historia 5).
 *
 * The slot is free the instant this is committed: the exclusion constraint only
 * holds confirmed appointments, so no separate release step exists to be
 * forgotten (BR-005, FR-023).
 */

export type CancelFailure =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'BLOCKED'; readonly block: ModificationBlock };

export function createCancelAppointment(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly tokens: TokenGenerator;
  readonly clock: Clock;
}) {
  return async function cancelAppointment(
    token: string,
  ): Promise<Result<AppointmentDetail, CancelFailure>> {
    const appointment = await deps.appointments.findByTokenHash(deps.tokens.hash(token));
    if (appointment === null) return err({ kind: 'NOT_FOUND' });

    const configuration = await deps.config.load();
    const now = deps.clock.now();

    const cancellable = applyCancellation(appointment, now, configuration.policy);
    if (!cancellable.ok) return err({ kind: 'BLOCKED', block: cancellable.error });

    const persisted = await deps.appointments.cancel(appointment.id, now, 'CUSTOMER');

    // Somebody cancelled it between the read and the write. The domain already
    // has a word for that, so the race reads like every other rejection.
    if (!persisted.ok) return err({ kind: 'BLOCKED', block: { kind: 'ALREADY_CANCELLED' } });

    return ok({
      appointment: persisted.value,
      view: deriveView(persisted.value, now),
      salon: configuration.salon,
      policy: configuration.policy,
      // Cancelled is terminal: nothing further is on offer (BR-007).
      canCancel: false,
      canReschedule: false,
      block: { kind: 'ALREADY_CANCELLED' },
    });
  };
}
