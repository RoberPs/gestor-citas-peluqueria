import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPurgeExpiredPersonalData } from '@/application/use-cases/purge-expired-personal-data';
import { createViewAppointment } from '@/application/use-cases/view-appointment';
import type { Clock } from '@/domain/shared/clock';
import {
  createAppointmentRepository,
  createPersonalDataPurge,
} from '@/infrastructure/db/appointment-repository';
import { createConsentRepository } from '@/infrastructure/db/consent-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { generate, tokenGenerator } from '@/infrastructure/security/token';
import {
  closeTestDb,
  ensureSchema,
  insertAppointmentRow,
  insertEmailConfirmation,
  testPool,
  truncateAppointments,
} from '../helpers/test-db';
import { CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * FR-035 and FR-035a: the person goes, the occupancy stays, and the link dies
 * in the same statement.
 *
 * The `--appointment` case is what covers the constitution's requirement that
 * deletion on request be possible and complete from day one.
 */

const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');
const clock: Clock = { now: () => NOW };

type Row = {
  id: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
  service_name: string;
  service_duration_minutes: number;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_phone_normalized: string | null;
  customer_email_normalized: string | null;
  token_hash: Buffer | null;
  anonymized_at: Date | null;
};

function build() {
  const config = createSalonConfigRepository(() => testPool());

  return {
    purge: createPurgeExpiredPersonalData({
      config,
      purge: createPersonalDataPurge(() => testPool()),
      clock,
    }),
    viewAppointment: createViewAppointment({
      config,
      appointments: createAppointmentRepository(() => testPool()),
      tokens: tokenGenerator,
      clock,
    }),
  };
}

let useCases: ReturnType<typeof build>;

/** Writes an appointment at an arbitrary moment, past or future. */
async function insertAppointment(startsAt: string): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const { token, hash } = generate();

  const start = new Date(startsAt);
  await insertAppointmentRow(
    {
      id,
      status: 'CONFIRMED',
      starts_at: start,
      ends_at: new Date(start.getTime() + 30 * 60_000),
      customer_name: 'Ana López',
      customer_phone: '600112233',
      customer_email: 'ana@example.com',
      customer_phone_normalized: '+34600112233',
      customer_email_normalized: 'ana@example.com',
      token_hash: Buffer.from(hash),
      created_at: start,
    },
    { serviceId: CORTE, name: 'Corte', durationMinutes: 30, priceCents: 1800 },
  );

  return { id, token };
}

async function rowOf(id: string): Promise<Row | undefined> {
  const { rows } = await testPool().query<Row>(
    `SELECT a.*, s.name AS service_name, s.duration_minutes AS service_duration_minutes
       FROM appointment a JOIN appointment_service s ON s.appointment_id = a.id
      WHERE a.id = $1`,
    [id],
  );
  return rows[0];
}

beforeAll(async () => {
  await ensureSchema();
  await seedContractDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  useCases = build();
});

describe('the nightly sweep (FR-035)', () => {
  it('anonymises appointments older than twelve months and leaves the rest', async () => {
    const old = await insertAppointment('2025-01-10T10:00:00Z');
    const recent = await insertAppointment('2026-06-10T10:00:00Z');

    const outcome = await useCases.purge();

    expect(outcome.affected).toBe(1);
    expect((await rowOf(old.id))?.anonymized_at).not.toBeNull();
    expect((await rowOf(recent.id))?.anonymized_at).toBeNull();
  });

  it('leaves an appointment one day short of the boundary alone', async () => {
    const almost = await insertAppointment('2025-09-16T10:00:00Z');

    await useCases.purge();

    expect((await rowOf(almost.id))?.customer_name).toBe('Ana López');
  });

  it('strips the three fields, their canonical forms and the token hash', async () => {
    const old = await insertAppointment('2025-01-10T10:00:00Z');

    await useCases.purge();
    const row = await rowOf(old.id);

    expect(row?.customer_name).toBeNull();
    expect(row?.customer_phone).toBeNull();
    expect(row?.customer_email).toBeNull();
    expect(row?.customer_phone_normalized).toBeNull();
    expect(row?.customer_email_normalized).toBeNull();
    expect(row?.token_hash).toBeNull();
  });

  it('leaves nothing of the name to search by, either (002, D-036)', async () => {
    const old = await insertAppointment('2025-01-10T10:00:00Z');

    await useCases.purge();
    const { rows } = await testPool().query<{ customer_name_search: string | null }>(
      'SELECT customer_name_search FROM appointment WHERE id = $1',
      [old.id],
    );

    expect(rows[0]?.customer_name_search).toBeNull();
  });

  it('keeps the slot, the status and the service snapshot (FR-035a)', async () => {
    const old = await insertAppointment('2025-01-10T10:00:00Z');
    const before = await rowOf(old.id);

    await useCases.purge();
    const after = await rowOf(old.id);

    expect(after?.status).toBe('CONFIRMED');
    expect(after?.starts_at.toISOString()).toBe(before?.starts_at.toISOString());
    expect(after?.ends_at.toISOString()).toBe(before?.ends_at.toISOString());
    expect(after?.service_name).toBe('Corte');
    expect(after?.service_duration_minutes).toBe(30);
  });

  it('stops the link resolving, with nothing to distinguish it from one that never was', async () => {
    const old = await insertAppointment('2025-01-10T10:00:00Z');
    expect(await useCases.viewAppointment(old.token)).not.toBeNull();

    await useCases.purge();

    // The same answer a made-up link gets (FR-020, BR-018).
    expect(await useCases.viewAppointment(old.token)).toBeNull();
    expect(await useCases.viewAppointment('a'.repeat(43))).toBeNull();
  });

  it('is safe to run twice: the second pass finds nothing left to do', async () => {
    await insertAppointment('2025-01-10T10:00:00Z');

    const first = await useCases.purge();
    const second = await useCases.purge();

    expect(first.affected).toBe(1);
    expect(second.affected).toBe(0);
  });
});

describe('--dry-run writes nothing', () => {
  it('counts what would go without touching a single row', async () => {
    const old = await insertAppointment('2025-01-10T10:00:00Z');
    const before = await rowOf(old.id);

    const outcome = await useCases.purge({ dryRun: true });

    const after = await rowOf(old.id);
    expect(outcome.affected).toBe(1);
    expect(outcome.dryRun).toBe(true);
    // The row, compared field by field, is the one that was there before.
    expect(after).toEqual(before);
  });

  it('leaves the link working', async () => {
    const old = await insertAppointment('2025-01-10T10:00:00Z');

    await useCases.purge({ dryRun: true });

    expect(await useCases.viewAppointment(old.token)).not.toBeNull();
  });
});

describe('--appointment <uuid>: deletion on request (Principio III)', () => {
  it('anonymises a recent appointment that is nowhere near its retention date', async () => {
    const recent = await insertAppointment('2026-09-18T09:30:00Z');

    const outcome = await useCases.purge({ appointmentId: recent.id });

    expect(outcome.affected).toBe(1);
    const row = await rowOf(recent.id);
    expect(row?.customer_name).toBeNull();
    expect(row?.customer_phone).toBeNull();
    expect(row?.customer_email).toBeNull();
    expect(row?.customer_phone_normalized).toBeNull();
    expect(row?.customer_email_normalized).toBeNull();
    expect(row?.token_hash).toBeNull();
    expect(row?.anonymized_at).not.toBeNull();
  });

  it('keeps that appointment slot, status and snapshot like any other purge', async () => {
    const recent = await insertAppointment('2026-09-18T09:30:00Z');

    await useCases.purge({ appointmentId: recent.id });
    const row = await rowOf(recent.id);

    expect(row?.status).toBe('CONFIRMED');
    expect(row?.service_name).toBe('Corte');
    expect(row?.starts_at.toISOString()).toBe(new Date('2026-09-18T09:30:00Z').toISOString());
  });

  it('kills that link and only that one', async () => {
    const mine = await insertAppointment('2026-09-18T09:30:00Z');
    const theirs = await insertAppointment('2026-09-18T12:00:00Z');

    await useCases.purge({ appointmentId: mine.id });

    expect(await useCases.viewAppointment(mine.token)).toBeNull();
    expect(await useCases.viewAppointment(theirs.token)).not.toBeNull();
  });

  it('honours --dry-run for a single appointment too', async () => {
    const recent = await insertAppointment('2026-09-18T09:30:00Z');
    const before = await rowOf(recent.id);

    const outcome = await useCases.purge({ appointmentId: recent.id, dryRun: true });

    expect(outcome.affected).toBe(1);
    expect(await rowOf(recent.id)).toEqual(before);
  });

  it('reports nothing done for an id that matches no appointment', async () => {
    const outcome = await useCases.purge({ appointmentId: randomUUID() });

    expect(outcome.affected).toBe(0);
  });
});

describe('the email of an appointment whose data goes (004, FR-021, D-012)', () => {
  async function consentAndNotification(id: string) {
    const { rows } = await testPool().query<{
      unsubscribe_token_hash: Buffer | null;
      status: string;
      skip_reason: string | null;
      sealed_tokens: Buffer | null;
      next_attempt_at: Date | null;
    }>(
      `SELECT c.unsubscribe_token_hash, n.status, n.skip_reason, n.sealed_tokens, n.next_attempt_at
         FROM channel_consent c JOIN notification n ON n.appointment_id = c.appointment_id
        WHERE c.appointment_id = $1`,
      [id],
    );
    return rows[0];
  }

  it.each([
    ['the nightly sweep', '2025-01-10T10:00:00Z', undefined],
    ['the deletion on request', '2026-06-10T10:00:00Z', 'byId'],
  ] as const)('%s also kills the unsubscribe link and drops a pending notification', async (_what, startsAt, by) => {
    const appointment = await insertAppointment(startsAt);
    const unsubscribe = generate();
    await insertEmailConfirmation(appointment.id, { unsubscribeTokenHash: unsubscribe.hash });

    await useCases.purge(by === 'byId' ? { appointmentId: appointment.id } : {});

    expect(await consentAndNotification(appointment.id)).toEqual({
      unsubscribe_token_hash: null,
      status: 'NOT_SENT',
      skip_reason: 'PERSONAL_DATA_DELETED',
      sealed_tokens: null,
      next_attempt_at: null,
    });
    expect(
      await createConsentRepository(() => testPool()).findByUnsubscribeTokenHash(unsubscribe.hash),
    ).toBeNull();
  });

  it('leaves a notification already sent as it was', async () => {
    const appointment = await insertAppointment('2025-01-10T10:00:00Z');
    await insertEmailConfirmation(appointment.id, { unsubscribeTokenHash: generate().hash, status: 'SENT' });

    await useCases.purge();

    expect((await consentAndNotification(appointment.id))?.status).toBe('SENT');
  });

  it('leaves the email of an appointment that keeps its data alone', async () => {
    const recent = await insertAppointment('2026-06-10T10:00:00Z');
    const unsubscribe = generate();
    await insertEmailConfirmation(recent.id, { unsubscribeTokenHash: unsubscribe.hash });

    await useCases.purge();

    expect((await consentAndNotification(recent.id))?.status).toBe('PENDING');
    expect(await createConsentRepository(() => testPool()).findByUnsubscribeTokenHash(unsubscribe.hash)).not.toBeNull();
  });
});
