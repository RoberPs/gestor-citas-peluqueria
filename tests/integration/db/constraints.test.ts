import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestDb,
  ensureSchema,
  insertAppointmentRow,
  testPool,
  truncateAll,
} from '../helpers/test-db';

/**
 * These constraints are the feature's guarantees, not decoration. They are
 * exercised against the database directly, bypassing the application entirely:
 * a guarantee that only holds because the application is careful is not one.
 */

const SERVICE_ID = randomUUID();

type AppointmentOverrides = {
  status?: 'CONFIRMED' | 'CANCELLED';
  origin?: 'ONLINE' | 'OWNER';
  cancelledBy?: 'CUSTOMER' | 'OWNER' | null;
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
    origin = 'ONLINE',
    cancelledBy = status === 'CANCELLED' ? 'CUSTOMER' : null,
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

  await insertAppointmentRow(
    {
      id: randomUUID(),
      status,
      origin,
      cancelled_by: cancelledBy,
      starts_at: startsAt,
      ends_at: endsAt,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      customer_phone_normalized: customerPhoneNormalized,
      customer_email_normalized: customerEmailNormalized,
      token_hash: tokenHash,
      cancelled_at: cancelledAt,
      anonymized_at: anonymizedAt,
    },
    { serviceId: SERVICE_ID, name: 'Corte', durationMinutes: 90, priceCents: 1800 },
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
      `SELECT s.name AS service_name, a.status
         FROM appointment a JOIN appointment_service s ON s.appointment_id = a.id`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.service_name).toBe('Corte');
    expect(rows[0]?.status).toBe('CONFIRMED');
  });
});

describe('appointment_anonymization_is_atomic, rewritten by 0006 (002, D-026)', () => {
  it('accepts an appointment the owner wrote by hand, with no email and no link (FR-024, FR-026)', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({
        origin: 'OWNER',
        customerEmail: null,
        customerEmailNormalized: null,
        tokenHash: null,
      }),
    );

    expect(code).toBeUndefined();
  });

  it('rejects an appointment written by hand that carries a management link', async () => {
    expect(await sqlStateOf(() => insertAppointment({ origin: 'OWNER' }))).toBe('23514');
  });

  it('rejects an online appointment without its management link', async () => {
    expect(await sqlStateOf(() => insertAppointment({ origin: 'ONLINE', tokenHash: null }))).toBe(
      '23514',
    );
  });

  it('rejects an email without its canonical form, and the other way round', async () => {
    const withoutCanonical = await sqlStateOf(() =>
      insertAppointment({ customerEmailNormalized: null }),
    );
    const withoutEmail = await sqlStateOf(() =>
      insertAppointment({
        customerEmail: null,
        startsAt: '2026-09-19T10:00:00+02:00',
        endsAt: '2026-09-19T11:00:00+02:00',
      }),
    );

    expect(withoutCanonical).toBe('23514');
    expect(withoutEmail).toBe('23514');
  });

  it('keeps the searchable name in step with the name, and clears it on anonymising (D-036)', async () => {
    await insertAppointment({ customerName: 'José  NÚÑEZ' });
    await insertAppointment({
      anonymizedAt: '2027-10-01T03:30:00+02:00',
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      customerPhoneNormalized: null,
      customerEmailNormalized: null,
      tokenHash: null,
      startsAt: '2026-09-19T10:00:00+02:00',
      endsAt: '2026-09-19T11:00:00+02:00',
    });

    const { rows } = await testPool().query<{ customer_name_search: string | null }>(
      'SELECT customer_name_search FROM appointment ORDER BY starts_at',
    );

    expect(rows.map((row) => row.customer_name_search)).toEqual(['jose nunez', null]);
  });
});

describe('appointment_cancelled_by_consistency (002, FR-040a, D-032)', () => {
  it('rejects a cancelled appointment that does not say who cancelled it', async () => {
    const code = await sqlStateOf(() =>
      insertAppointment({
        status: 'CANCELLED',
        cancelledAt: '2026-09-17T10:00:00+02:00',
        cancelledBy: null,
      }),
    );

    expect(code).toBe('23514');
  });

  it('rejects a confirmed appointment that says who cancelled it', async () => {
    expect(await sqlStateOf(() => insertAppointment({ cancelledBy: 'OWNER' }))).toBe('23514');
  });

  it.each([['CUSTOMER'], ['OWNER']] as const)(
    'accepts a cancellation by the %s',
    async (cancelledBy) => {
      const code = await sqlStateOf(() =>
        insertAppointment({
          status: 'CANCELLED',
          cancelledAt: '2026-09-17T10:00:00+02:00',
          cancelledBy,
        }),
      );

      expect(code).toBeUndefined();
    },
  );
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

describe('the editable booking parameters (002, FR-054, D-022)', () => {
  it('starts with the values 001 fixed: 2 h of lead time and a 24 h deadline', async () => {
    const { rows } = await testPool().query<{
      minimum_lead_time_minutes: number;
      cancellation_deadline_hours: number;
    }>('SELECT minimum_lead_time_minutes, cancellation_deadline_hours FROM salon');

    expect(rows[0]).toEqual({ minimum_lead_time_minutes: 120, cancellation_deadline_hours: 24 });
  });

  it.each([
    ['minimum_lead_time_minutes = -60'],
    ['minimum_lead_time_minutes = 2940'],
    ['minimum_lead_time_minutes = 90'],
    ['cancellation_deadline_hours = -1'],
    ['cancellation_deadline_hours = 73'],
  ])('rejects %s: outside the range or not whole hours', async (assignment) => {
    expect(await sqlStateOf(() => testPool().query(`UPDATE salon SET ${assignment}`))).toBe('23514');
  });

  it.each([['minimum_lead_time_minutes = 0'], ['minimum_lead_time_minutes = 2880'], ['cancellation_deadline_hours = 72']])(
    'accepts %s, at the edge of the range',
    async (assignment) => {
      expect(await sqlStateOf(() => testPool().query(`UPDATE salon SET ${assignment}`))).toBeUndefined();
    },
  );
});

describe('opening_interval (002, FR-045)', () => {
  async function insertStretch(weekday: number, from: string, to: string): Promise<void> {
    await testPool().query(
      'INSERT INTO opening_interval (id, weekday, starts_at, ends_at) VALUES ($1, $2, $3, $4)',
      [randomUUID(), weekday, from, to],
    );
  }

  it('rejects a stretch that does not end after it starts', async () => {
    expect(await sqlStateOf(() => insertStretch(5, '14:00', '10:00'))).toBe('23514');
    expect(await sqlStateOf(() => insertStretch(5, '10:00', '10:00'))).toBe('23514');
  });

  it('rejects two stretches of the same weekday that overlap', async () => {
    await insertStretch(5, '10:00', '14:00');

    expect(await sqlStateOf(() => insertStretch(5, '13:00', '20:00'))).toBe('23P01');
  });

  it('accepts a midday close, stretches that touch, and the same hours on another weekday', async () => {
    await insertStretch(6, '10:00', '14:00');

    expect(await sqlStateOf(() => insertStretch(6, '16:00', '20:00'))).toBeUndefined();
    expect(await sqlStateOf(() => insertStretch(6, '14:00', '16:00'))).toBeUndefined();
    expect(await sqlStateOf(() => insertStretch(5, '10:00', '14:00'))).toBeUndefined();
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
