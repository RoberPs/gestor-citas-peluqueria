import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/infrastructure/logging/logger';
import type * as LoggerModule from '@/infrastructure/logging/logger';
import { closeTestDb, testPool, truncateAppointments } from '../helpers/test-db';
import { CONTRACT_NOW, CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * FR-036 and Principio III: a booking that succeeds and a booking that fails
 * both leave the name, the phone, the email and the token out of the log.
 *
 * The failing path is the one that matters. Error traces are where personal
 * data leaks, because that is where somebody reaches for "everything we know"
 * while debugging.
 */

/** Distinctive values, so a leak is unmistakable rather than plausible. */
const NAME = 'ZZTESTZZ Lopez';
const PHONE = '600112233';
const EMAIL = 'zztestzz@example.com';

/** Hoisted with the mock factory, which vitest lifts above every declaration. */
const captured = vi.hoisted(() => ({ lines: [] as string[] }));
const lines = captured.lines;

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

vi.mock('@/infrastructure/security/rate-limiter', () => ({
  rateLimiter: () => ({
    check: async () => ({ allowed: true }),
    rejections: () => ({ APPOINTMENT_LOOKUP: 0, BOOKING_CONFIRMATION: 0 }),
    trackedKeyCount: () => 0,
  }),
}));

// The real logger, writing where the test can read it.
vi.mock('@/infrastructure/logging/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  const log = actual.createLogger({
    write: (chunk: string) => {
      captured.lines.push(chunk);
    },
  });

  return { ...actual, logger: () => log };
});

const { POST } = await import('@/app/api/appointments/route');
const { POST: signIn } = await import('@/app/api/gestion/sesion/route');
const { provisionOwner, signInRequest } = await import('../../contract/owner/helpers');

function bookingRequest(body: unknown): Request {
  return new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    serviceIds: [CORTE],
    startsAt: '2026-09-18T09:30:00Z',
    customer: { name: NAME, phone: PHONE, email: EMAIL },
    ...overrides,
  };
}

function output(): string {
  return lines.join('');
}

function expectNoPersonalData(): void {
  const logged = output();

  expect(logged).not.toContain(NAME);
  expect(logged).not.toContain('ZZTESTZZ');
  expect(logged).not.toContain(PHONE);
  expect(logged).not.toContain('+34600112233');
  expect(logged).not.toContain(EMAIL);
  expect(logged).not.toContain('zztestzz');
}

beforeAll(async () => {
  await seedContractDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  lines.length = 0;
});

describe('a booking that succeeds', () => {
  it('logs the appointment by its internal id and nothing about the person', async () => {
    const response = await POST(bookingRequest(validBody()));
    expect(response.status).toBe(303);

    expect(output()).toContain('booking confirmed');
    expectNoPersonalData();
  });

  it('never logs the token, which is the credential itself', async () => {
    const response = await POST(bookingRequest(validBody()));
    const token = (response.headers.get('Location') ?? '')
      .replace('/cita/', '')
      .replace('?nueva=1', '');

    expect(token).toHaveLength(43);
    expect(output()).not.toContain(token);
  });

  it('logs an identifier that appears in no client URL', async () => {
    await POST(bookingRequest(validBody()));

    const { rows } = await testPool().query<{ id: string }>('SELECT id FROM appointment');
    const id = rows[0]?.id ?? '';

    // The internal id is what a trace references (FR-036).
    expect(output()).toContain(id);
  });
});

describe('a booking that fails', () => {
  it('logs nothing personal when the slot has gone', async () => {
    await POST(bookingRequest(validBody()));
    lines.length = 0;

    const second = await POST(
      bookingRequest(
        validBody({ customer: { name: NAME, phone: '700112233', email: EMAIL } }),
      ),
    );

    expect(second.status).toBe(409);
    expect(output()).toContain('booking rejected');
    expectNoPersonalData();
  });

  it('logs nothing personal when the contact data is what was wrong', async () => {
    const response = await POST(
      bookingRequest(validBody({ customer: { name: NAME, phone: 'no-es-un-telefono', email: EMAIL } })),
    );

    expect(response.status).toBe(400);
    expectNoPersonalData();
  });

  it('logs nothing personal when the contact limit is reached', async () => {
    const starts = ['2026-09-18T08:00:00Z', '2026-09-18T09:00:00Z', '2026-09-18T10:00:00Z'];
    for (const startsAt of starts) {
      await POST(bookingRequest(validBody({ startsAt })));
    }
    lines.length = 0;

    const fourth = await POST(bookingRequest(validBody()));

    expect(fourth.status).toBe(422);
    expectNoPersonalData();
  });

  it('says why it failed, so the trace is still worth having', async () => {
    await POST(bookingRequest(validBody()));
    lines.length = 0;

    await POST(
      bookingRequest(validBody({ customer: { name: NAME, phone: '700112233', email: EMAIL } })),
    );

    expect(output()).toContain('SLOT_TAKEN');
  });
});

describe('the logger refuses them even when handed them directly', () => {
  it('redacts a trace that carries all four values', () => {
    const local: string[] = [];
    const log = createLogger({ write: (chunk: string) => local.push(chunk) });

    log.error(
      { name: NAME, phone: PHONE, email: EMAIL, token: 'kJ8x2mQ', appointmentId: 'b2e9' },
      'unexpected failure',
    );

    const logged = local.join('');
    expect(logged).toContain('b2e9');
    expect(logged).not.toContain('ZZTESTZZ');
    expect(logged).not.toContain(PHONE);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('kJ8x2mQ');
  });
});

describe("the owner's password never reaches the log (002, FR-010)", () => {
  const PASSWORD = 'ZZPASSWORDZZ larga';

  beforeAll(async () => {
    await provisionOwner();
  });

  afterAll(async () => {
    await testPool().query('TRUNCATE owner_account CASCADE');
  });

  it('logs nothing of it on a rejected sign-in, nor on a malformed one', async () => {
    lines.length = 0;

    await signIn(signInRequest({ username: 'duena', password: PASSWORD }));
    await signIn(signInRequest({ username: 'duena', password: PASSWORD, extra: true }));

    expect(output()).not.toContain('ZZPASSWORDZZ');
  });

  it('redacts a password field even if something did log it', () => {
    const own: string[] = [];
    createLogger({ write: (chunk: string) => own.push(chunk) }).info(
      { body: { password: PASSWORD, newPassword: PASSWORD, currentPassword: PASSWORD } },
      'sign-in',
    );

    expect(own.join('')).not.toContain('ZZPASSWORDZZ');
  });
});
