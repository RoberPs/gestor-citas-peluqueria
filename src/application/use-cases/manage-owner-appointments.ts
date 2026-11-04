import { randomUUID } from 'node:crypto';
import type { Temporal } from '@js-temporal/polyfill';
import { openingOf } from '@/domain/availability/compute-range';
import { durationOf, type Appointment, type AppointmentId } from '@/domain/booking/appointment';
import { durationOfServices, selectServices, type SelectionError } from '@/domain/catalog/selection';
import { validateContact, type ContactFieldError, type RawContact } from '@/domain/contact/contact';
import { applyOwnerCancellation, checkOwnerCanChange, type OwnerChangeBlock } from '@/domain/owner/cancellation';
import { planManualBooking, type ManualBookingBlocker } from '@/domain/owner/manual-booking';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import { addMinutes, localDateOf } from '@/domain/shared/time';
import type {
  AppliedPlan,
  AppointmentRepository,
  OwnerAppointmentWriter,
  SalonConfigRepository,
  StateHasher,
  UnavailablePeriodRepository,
} from '../ports';
import { proposeOrApply, withReplanning, type OwnerAnswer, type ProtocolRejection } from './owner-change-protocol';

/**
 * The owner's appointments, from the agenda (002, Historias 4, 5 y 6).
 *
 * Writing one by hand and moving one go through the two-step protocol: what is
 * in the way is named before anything is touched, and the answer is applied
 * as one plan (D-023). Cancelling has nothing to get in the way of, so it is
 * one step, with no deadline (BR-007).
 */

export type OwnerAppointmentSaved = {
  readonly appointment: Appointment;
  readonly now: Temporal.Instant;
  readonly timezone: string;
  /** Whom the owner calls: the client has a link and v1 tells them nothing (FR-043). */
  readonly notifyCustomer: { readonly phone: string } | null;
};

export type OwnerAppointmentFailure =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'INVALID_SELECTION'; readonly error: SelectionError }
  | { readonly kind: 'INVALID_CONTACT'; readonly fields: readonly ContactFieldError[] }
  | { readonly kind: 'BLOCKED'; readonly reason: ManualBookingBlocker | OwnerChangeBlock }
  | (ProtocolRejection & { readonly timezone: string })
  /** The state changed twice in a row under the owner's answer. */
  | { readonly kind: 'STATE_CHANGED' };

type Deps = {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly periods: UnavailablePeriodRepository;
  readonly writer: OwnerAppointmentWriter;
  readonly stateHash: StateHasher;
  readonly clock: Clock;
};

type Attempt = Result<
  AppliedPlan,
  | ProtocolRejection
  | { readonly kind: 'STATE_CHANGED' }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'BLOCKED'; readonly reason: ManualBookingBlocker | OwnerChangeBlock }
>;

function notifyCustomerOf(appointment: Appointment): OwnerAppointmentSaved['notifyCustomer'] {
  return appointment.origin === 'ONLINE' && appointment.customer !== null ? { phone: appointment.customer.phone } : null;
}

export function createManageOwnerAppointments(deps: Deps) {
  async function inTheWay(startsAt: Temporal.Instant, endsAt: Temporal.Instant) {
    return Promise.all([
      deps.appointments.findInWindow(startsAt, endsAt, { includeCancelled: false }),
      deps.periods.findOverlapping(startsAt, endsAt),
    ]);
  }

  function settled(result: Attempt, timezone: string): Result<OwnerAppointmentSaved, OwnerAppointmentFailure> {
    if (!result.ok) {
      const failure = result.error;
      return err(failure.kind === 'CONFLICT' || failure.kind === 'RESOLUTION_REJECTED' ? { ...failure, timezone } : failure);
    }
    if (result.value.kind !== 'APPOINTMENT') throw new Error('an appointment plan applied something else');
    const { appointment } = result.value;
    return ok({ appointment, now: deps.clock.now(), timezone, notifyCustomer: notifyCustomerOf(appointment) });
  }

  return {
    /** Historia 4: written by hand, with the owner's exemptions (D-025). */
    async create(
      input: {
        readonly serviceIds: readonly string[];
        readonly startsAt: Temporal.Instant;
        readonly customer: RawContact;
      } & OwnerAnswer,
    ): Promise<Result<OwnerAppointmentSaved, OwnerAppointmentFailure>> {
      const configuration = await deps.config.load();
      const { timezone } = configuration.salon;

      const selection = selectServices(configuration.services, input.serviceIds);
      if (!selection.ok) return err({ kind: 'INVALID_SELECTION', error: selection.error });

      // By hand the email is optional: the phone is what the salon calls (FR-024).
      const contact = validateContact(input.customer, { email: 'OPTIONAL' });
      if (!contact.ok) return err({ kind: 'INVALID_CONTACT', fields: contact.error });

      const { services } = selection.value;
      const id = randomUUID();
      const endsAt = addMinutes(input.startsAt, durationOfServices(services));
      const opening = openingOf(localDateOf(input.startsAt, timezone), configuration.schedule).openingIntervals;

      const result: Attempt = await withReplanning(input, async (answer): Promise<Attempt> => {
        const now = deps.clock.now();
        const [[appointments, unavailablePeriods], counts] = await Promise.all([
          inTheWay(input.startsAt, endsAt),
          deps.appointments.countFutureByContact(contact.value.normalizedPhone, contact.value.normalizedEmail, now),
        ]);

        const plan = planManualBooking({
          startsAt: input.startsAt,
          services,
          openingIntervals: opening,
          appointments,
          unavailablePeriods,
          futureCountsForContact: counts,
          now,
          policy: configuration.policy,
          timezone,
        });
        if (!plan.ok) return err({ kind: 'BLOCKED', reason: plan.error });

        return proposeOrApply(deps, {
          intent: {
            kind: 'CREATE_APPOINTMENT',
            id,
            startsAt: plan.value.startsAt,
            endsAt: plan.value.endsAt,
            services,
            contact: contact.value,
            createdAt: now,
          },
          conflicts: plan.value.conflicts,
          warnings: plan.value.warnings,
          answer,
          now,
          timezone,
        });
      });

      return settled(result, timezone);
    },

    /**
     * Historia 5: the same services, the same total duration — the sum of its
     * snapshots, never today's catalogue (FR-039, BR-020) — and its link alive.
     */
    async reschedule(
      input: { readonly id: AppointmentId; readonly startsAt: Temporal.Instant } & OwnerAnswer,
    ): Promise<Result<OwnerAppointmentSaved, OwnerAppointmentFailure>> {
      const configuration = await deps.config.load();
      const { timezone } = configuration.salon;
      const opening = openingOf(localDateOf(input.startsAt, timezone), configuration.schedule).openingIntervals;

      const result: Attempt = await withReplanning(input, async (answer): Promise<Attempt> => {
        const current = await deps.appointments.findById(input.id);
        if (current === null) return err({ kind: 'NOT_FOUND' });

        const now = deps.clock.now();
        const changeable = checkOwnerCanChange(current, now);
        if (!changeable.ok) return err({ kind: 'BLOCKED', reason: changeable.error });

        const endsAt = addMinutes(input.startsAt, durationOf(current));
        const [appointments, unavailablePeriods] = await inTheWay(input.startsAt, endsAt);
        const plan = planManualBooking({
          startsAt: input.startsAt,
          services: current.services,
          openingIntervals: opening,
          appointments,
          unavailablePeriods,
          futureCountsForContact: null,
          excludeAppointmentId: current.id,
          now,
          policy: configuration.policy,
          timezone,
        });
        if (!plan.ok) return err({ kind: 'BLOCKED', reason: plan.error });

        return proposeOrApply(deps, {
          intent: {
            kind: 'RESCHEDULE_APPOINTMENT',
            appointmentId: current.id,
            startsAt: plan.value.startsAt,
            endsAt: plan.value.endsAt,
          },
          conflicts: plan.value.conflicts,
          warnings: plan.value.warnings,
          answer,
          now,
          timezone,
        });
      });

      return settled(result, timezone);
    },

    /** Historia 5: any confirmed appointment not yet over, with no deadline (BR-007, FR-040a). */
    async cancel(id: AppointmentId): Promise<Result<OwnerAppointmentSaved, OwnerAppointmentFailure>> {
      const [current, configuration] = await Promise.all([deps.appointments.findById(id), deps.config.load()]);
      if (current === null) return err({ kind: 'NOT_FOUND' });

      const now = deps.clock.now();
      const cancellable = applyOwnerCancellation(current, now);
      if (!cancellable.ok) return err({ kind: 'BLOCKED', reason: cancellable.error });

      const persisted = await deps.appointments.cancel(id, now, 'OWNER');
      // Cancelled by someone else between the read and the write: final either way (BR-008).
      if (!persisted.ok) return err({ kind: 'BLOCKED', reason: 'ALREADY_CANCELLED' });

      return ok({
        appointment: persisted.value,
        now,
        timezone: configuration.salon.timezone,
        notifyCustomer: notifyCustomerOf(persisted.value),
      });
    },
  };
}
