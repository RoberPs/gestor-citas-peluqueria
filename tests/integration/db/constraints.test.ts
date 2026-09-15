import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, ensureSchema, testPool, truncateAll } from '../helpers/test-db';

/**
 * These constraints are the feature's guarantees, not decoration. They are
 * exercised against the database directly, bypassing the application entirely:
 * a guarantee that only holds because the application is careful is not one.
 */

const SERVICE_ID = randomUUID();

type AppointmentOverrides = {
  status?: 'CONFIRMED' | 'CANCELLED';
  startsAt?: string;
  endsAt?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerPhoneNormalized?: string | null;
  customerEmailNormalized?: string | null;
  tokenHash?: Buffer | null;
  cancelledAt?: string | null;
  anonymizedAt?: string | null;
};

async function insertAppointment(overrides: AppointmentOverrides = {}): Promise<void> {
  const {
    status = 'CONFIRMED',
    startsAt = '2026-09-18T10:00:00+02:00',
    endsAt = '2026-09-18T11:30:00+02:00',
    customerName = 'Ana',
    customerPhone = '600112233',
    customerEmail = 'ana@example.com',
    customerPhoneNormalized = '+34600112233',
    customerEmailNormalized = 'ana@example.com',
    tokenHash = Buffer.from(randomUUID().replace(/-/g, ''), 'hex'),
    cancelledAt = null,
    anonymizedAt = null,
  } = overrides;

  await testPool().query(
    `INSERT INTO appointment (
       id, status, starts_at, ends_at,
       service_id, service_name, service_duration_minutes, service_price_cents,
       customer_name, customer_phone, customer_email,
       customer_phone_normalized, customer_email_normalized,
       token_hash, cancelled_at, anonymized_at
     ) VALUES ($1,$2,$3,$4,$5,'Corte',90,1800,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      randomUUID(),
      status,
      startsAt,
      endsAt,
      SERVICE_ID,
      customerName,
      customerPhone,
      customerEmail,
      customerPhoneNormalized,
      customerEmailNormalized,
      tokenHash,
      cancelledAt,
      anonymizedAt,
    ],
  );
}

/** The PostgreSQL error code carried by a rejected statement, if any. */
async function sqlStateOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll();
  await testPool().query(
    `INSERT INTO salon (id, name, address, phone, timezone)
     VALUES ($1, 'Salon', 'Calle Mayor 1', '911234567', 'Europe/Madrid')`,
    [randomUUID()],
  );
  await testPool().query(
    `INSERT INTO service (id, name, duration_minutes, price_cents, is_active, display_order)
     VALUES ($1, 'Corte', 90, 1800, true, 1)`,
    [SERVICE_ID],
  );
});

describe('appointment_no_overlap (BR-001, SC-002, FR-012)', () => {
  it('rejects a second confirmed appointment that overlaps the first', async () => {
    await insertAppointment({
      startsAt: '2026-09-18T10:00:00+02:00',
      endsAt: '2026-09-18T11:30:00+02:00',
    });

    const code = await sqlStateOf(() =>
      insertAppointment({
        startsAt: '2026-09-18T11:00:00+02:00',
        endsAt: '2026-09-18T11:30:00+02:00',
      }),
    );

    expect(code).toBe('23P01');
  });

  it('accepts two consecutive appointments: the range is half-open (BR-013)', async () => {
    await insertAppointment({
      startsAt: '2026-09-18T10:00:00+02:00',
      endsAt: '2026-09-18T11:30:00+02:00',
    });

    const code = await sqlStateOf(() =>
      insertAppointment({
        startsAt: '2026-09-18T11:30:00+02:00',
        endsAt: '2026-09-18T12:00:00+02:00',
      }),
    );

    expect(code).toBeUndefined();
  });

  it('lets a cancelled appointment share the slot: cancelling frees it (BR-005)', async () => {
    await insertAppointment({
      status: 'CANCELLED',
      cancelledAt: '2026-09-17T10:00:00+02:00',
      startsAt: '2026-09-18T10:00:00+02:00',
      endsAt: '2026-09-18T11:30:00+02:00',
    });

    const code = await sqlStateOf(() =>
      insertAppointment({
        startsAt: '2026-09-18T10:00:00+02:00',
        endsAt: '2026-09-18T11:30:00+02:00',
      }),
    );

    expect(code).toBeUndefined();
  });
});

describe('appointment_positive_duration (BR-002)', () => {
  it('rejects an appointment that ends before it starts', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({
        startsAt: '2026-09-18T11:30:00+02:00',
        endsAt: '2026-09-18T10:00:00+02:00',
      }),
    );

    expect(code).toBe('23514');
  });

  it('rejects an appointment of zero length', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({
        startsAt: '2026-09-18T10:00:00+02:00',
        endsAt: '2026-09-18T10:00:00+02:00',
      }),
    );

    expect(code).toBe('23514');
  });
});

describe('appointment_cancelled_consistency (FR-030)', () => {
  it('rejects a cancelled appointment without a cancellation moment', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({ status: 'CANCELLED', cancelledAt: null }),
    );

    expect(code).toBe('23514');
  });

  it('rejects a confirmed appointment that carries a cancellation moment', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({ status: 'CONFIRMED', cancelledAt: '2026-09-17T10:00:00+02:00' }),
    );

    expect(code).toBe('23514');
  });
});

describe('appointment_anonymization_is_atomic (BR-018)', () => {
  it('rejects an anonymised appointment that kept its name', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({
        anonymizedAt: '2027-10-01T03:30:00+02:00',
        customerName: 'Ana',
        customerPhone: null,
        customerEmail: null,
        customerPhoneNormalized: null,
        customerEmailNormalized: null,
        tokenHash: null,
      }),
    );

    expect(code).toBe('23514');
  });

  it('rejects an anonymised appointment whose link still resolves', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({
        anonymizedAt: '2027-10-01T03:30:00+02:00',
        customerName: null,
        customerPhone: null,
        customerEmail: null,
        customerPhoneNormalized: null,
        customerEmailNormalized: null,
        tokenHash: Buffer.alloc(32, 7),
      }),
    );

    expect(code).toBe('23514');
  });

  it('rejects a live appointment with its personal fields already stripped', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({
        anonymizedAt: null,
        customerName: null,
        customerPhone: null,
        customerEmail: null,
      }),
    );

    expect(code).toBe('23514');
  });

  it('accepts a fully anonymised appointment, keeping slot, status and service', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({
        anonymizedAt: '2027-10-01T03:30:00+02:00',
        customerName: null,
        customerPhone: null,
        customerEmail: null,
        customerPhoneNormalized: null,
        customerEmailNormalized: null,
        tokenHash: null,
      }),
    );

    expect(code).toBeUndefined();

    const { rows } = await testPool().query<{ service_name: string; status: string }>(
      'SELECT service_name, status FROM appointment',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.service_name).toBe('Corte');
    expect(rows[0]?.status).toBe('CONFIRMED');
  });
});

describe('appointment_token_hash_idx (D-005)', () => {
  it('rejects two appointments sharing a token hash', async () => {
    const hash = Buffer.alloc(32, 3);
    await insertAppointment({
      tokenHash: hash,
      startsAt: '2026-09-18T10:00:00+02:00',
      endsAt: '2026-09-18T11:00:00+02:00',
    });

    const code = await sqlStateOf(() =>
      insertAppointment({
        tokenHash: hash,
        startsAt: '2026-09-19T10:00:00+02:00',
        endsAt: '2026-09-19T11:00:00+02:00',
      }),
    );

    expect(code).toBe('23505');
  });
});

describe('salon single row invariant', () => {
  it('rejects a second salon', async () => {
    const code = await sqlStateOf(() =>
      testPool().query(
        `INSERT INTO salon (id, name, address, phone, timezone)
         VALUES ($1, 'Otro', 'Calle Menor 2', '911111111', 'Europe/Madrid')`,
        [randomUUID()],
      ),
    );

    expect(code).toBe('23505');
  });
});
