import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { CORTE, LAVADO, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * 004, Historia 1: the confirmation goes out once, from a pending row, with
 * the links of that appointment (FR-005, FR-006, FR-012), against a real
 * database and the fake provider over HTTP.
 */

/** Tuesday 2026-09-15, 10:00 in Madrid. */
const BOOKED_AT = Temporal.Instant.from('2026-09-15T08:00:00Z');
let currentNow = BOOKED_AT;
const clock: Clock = { now: () => currentNow };

/** Friday 2026-09-18 at 11:30, salon time. */
const FRIDAY_1130 = '2026-09-18T09:30:00Z';

const sealer = createTokenSealer(TEST_SEAL_KEY);

let provider: FakeEmailProvider & { restore: () => Promise<void> };

function build() {
  const config = createSalonConfigRepository(() => testPool());
  const appointments = createAppointmentRepository(() => testPool());
  return {
    appointments,
    confirmBooking: createConfirmBooking({
      config,
      appointments,
      periods: createUnavailablePeriodRepository(() => testPool()),
      tokens: tokenGenerator,
      clock,
      notifications: { channels: { enabledChannels: () => new Set(['EMAIL']) }, sealer },
    }),
    ...createDispatchNotifications({
      config,
      notifications: createNotificationRepository(() => testPool(), sealer),
      notifier: createResendNotifier({
        apiKey: FAKE_EMAIL_API_KEY,
        apiBaseUrl: provider.url,
        from: TEST_EMAIL_FROM,
        replyTo: null,
        timeoutMs: 2_000,
      }),
      render: confirmationEmailRenderer,
      clock,
    }),
  };
}

let useCases: ReturnType<typeof build>;

async function bookWithEmail(startsAt = FRIDAY_1130, serviceIds = [CORTE]) {
  const result = await useCases.confirmBooking({
    serviceIds,
    startsAt,
    contact: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    emailConsent: true,
  });
  if (!result.ok || result.value.notificationId === null) throw new Error('the fixture booking was rejected');
  return { ...result.value, notificationId: result.value.notificationId };
}

type NotificationRow = {
  status: string;
  skip_reason: string | null;
  attempts: number;
  next_attempt_at: Date | null;
  sealed_tokens: Buffer | null;
  updated_at: Date;
};

async function notificationRow(id: string): Promise<NotificationRow | undefined> {
  const { rows } = await testPool().query<NotificationRow>(
    'SELECT status, skip_reason, attempts, next_attempt_at, sealed_tokens, updated_at FROM notification WHERE id = $1',
    [id],
  );
  return rows[0];
}

function tokenOf(link: string, prefix: string): string {
  const index = link.indexOf(prefix);
  return link.slice(index + prefix.length);
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
  currentNow = BOOKED_AT;
  useCases = build();
});

describe('dispatchOne (Historia 1)', () => {
  it('sends one email to the address of the appointment, with its two links', async () => {
    const booking = await bookWithEmail(FRIDAY_1130, [CORTE, LAVADO]);

    const report = await useCases.dispatchOne(booking.notificationId);

    expect(report).toEqual({
      notificationId: booking.notificationId,
      appointmentId: booking.appointment.id,
      status: 'SENT',
      attempts: 1,
    });
    const [email] = provider.messages();
    expect(provider.messages()).toHaveLength(1);
    expect(email?.body.to).toEqual(['ana@example.com']);
    expect(email?.idempotencyKey).toBe(booking.notificationId);
    expect(email?.body.subject).toBe('Tu cita en Peluqueria Aurora: vie 18 sep, 11:30');

    const hrefs = [...(email?.body.html ?? '').matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? '');
    const management = hrefs.find((href) => href.includes('/cita/')) ?? '';
    const unsubscribe = hrefs.find((href) => href.includes('/baja/')) ?? '';

    const { rows: appointment } = await testPool().query<{ token_hash: Buffer }>(
      'SELECT token_hash FROM appointment WHERE id = $1',
      [booking.appointment.id],
    );
    const { rows: consent } = await testPool().query<{ unsubscribe_token_hash: Buffer }>(
      'SELECT unsubscribe_token_hash FROM channel_consent WHERE appointment_id = $1',
      [booking.appointment.id],
    );

    expect(Buffer.from(tokenGenerator.hash(tokenOf(management, '/cita/'))).equals(appointment[0]?.token_hash ?? Buffer.alloc(0))).toBe(true);
    expect(
      Buffer.from(tokenGenerator.hash(tokenOf(unsubscribe, '/baja/'))).equals(
        consent[0]?.unsubscribe_token_hash ?? Buffer.alloc(0),
      ),
    ).toBe(true);
    expect(email?.body.headers?.['List-Unsubscribe']).toBe(
      `<${management.replace(/\/cita\/.*$/, '')}/api/unsubscribe/${tokenOf(unsubscribe, '/baja/')}>`,
    );
  });

  it('leaves the notification SENT, tried once, without its tokens or a next attempt', async () => {
    const booking = await bookWithEmail();
    currentNow = BOOKED_AT.add({ seconds: 2 });

    await useCases.dispatchOne(booking.notificationId);

    const row = await notificationRow(booking.notificationId);
    expect(row).toMatchObject({ status: 'SENT', attempts: 1, next_attempt_at: null, sealed_tokens: null });
    expect(row?.updated_at.getTime()).toBe(currentNow.epochMilliseconds);
  });

  it('sends nothing the second time', async () => {
    const booking = await bookWithEmail();

    await useCases.dispatchOne(booking.notificationId);
    const second = await useCases.dispatchOne(booking.notificationId);

    expect(second).toBeNull();
    expect(provider.messages()).toHaveLength(1);
  });
});

describe('dispatchDue, with a fixed clock (Historia 3, FR-011)', () => {
  function at(minutes: number): Temporal.Instant {
    return BOOKED_AT.add({ seconds: Math.round(minutes * 60) });
  }

  it('keeps a transient failure pending, with its next attempt on the schedule', async () => {
    const booking = await bookWithEmail();
    provider.setMode('fail');

    const report = await useCases.dispatchOne(booking.notificationId);

    expect(report?.status).toBe('PENDING');
    const row = await notificationRow(booking.notificationId);
    expect(row?.status).toBe('PENDING');
    expect(row?.attempts).toBe(1);
    expect(row?.next_attempt_at?.getTime()).toBe(at(1).epochMilliseconds);
    expect(row?.sealed_tokens).not.toBeNull();
  });

  it('does not touch a notification whose next attempt has not come', async () => {
    const booking = await bookWithEmail();
    provider.setMode('fail');
    await useCases.dispatchOne(booking.notificationId);
    provider.setMode('ok');

    currentNow = at(0.5);
    const { reports } = await useCases.dispatchDue();

    expect(reports).toEqual([]);
    expect(provider.messages()).toHaveLength(0);
  });

  it('sends once when the provider comes back within the hour', async () => {
    const booking = await bookWithEmail();
    provider.setMode('fail');
    await useCases.dispatchOne(booking.notificationId);
    currentNow = at(1);
    await useCases.dispatchDue();
    provider.setMode('ok');

    currentNow = at(3);
    const { counts } = await useCases.dispatchDue();

    expect(counts).toEqual({ PENDING: 0, SENT: 1, FAILED: 0, NOT_SENT: 0 });
    expect(provider.messages()).toHaveLength(1);
    expect(await notificationRow(booking.notificationId)).toMatchObject({ status: 'SENT', attempts: 3 });
  });

  it('fails for good after the attempt of minute 45, and drops its tokens', async () => {
    const booking = await bookWithEmail();
    provider.setMode('fail');
    await useCases.dispatchOne(booking.notificationId);

    for (const minute of [1, 3, 7, 15, 30]) {
      currentNow = at(minute);
      expect((await useCases.dispatchDue()).counts.PENDING).toBe(1);
    }
    currentNow = at(45);
    const { counts } = await useCases.dispatchDue();

    expect(counts.FAILED).toBe(1);
    expect(await notificationRow(booking.notificationId)).toMatchObject({
      status: 'FAILED',
      attempts: 7,
      next_attempt_at: null,
      sealed_tokens: null,
    });
    expect(provider.messages()).toHaveLength(0);
  });

  it('fails a pending notification picked up after the hour, without calling the provider', async () => {
    const booking = await bookWithEmail();
    currentNow = at(61);

    const { counts } = await useCases.dispatchDue();

    expect(counts.FAILED).toBe(1);
    expect(await notificationRow(booking.notificationId)).toMatchObject({ status: 'FAILED', attempts: 0 });
    expect(provider.messages()).toHaveLength(0);
  });

  it('fails at once on a permanent rejection', async () => {
    const booking = await bookWithEmail();
    provider.setMode('reject');

    const report = await useCases.dispatchOne(booking.notificationId);

    expect(report?.status).toBe('FAILED');
    expect(await notificationRow(booking.notificationId)).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      sealed_tokens: null,
    });
  });

  it('does not send the confirmation of an appointment cancelled before it went out', async () => {
    const booking = await bookWithEmail();
    await useCases.appointments.cancel(booking.appointment.id, at(0.2), 'CUSTOMER');

    await useCases.dispatchOne(booking.notificationId);

    expect(provider.messages()).toHaveLength(0);
    expect(await notificationRow(booking.notificationId)).toMatchObject({
      status: 'NOT_SENT',
      skip_reason: 'APPOINTMENT_CANCELLED',
      sealed_tokens: null,
    });
  });

  it('writes the new hour when the client moved the appointment before it went out (FR-008)', async () => {
    const booking = await bookWithEmail();
    // Friday 18 at 13:00 in Madrid instead of 11:30.
    const start = Temporal.Instant.from('2026-09-18T11:00:00Z');
    await useCases.appointments.updateSchedule(booking.appointment.id, start, start.add({ minutes: 30 }));

    await useCases.dispatchOne(booking.notificationId);

    expect(provider.messages()[0]?.body.text).toContain('de 13:00 a 13:30');
  });

  it('never creates a second notification when the appointment is moved or cancelled (FR-009)', async () => {
    const booking = await bookWithEmail();
    await useCases.dispatchOne(booking.notificationId);
    const start = Temporal.Instant.from('2026-09-18T11:00:00Z');

    await useCases.appointments.updateSchedule(booking.appointment.id, start, start.add({ minutes: 30 }));
    await useCases.appointments.cancel(booking.appointment.id, at(5), 'OWNER');
    currentNow = at(10);
    await useCases.dispatchDue();

    const { rows } = await testPool().query<{ count: string }>('SELECT count(*) AS count FROM notification');
    expect(rows[0]?.count).toBe('1');
    expect(provider.messages()).toHaveLength(1);
  });
});
