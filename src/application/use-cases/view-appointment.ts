import type { Appointment, AppointmentView } from '@/domain/booking/appointment';
import { deriveView } from '@/domain/booking/derive-view';
import {
  canCancel,
  canReschedule,
  type ModificationBlock,
} from '@/domain/booking/modification-rules';
import type { BookingPolicy, Salon } from '@/domain/catalog/salon';
import type { Clock } from '@/domain/shared/clock';
import type { AppointmentRepository, SalonConfigRepository, TokenGenerator } from '../ports';

/**
 * Opening the management link (Historia 3 and Historia 4).
 *
 * One use case feeds both the confirmation screen and the later lookup, which
 * is why they can never disagree about what an appointment says (D-010).
 *
 * It returns `null` for every way a link can fail to resolve — unknown,
 * malformed, deleted, anonymised — so the caller has a single case to answer
 * and cannot accidentally tell them apart (FR-019).
 */

export type AppointmentDetail = {
  readonly appointment: Appointment;
  readonly view: AppointmentView;
  readonly salon: Salon;
  readonly policy: BookingPolicy;
  readonly canCancel: boolean;
  readonly canReschedule: boolean;
  /**
   * Why the actions are not available, straight from the domain (FR-028).
   *
   * It is the typed block, not a sentence: the decision is the domain's and the
   * wording is the message catalogue's, so neither is restated in a component.
   */
  readonly block: ModificationBlock | null;
};

export function createViewAppointment(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly tokens: TokenGenerator;
  readonly clock: Clock;
}) {
  return async function viewAppointment(token: string): Promise<AppointmentDetail | null> {
    // The hash is computed for any string at all, so a malformed token takes
    // the same path — and the same time — as a well-formed one (D-006).
    const appointment = await deps.appointments.findByTokenHash(deps.tokens.hash(token));
    if (appointment === null) return null;

    const configuration = await deps.config.load();
    const now = deps.clock.now();

    const cancellable = canCancel(appointment, now, configuration.policy);
    const reschedulable = canReschedule(appointment, now, configuration.policy);

    return {
      appointment,
      view: deriveView(appointment, now),
      salon: configuration.salon,
      policy: configuration.policy,
      canCancel: cancellable.ok,
      canReschedule: reschedulable.ok,
      block: cancellable.ok ? null : cancellable.error,
    };
  };
}
