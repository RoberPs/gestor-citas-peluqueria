import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { validateContact } from '@/domain/contact/contact';
import { computeStateToken, type ResolutionPlan } from '@/domain/owner/conflict';
import { createOwnerAppointmentWriter } from '@/infrastructure/db/owner-appointment-writer';
import { stateHash } from '@/infrastructure/security/state-hash';
import { closeTestDb, ensureSchema, testPool, truncateAll } from '../helpers/test-db';
import { bookFriday, CORTE, friday, LUIS, NOW, ownerAppointments, seedSalon } from './_owner-fixtures';

/**
 * 002, T109 and T111: a plan is applied whole or not at all (FR-037, SC-006),
 * and a write the EXCLUDE constraint refuses reads as "the state changed"
 * (D-024).
 */

const writer = createOwnerAppointmentWriter(testPool);

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll();
  await seedSalon();
});

function contact() {
  const validated = validateContact(LUIS, { email: 'OPTIONAL' });
  if (!validated.ok) throw new Error('unreachable');
  return validated.value;
}

async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment WHERE id = $1', [id]);
  return rows[0]?.status;
}

describe('a resolution is applied whole or not at all (FR-037, SC-006)', () => {
  it('neither cancels the appointment in the way nor creates the new one when the plan fails halfway', async () => {
    const ana = await bookFriday('15:45', '16:15');
    const conflicts = await ownerAppointments().create({
      serviceIds: [CORTE],
      startsAt: friday('16:00'),
      customer: LUIS,
    });
    if (conflicts.ok || conflicts.error.kind !== 'CONFLICT') throw new Error('expected a conflict');

    // A service that does not exist breaks the insert after the cancellation ran.
    const plan: ResolutionPlan = {
      intent: {
        kind: 'CREATE_APPOINTMENT',
        id: '00000000-0000-4000-8000-0000000000aa',
        startsAt: friday('16:00'),
        endsAt: friday('16:30'),
        services: [{ serviceId: '00000000-0000-4000-8000-0000000000bb', name: 'Fantasma', durationMinutes: 30, priceCents: null }],
        contact: contact(),
        createdAt: NOW,
      },
      cancelAppointments: [ana],
      deletePeriods: [],
      shortenPeriods: [],
      at: NOW,
    };

    await expect(writer.applyPlan(plan, conflicts.error.stateToken)).rejects.toThrow();

    expect(await statusOf(ana)).toBe('CONFIRMED');
    expect(await statusOf('00000000-0000-4000-8000-0000000000aa')).toBeUndefined();
  });

  it('applies both when the plan succeeds (escenario 3)', async () => {
    const ana = await bookFriday('15:45', '16:15');
    const useCase = ownerAppointments();
    const asked = await useCase.create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer: LUIS });
    if (asked.ok || asked.error.kind !== 'CONFLICT') throw new Error('expected a conflict');

    const created = await useCase.create({
      serviceIds: [CORTE],
      startsAt: friday('16:00'),
      customer: LUIS,
      stateToken: asked.error.stateToken,
      resolution: { cancelAppointments: [ana] },
    });

    expect(created.ok).toBe(true);
    const { rows } = await testPool().query('SELECT cancelled_by FROM appointment WHERE id = $1', [ana]);
    expect(rows[0]).toEqual({ cancelled_by: 'OWNER' });
  });

  it('changes nothing when the owner walks away (escenario 2, FR-036)', async () => {
    const ana = await bookFriday('15:45', '16:15');
    await ownerAppointments().create({ serviceIds: [CORTE], startsAt: friday('16:00'), customer: LUIS });

    const { rows } = await testPool().query<{ count: string }>('SELECT count(*) FROM appointment');
    expect(Number(rows[0]?.count)).toBe(1);
    expect(await statusOf(ana)).toBe('CONFIRMED');
  });
});

describe('an exclusion violation is "the state changed" (D-024, T111)', () => {
  it('answers STATE_CHANGED when an online booking commits under the plan, past its re-detection', async () => {
    // An online booking does not take the owner's lock: it is uncommitted, so
    // the re-detection cannot see it, and the insert waits on the constraint.
    const online = await testPool().connect();
    try {
      await online.query('BEGIN');
      await online.query(
        `WITH inserted AS (
           INSERT INTO appointment (id, status, origin, starts_at, ends_at, customer_name, customer_phone,
             customer_email, customer_phone_normalized, customer_email_normalized, token_hash)
           VALUES (gen_random_uuid(), 'CONFIRMED', 'ONLINE', $1, $2, 'Ana López', '600112233',
             'ana@example.com', '+34600112233', 'ana@example.com', sha256(gen_random_uuid()::text::bytea))
           RETURNING id)
         INSERT INTO appointment_service (appointment_id, position, service_id, name, duration_minutes, price_cents)
         SELECT id, 1, $3, 'Corte de pelo', 30, 1800 FROM inserted`,
        [new Date(friday('16:00').epochMilliseconds), new Date(friday('16:30').epochMilliseconds), CORTE],
      );

      const plan: ResolutionPlan = {
        intent: {
          kind: 'CREATE_APPOINTMENT',
          id: '00000000-0000-4000-8000-0000000000cc',
          startsAt: friday('16:15'),
          endsAt: friday('16:45'),
          services: [{ serviceId: CORTE, name: 'Corte de pelo', durationMinutes: 30, priceCents: 1800 }],
          contact: contact(),
          createdAt: NOW,
        },
        cancelAppointments: [],
        deletePeriods: [],
        shortenPeriods: [],
        at: NOW,
      };
      const applying = writer.applyPlan(plan, computeStateToken([], stateHash));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await online.query('COMMIT');

      expect(await applying).toEqual({ ok: false, error: 'STATE_CHANGED' });
      expect(await statusOf('00000000-0000-4000-8000-0000000000cc')).toBeUndefined();
    } finally {
      online.release();
    }
  });
});
