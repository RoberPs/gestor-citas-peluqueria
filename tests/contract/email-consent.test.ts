import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_NOW, CORTE, seedContractDatabase } from './helpers/seed-contract-db';
import { expectMatchesContract, responseSchema } from './helpers/openapi';
import { closeTestDb, testPool, truncateAppointments } from '../integration/helpers/test-db';

vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

const limiter = { allowed: true };
vi.mock('@/infrastructure/security/rate-limiter', () => ({
  rateLimiter: () => ({
    check: async () => ({ allowed: limiter.allowed }),
    rejections: () => ({ APPOINTMENT_LOOKUP: 0, BOOKING_CONFIRMATION: 0 }),
    trackedKeyCount: () => 0,
  }),
}));

const { POST: REVOKE } = await import('@/app/api/appointments/[token]/email-consent/revocation/route');
const { GET } = await import('@/app/api/appointments/[token]/route');
const { POST: BOOK } = await import('@/app/api/appointments/route');

/**
 * 004, T050: `POST /api/appointments/{token}/email-consent/revocation`, the
 * unsubscribe from the appointment screen (FR-017), against `http-api.yaml` 2.2.0.
 */

const notFoundSchema = responseSchema('/appointments/{token}/email-consent/revocation', 'post', '404');

async function book(): Promise<string> {
  const response = await BOOK(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceIds: [CORTE],
        startsAt: '2026-09-18T09:30:00Z',
        customer: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
      }),
    }),
  );
  return (response.headers.get('Location') ?? '').replace('/cita/', '').replace('?nueva=1', '');
}

async function grantConsent(): Promise<void> {
  await testPool().query(
    `INSERT INTO channel_consent (appointment_id, channel, granted_at, unsubscribe_token_hash)
     SELECT id, 'EMAIL', now(), $1 FROM appointment`,
    [randomBytes(32)],
  );
}

function revoke(token: string): Promise<Response> {
  return REVOKE(
    new Request(`http://localhost/api/appointments/${token}/email-consent/revocation`, { method: 'POST' }),
    { params: Promise.resolve({ token }) },
  );
}

async function emailNotifications(token: string): Promise<unknown> {
  const response = await GET(new Request(`http://localhost/api/appointments/${token}`), {
    params: Promise.resolve({ token }),
  });
  return ((await response.json()) as { emailNotifications: unknown }).emailNotifications;
}

beforeAll(async () => {
  await seedContractDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  limiter.allowed = true;
});

describe('204 — the unsubscribe from the appointment, always harmless (FR-016)', () => {
  it('ends a live consent, and the appointment stops receiving emails', async () => {
    const token = await book();
    await grantConsent();
    expect(await emailNotifications(token)).toEqual({ active: true });

    const response = await revoke(token);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(await emailNotifications(token)).toEqual({ active: false });
  });

  it('answers 204 when it is already done', async () => {
    const token = await book();
    await grantConsent();
    await revoke(token);

    expect((await revoke(token)).status).toBe(204);
  });

  it('answers 204 when the appointment never had a consent', async () => {
    expect((await revoke(await book())).status).toBe(204);
  });

  it('answers 204 for a cancelled appointment too, which it does not change', async () => {
    const token = await book();
    await grantConsent();
    await testPool().query(
      "UPDATE appointment SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'CUSTOMER'",
    );

    expect((await revoke(token)).status).toBe(204);
    const { rows } = await testPool().query<{ status: string }>('SELECT status FROM appointment');
    expect(rows[0]?.status).toBe('CANCELLED');
  });
});

describe('404 — the neutral answer', () => {
  it('answers an unknown token with the body of the contract', async () => {
    const response = await revoke('A'.repeat(43));

    expect(response.status).toBe(404);
    expectMatchesContract(notFoundSchema, await response.json());
  });

  it('answers past the APPOINTMENT_LOOKUP limit with that same 404 (001, FR-038)', async () => {
    const token = await book();
    await grantConsent();
    limiter.allowed = false;

    const response = await revoke(token);

    expect(response.status).toBe(404);
    expectMatchesContract(notFoundSchema, await response.json());
    limiter.allowed = true;
    expect(await emailNotifications(token)).toEqual({ active: true });
  });
});
