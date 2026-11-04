import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, gt, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { AppliedPlan, OwnerAppointmentWriter } from '@/application/ports';
import type { UnavailablePeriod } from '@/domain/catalog/salon';
import { computeStateToken, conflictSpanOf, detectConflicts, ownAppointmentOf, type ResolutionIntent } from '@/domain/owner/conflict';
import { err, ok } from '@/domain/shared/result';
import { stateHash } from '../security/state-hash';
import { dateOf, isExclusionViolation, toDomain, withServices } from './appointment-repository';
import { appointment, appointmentService, schema, unavailablePeriod } from './schema';

/**
 * The owner's changes, each a plan applied whole or not at all (002, D-023).
 *
 * Inside the transaction the conflict is detected again, with the same domain
 * function, and its fingerprint compared with the one the owner answered
 * (D-024). Her writes take one transaction-scoped advisory lock, so two of
 * them never check at the same time; an online booking does not take it, and
 * for that the EXCLUDE constraint is the net. READ COMMITTED is enough.
 */

/** Any constant will do: there is one chair, and one lock for it. */
const OWNER_WRITE_LOCK = 2_002_001;

/** Beyond any position an appointment can have: the first pass of a renumbering. */
const POSITION_OUT_OF_THE_WAY = 10_000;

class StateChanged extends Error {}

type Tx = Parameters<Parameters<ReturnType<typeof drizzle<typeof schema>>['transaction']>[0]>[0];

function instantOf(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

async function inTheWay(tx: Tx, intent: ResolutionIntent) {
  const span = conflictSpanOf(intent);
  if (span === null) return [];
  const from = dateOf(span.startsAt);
  const to = dateOf(span.endsAt);
  const rows = await tx
    .select(withServices)
    .from(appointment)
    .where(and(eq(appointment.status, 'CONFIRMED'), lt(appointment.startsAt, to), gt(appointment.endsAt, from)))
    .orderBy(asc(appointment.startsAt), asc(appointment.id));

  // Two blocks overlapping are harmless, so a new period only meets appointments (D-019).
  const periods: UnavailablePeriod[] =
    intent.kind === 'CREATE_PERIOD'
      ? []
      : (
          await tx
            .select()
            .from(unavailablePeriod)
            .where(and(lt(unavailablePeriod.startsAt, to), gt(unavailablePeriod.endsAt, from)))
        ).map((row) => ({ id: row.id, startsAt: instantOf(row.startsAt), endsAt: instantOf(row.endsAt), reason: row.reason }));

  const exclude = ownAppointmentOf(intent);
  return detectConflicts({
    ...span,
    appointments: rows.map(toDomain),
    periods,
    ...(exclude === undefined ? {} : { excludeAppointmentId: exclude }),
  });
}

async function applyIntent(tx: Tx, intent: ResolutionIntent): Promise<AppliedPlan> {
  switch (intent.kind) {
    case 'CREATE_APPOINTMENT': {
      const { contact } = intent;
      await tx.insert(appointment).values({
        id: intent.id,
        status: 'CONFIRMED',
        // Written by hand: no link for the client, and an origin that never changes (FR-025, FR-026).
        origin: 'OWNER',
        startsAt: dateOf(intent.startsAt),
        endsAt: dateOf(intent.endsAt),
        customerName: contact.name,
        customerPhone: contact.phone,
        customerEmail: contact.email,
        customerPhoneNormalized: contact.normalizedPhone,
        customerEmailNormalized: contact.normalizedEmail,
        tokenHash: null,
        createdAt: dateOf(intent.createdAt),
      });
      await tx.insert(appointmentService).values(
        intent.services.map((service, index) => ({
          appointmentId: intent.id,
          position: index + 1,
          serviceId: service.serviceId,
          name: service.name,
          durationMinutes: service.durationMinutes,
          priceCents: service.priceCents,
        })),
      );
      return { kind: 'APPOINTMENT', appointment: await read(tx, intent.id) };
    }
    case 'RESCHEDULE_APPOINTMENT': {
      // The same row, so its id, origin and link survive the move (FR-039, FR-041).
      const moved = await tx
        .update(appointment)
        .set({ startsAt: dateOf(intent.startsAt), endsAt: dateOf(intent.endsAt) })
        .where(and(eq(appointment.id, intent.appointmentId), eq(appointment.status, 'CONFIRMED')))
        .returning({ id: appointment.id });
      if (moved.length === 0) throw new StateChanged();
      return { kind: 'APPOINTMENT', appointment: await read(tx, intent.appointmentId) };
    }
    case 'EDIT_APPOINTMENT': {
      const { contact } = intent;
      // id, start, origin, booking time and link stay as they were (FR-073).
      const edited = await tx
        .update(appointment)
        .set({
          endsAt: dateOf(intent.endsAt),
          customerName: contact.name,
          customerPhone: contact.phone,
          customerEmail: contact.email,
          customerPhoneNormalized: contact.normalizedPhone,
          customerEmailNormalized: contact.normalizedEmail,
        })
        .where(and(eq(appointment.id, intent.appointmentId), eq(appointment.status, 'CONFIRMED')))
        .returning({ id: appointment.id });
      if (edited.length === 0) throw new StateChanged();

      // The rows that stay are never rewritten, so a price raised since the
      // booking does not creep in (BR-021). Only the ones leaving go, only
      // the new ones come, and `position` is renumbered in two passes —
      // out of the way first, past any real position — because it is part of
      // the primary key and has to stay at least 1.
      const ids = intent.services.map((service) => service.serviceId);
      await tx
        .delete(appointmentService)
        .where(and(eq(appointmentService.appointmentId, intent.appointmentId), notInArray(appointmentService.serviceId, ids)));
      const staying = await tx
        .select({ serviceId: appointmentService.serviceId })
        .from(appointmentService)
        .where(eq(appointmentService.appointmentId, intent.appointmentId));
      await tx
        .update(appointmentService)
        .set({ position: sql`${appointmentService.position} + ${POSITION_OUT_OF_THE_WAY}` })
        .where(eq(appointmentService.appointmentId, intent.appointmentId));
      for (const [index, service] of intent.services.entries()) {
        if (staying.some((row) => row.serviceId === service.serviceId)) {
          await tx
            .update(appointmentService)
            .set({ position: index + 1 })
            .where(
              and(
                eq(appointmentService.appointmentId, intent.appointmentId),
                eq(appointmentService.serviceId, service.serviceId),
              ),
            );
        } else {
          await tx.insert(appointmentService).values({
            appointmentId: intent.appointmentId,
            position: index + 1,
            serviceId: service.serviceId,
            name: service.name,
            durationMinutes: service.durationMinutes,
            priceCents: service.priceCents,
          });
        }
      }
      return { kind: 'APPOINTMENT', appointment: await read(tx, intent.appointmentId) };
    }
    case 'CREATE_PERIOD': {
      const [row] = await tx
        .insert(unavailablePeriod)
        .values({ id: intent.id, startsAt: dateOf(intent.startsAt), endsAt: dateOf(intent.endsAt), reason: intent.reason })
        .returning();
      if (row === undefined) throw new Error('the INSERT returned no row');
      return {
        kind: 'PERIOD',
        period: { id: row.id, startsAt: instantOf(row.startsAt), endsAt: instantOf(row.endsAt), reason: row.reason },
      };
    }
  }
}

async function read(tx: Tx, id: string) {
  const [row] = await tx.select(withServices).from(appointment).where(eq(appointment.id, id));
  if (row === undefined) throw new Error(`Appointment ${id} vanished inside its own transaction`);
  return toDomain(row);
}

export function createOwnerAppointmentWriter(getPool: () => Pool): OwnerAppointmentWriter {
  const database = () => drizzle(getPool(), { schema });

  return {
    async applyPlan(plan, expectedStateToken) {
      try {
        const applied = await database().transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${OWNER_WRITE_LOCK})`);

          const conflicts = await inTheWay(tx, plan.intent);
          if (computeStateToken(conflicts, stateHash) !== expectedStateToken) throw new StateChanged();

          if (plan.cancelAppointments.length > 0) {
            const cancelled = await tx
              .update(appointment)
              .set({ status: 'CANCELLED', cancelledAt: dateOf(plan.at), cancelledBy: 'OWNER' })
              .where(and(inArray(appointment.id, [...plan.cancelAppointments]), eq(appointment.status, 'CONFIRMED')))
              .returning({ id: appointment.id });
            if (cancelled.length !== plan.cancelAppointments.length) throw new StateChanged();
          }
          if (plan.deletePeriods.length > 0) {
            await tx.delete(unavailablePeriod).where(inArray(unavailablePeriod.id, [...plan.deletePeriods]));
          }
          for (const shortening of plan.shortenPeriods) {
            await tx
              .update(unavailablePeriod)
              .set({ startsAt: dateOf(shortening.startsAt), endsAt: dateOf(shortening.endsAt) })
              .where(eq(unavailablePeriod.id, shortening.id));
          }

          return applyIntent(tx, plan.intent);
        });
        return ok(applied);
      } catch (error) {
        if (error instanceof StateChanged || isExclusionViolation(error)) return err('STATE_CHANGED');
        throw error;
      }
    },
  };
}
