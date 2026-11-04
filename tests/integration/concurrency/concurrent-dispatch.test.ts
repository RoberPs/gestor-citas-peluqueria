import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Notifier } from '@/application/ports';
import { createConfirmBooking } from '@/application/use-cases/confirm-booking';
import { createDispatchNotifications } from '@/application/use-cases/dispatch-notifications';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createNotificationRepository } from '@/infrastructure/db/notification-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { confirmationEmailRenderer } from '@/infrastructure/notifications/confirmation-email';
import { createResendNotifier } from '@/infrastructure/notifications/resend-notifier';
import { tokenGenerator } from '@/infrastructure/security/token';
import { createTokenSealer } from '@/infrastructure/security/token-sealer';
import { FAKE_EMAIL_API_KEY, type FakeEmailProvider } from '../../support/fake-email-provider';
import { TEST_EMAIL_FROM, TEST_SEAL_KEY, useFakeEmailProvider } from '../helpers/fake-email';
import { closeTestDb, ensureSchema, testPool, truncateAppointments } from '../helpers/test-db';
import { CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * 004, FR-012 and SC-004: one email per appointment, also when the first
 * attempt and the dispatch command reach the same notification at once, and
 * when a process dies between "the provider took it" and "we wrote it down".
 * Genuine parallel transactions against PostgreSQL, not a simulated race.
 */

const BOOKED_AT = Temporal.Instant.from('2026-09-15T08:00:00Z');
const clock: Clock = { now: () => BOOKED_AT };
const sealer = createTokenSealer(TEST_SEAL_KEY);

let provider: FakeEmailProvider & { restore: () => Promise<void> };

function realNotifier(): Notifier {
  return createResendNotifier({
    apiKey: FAKE_EMAIL_API_KEY,
    apiBaseUrl: provider.url,
    from: TEST_EMAIL_FROM,
    replyTo: null,
    timeoutMs: 2_000,
  });
}

function dispatcher(notifier: Notifier = realNotifier()) {
  return createDispatchNotifications({
    config: createSalonConfigRepository(() => testPool()),
    notifications: createNotificationRepository(() => testPool(), sealer),
    notifier,
    render: confirmationEmailRenderer,
    clock,
  });
}

async function bookWithEmail(): Promise<string> {
  const result = await createConfirmBooking({
    config: createSalonConfigRepository(() => testPool()),
    appointments: createAppointmentRepository(() => testPool()),
    periods: createUnavailablePeriodRepository(() => testPool()),
    tokens: tokenGenerator,
    clock,
    notifications: { channels: { enabledChannels: () => new Set(['EMAIL']) }, sealer },
  })({
    serviceIds: [CORTE],
    startsAt: '2026-09-18T09:30:00Z',
    contact: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    emailConsent: true,
  });
  if (!result.ok || result.value.notificationId === null) throw new Error('the fixture booking was rejected');
  return result.value.notificationId;
}

async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await testPool().query<{ status: string }>('SELECT status FROM notification WHERE id = $1', [id]);
  return rows[0]?.status;
}

beforeAll(async () => {
  await ensureSchema();
  await seedContractDatabase();
  provider = await useFakeEmailProvider();
});

afterAll(async () => {
  await provider.restore();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAppointments();
  provider.clear();
  provider.setMode('ok');
});

describe('two dispatches of the same notification at once', () => {
  it('sends exactly one email: the second finds the row locked and leaves it', async () => {
    const id = await bookWithEmail();

    const [one, due] = await Promise.all([dispatcher().dispatchOne(id), dispatcher().dispatchDue()]);

    expect(provider.messages()).toHaveLength(1);
    expect([one?.status, ...due.reports.map((report) => report.status)].filter((status) => status === 'SENT')).toHaveLength(1);
    expect(await statusOf(id)).toBe('SENT');
  });

  it('sends exactly one email from ten at once', async () => {
    const id = await bookWithEmail();

    await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? dispatcher().dispatchOne(id) : dispatcher().dispatchDue())));

    expect(provider.messages()).toHaveLength(1);
  });
});

describe('a cut between the provider accepting and the row being written (D-004)', () => {
  it('sends again with the same Idempotency-Key, and the provider keeps one email', async () => {
    const id = await bookWithEmail();
    // The provider takes the email, then the process "dies": the transaction
    // is rolled back and the notification is still pending.
    const dying: Notifier = {
      async send(message, key) {
        await realNotifier().send(message, key);
        throw new Error('the process died before writing the outcome');
      },
    };
    await expect(dispatcher(dying).dispatchOne(id)).rejects.toThrow('died');
    expect(await statusOf(id)).toBe('PENDING');

    await dispatcher().dispatchDue();

    expect(provider.messages()).toHaveLength(1);
    expect(provider.messages()[0]?.idempotencyKey).toBe(id);
    expect(await statusOf(id)).toBe('SENT');
  });
});
