import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenGenerator } from '@/infrastructure/security/token';
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

const { POST: UNSUBSCRIBE } = await import('@/app/api/unsubscribe/[token]/route');
const { GET } = await import('@/app/api/appointments/[token]/route');
const { POST: BOOK } = await import('@/app/api/appointments/route');

/**
 * 004, T050: `POST /api/unsubscribe/{token}`, the one-click unsubscribe of the
 * mail client (RFC 8058, D-009), against `http-api.yaml` 2.2.0.
 */

const notFoundSchema = responseSchema('/unsubscribe/{unsubscribeToken}', 'post', '404');

/** A booking, with a consent whose unsubscribe token the test knows. */
async function bookWithConsent(): Promise<{ management: string; unsubscribe: string }> {
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
  const management = (response.headers.get('Location') ?? '').replace('/cita/', '').replace('?nueva=1', '');
  const unsubscribe = tokenGenerator.generate();
  await testPool().query(
    `INSERT INTO channel_consent (appointment_id, channel, granted_at, unsubscribe_token_hash)
     SELECT id, 'EMAIL', now(), $1 FROM appointment`,
    [Buffer.from(unsubscribe.hash)],
  );
  return { management, unsubscribe: unsubscribe.token };
}

function unsubscribe(token: string, oneClickBody = true): Promise<Response> {
  return UNSUBSCRIBE(
    new Request(`http://localhost/api/unsubscribe/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(oneClickBody ? { body: 'List-Unsubscribe=One-Click' } : {}),
    }),
    { params: Promise.resolve({ token }) },
  );
}

async function consent() {
  const { rows } = await testPool().query<{ ended_at: Date | null; end_reason: string | null }>(
    'SELECT ended_at, end_reason FROM channel_consent',
  );
  return rows[0];
}

async function neutralBody(): Promise<string> {
  const response = await GET(new Request('http://localhost/api/appointments/x'), {
    params: Promise.resolve({ token: 'x' }),
  });
  return response.text();
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

describe('204 — done, or already done', () => {
  it('ends the consent with the body of RFC 8058, and answers 204 without a body', async () => {
    const { unsubscribe: token } = await bookWithConsent();

    const response = await unsubscribe(token);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect((await consent())?.end_reason).toBe('UNSUBSCRIBED');
  });

  it('answers 204 again, harmless, the second time', async () => {
    const { unsubscribe: token } = await bookWithConsent();
    await unsubscribe(token);
    const first = await consent();

    expect((await unsubscribe(token)).status).toBe(204);
    expect(await consent()).toEqual(first);
  });

  it('accepts it without the optional body', async () => {
    const { unsubscribe: token } = await bookWithConsent();
    expect((await unsubscribe(token, false)).status).toBe(204);
  });
});

describe('404 — the neutral answer of 001 (FR-018)', () => {
  it.each([
    ['unknown', 'A'.repeat(43)],
    ['malformed', 'nope'],
  ])('answers a token %s with the same body as an invalid management link', async (_what, token) => {
    await bookWithConsent();
    const response = await unsubscribe(token);

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toBe(await neutralBody());
    expectMatchesContract(notFoundSchema, JSON.parse(body));
  });

  it('answers the management token, which is another credential, as unknown (FR-024)', async () => {
    const { management } = await bookWithConsent();
    expect((await unsubscribe(management)).status).toBe(404);
    expect((await consent())?.ended_at).toBeNull();
  });

  it('answers past the APPOINTMENT_LOOKUP limit with that same 404, not with a 429 (001, FR-038)', async () => {
    const { unsubscribe: token } = await bookWithConsent();
    limiter.allowed = false;

    const response = await unsubscribe(token);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(await neutralBody());
    expect((await consent())?.ended_at).toBeNull();
  });
});
