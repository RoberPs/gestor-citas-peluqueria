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

const { GET } = await import('@/app/api/appointments/[token]/route');
const { POST } = await import('@/app/api/appointments/route');

const notFoundSchema = responseSchema('/appointments/{token}', 'get', '404');

/**
 * FR-019 and FR-038, checked the only way that means anything: by comparing the
 * five answers to each other, body **and** headers.
 *
 * Any difference — a status, a header, a word — tells whoever is probing links
 * at random that the system distinguishes between their attempts, and that is
 * exactly what the requirement forbids.
 */

type Answer = { status: number; body: string; headers: [string, string][] };

async function open(token: string): Promise<Answer> {
  const response = await GET(new Request(`http://localhost/api/appointments/${token}`), {
    params: Promise.resolve({ token }),
  });

  return {
    status: response.status,
    body: await response.text(),
    headers: [...response.headers.entries()].sort(),
  };
}

async function book(startsAt: string): Promise<string> {
  const response = await POST(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceIds: [CORTE],
        startsAt,
        customer: { name: 'Ana', phone: '600112233', email: 'ana@example.com' },
      }),
    }),
  );

  const location = response.headers.get('Location');
  if (location === null) throw new Error('the fixture booking did not redirect');
  return location.replace('/cita/', '').replace('?nueva=1', '');
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

describe('the five cases answer identically (FR-019, FR-038, D-006)', () => {
  it('gives the same status, body and headers in all five', async () => {
    // 1. A token that corresponds to no appointment.
    const unknown = await open('a'.repeat(43));

    // 2. A malformed token.
    const malformed = await open('not-a-valid-token');

    // 3. An appointment that was deleted.
    const deletedToken = await book('2026-09-18T08:00:00Z');
    await testPool().query('DELETE FROM appointment');
    const deleted = await open(deletedToken);

    // 4. An appointment anonymised by retention (FR-035, BR-018).
    const anonymisedToken = await book('2026-09-18T09:00:00Z');
    await testPool().query(
      `UPDATE appointment
          SET customer_name = NULL, customer_phone = NULL, customer_email = NULL,
              customer_phone_normalized = NULL, customer_email_normalized = NULL,
              token_hash = NULL, anonymized_at = now()`,
    );
    const anonymised = await open(anonymisedToken);

    // 5. The per-IP opening limit, which must not announce itself.
    const liveToken = await book('2026-09-18T10:00:00Z');
    limiter.allowed = false;
    const rateLimited = await open(liveToken);
    limiter.allowed = true;

    const answers = [unknown, malformed, deleted, anonymised, rateLimited];

    for (const answer of answers) {
      expect(answer.status).toBe(unknown.status);
      expect(answer.body).toBe(unknown.body);
      expect(answer.headers).toEqual(unknown.headers);
    }
  });

  it('answers 404, never 429 or 410', async () => {
    limiter.allowed = false;

    const answer = await open('a'.repeat(43));

    expect(answer.status).toBe(404);
  });

  it('carries no header that hints a limit exists', async () => {
    limiter.allowed = false;

    const { headers } = await open('a'.repeat(43));
    const names = headers.map(([name]) => name.toLowerCase());

    expect(names).not.toContain('retry-after');
    expect(names.filter((name) => name.startsWith('x-ratelimit'))).toEqual([]);
    expect(names.filter((name) => name.includes('ratelimit'))).toEqual([]);
  });

  it('says nothing about limits, retention or deletion in the body', async () => {
    limiter.allowed = false;

    const { body } = await open('a'.repeat(43));

    expect(body.toLowerCase()).not.toMatch(/l[íi]mite|intent|borrad|retenci[óo]n|caducad/);
  });

  it('matches the contract for the neutral answer', async () => {
    const response = await GET(new Request('http://localhost/api/appointments/nope'), {
      params: Promise.resolve({ token: 'nope' }),
    });

    expectMatchesContract(notFoundSchema, await response.json());
  });

  it('still points somewhere useful, as every error must (SC-012)', async () => {
    const { body } = await open('a'.repeat(43));

    expect((JSON.parse(body) as { nextAction: string }).nextAction.length).toBeGreaterThan(0);
  });
});

describe('a live appointment is the only thing that answers differently', () => {
  it('answers 200 for a token that does resolve', async () => {
    const token = await book('2026-09-18T09:30:00Z');

    const answer = await open(token);

    expect(answer.status).toBe(200);
  });
});
