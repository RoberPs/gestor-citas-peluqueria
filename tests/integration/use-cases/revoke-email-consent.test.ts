import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConfirmBooking } from '@/application/use-cases/confirm-booking';
import { createDispatchNotifications } from '@/application/use-cases/dispatch-notifications';
import { createRevokeEmailConsent } from '@/application/use-cases/revoke-email-consent';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository, createPersonalDataPurge } from '@/infrastructure/db/appointment-repository';
import { createConsentRepository } from '@/infrastructure/db/consent-repository';
import { createNotificationRepository } from '@/infrastructure/db/notification-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { confirmationEmailRenderer } from '@/infrastructure/notifications/confirmation-email';
import { tokenGenerator } from '@/infrastructure/security/token';
import { createTokenSealer } from '@/infrastructure/security/token-sealer';
import { TEST_SEAL_KEY } from '../helpers/fake-email';
import { closeTestDb, ensureSchema, testPool, truncateAppointments } from '../helpers/test-db';
import { CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * 004, Historia 2: the unsubscribe, from the email and from the appointment.
 * It ends the consent of that appointment and nothing else (FR-016), and a
 * notification still pending afterwards is never sent.
 */

/** Tuesday 2026-09-15, 10:00 in Madrid. */
const BOOKED_AT = Temporal.Instant.from('2026-09-15T08:00:00Z');
let currentNow = BOOKED_AT;
const clock: Clock = { now: () => currentNow };

const FRIDAY_1130 = '2026-09-18T09:30:00Z';
const sealer = createTokenSealer(TEST_SEAL_KEY);

function build() {
  const config = createSalonConfigRepository(() => testPool());
  const appointments = createAppointmentRepository(() => testPool());
  return {
    confirmBooking: createConfirmBooking({
      config,
      appointments,
      periods: createUnavailablePeriodRepository(() => testPool()),
      tokens: tokenGenerator,
      clock,
      notifications: { channels: { enabledChannels: () => new Set(['EMAIL']) }, sealer },
    }),
    revoke: createRevokeEmailConsent({
      config,
      appointments,
      consents: createConsentRepository(() => testPool()),
      tokens: tokenGenerator,
      clock,
    }),
    dispatch: createDispatchNotifications({
      config,
      notifications: createNotificationRepository(() => testPool(), sealer),
      notifier: {
        send: async () => {
          throw new Error('nothing should reach the provider');
        },
      },
      render: confirmationEmailRenderer,
      clock,
    }),
  };
}

let useCases: ReturnType<typeof build>;

/** A booking with the checkbox, and its two clear tokens, read from its pending notification. */
async function book() {
  const result = await useCases.confirmBooking({
    serviceIds: [CORTE],
    startsAt: FRIDAY_1130,
    contact: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    emailConsent: true,
  });
  if (!result.ok || result.value.notificationId === null) throw new Error('the fixture booking was rejected');

  const { rows } = await testPool().query<{ sealed_tokens: Buffer }>(
    'SELECT sealed_tokens FROM notification WHERE id = $1',
    [result.value.notificationId],
  );
  const tokens = sealer.open(rows[0]?.sealed_tokens ?? new Uint8Array());
  if (tokens === null) throw new Error('the fixture tokens do not open');

  return {
    appointmentId: result.value.appointment.id,
    notificationId: result.value.notificationId,
    management: tokens.management,
    unsubscribe: tokens.unsubscribe,
  };
}

async function consentRow() {
  const { rows } = await testPool().query<{ ended_at: Date | null; end_reason: string | null }>(
    'SELECT ended_at, end_reason FROM channel_consent',
  );
  return rows[0];
}

async function appointmentRow(id: string) {
  const { rows } = await testPool().query('SELECT * FROM appointment WHERE id = $1', [id]);
  return rows[0] as Record<string, unknown> | undefined;
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
  currentNow = BOOKED_AT;
  useCases = build();
});

describe.each([
  ['the unsubscribe token', 'byUnsubscribeToken', 'unsubscribe'],
  ['the management token', 'byManagementToken', 'management'],
] as const)('by %s', (_by, method, token) => {
  it('ends the consent as UNSUBSCRIBED, now', async () => {
    const booking = await book();
    currentNow = BOOKED_AT.add({ minutes: 5 });

    expect(await useCases.revoke[method](booking[token])).toEqual({ ok: true, value: 'UNSUBSCRIBED' });

    const row = await consentRow();
    expect(row?.end_reason).toBe('UNSUBSCRIBED');
    expect(row?.ended_at?.getTime()).toBe(currentNow.epochMilliseconds);
  });

  it('is harmless the second time, and keeps the first end', async () => {
    const booking = await book();
    currentNow = BOOKED_AT.add({ minutes: 5 });
    await useCases.revoke[method](booking[token]);
    const first = await consentRow();

    currentNow = BOOKED_AT.add({ minutes: 9 });
    expect(await useCases.revoke[method](booking[token])).toEqual({ ok: true, value: 'ALREADY_ENDED' });
    expect(await consentRow()).toEqual(first);
  });

  it('leaves the appointment exactly as it was', async () => {
    const booking = await book();
    const before = await appointmentRow(booking.appointmentId);

    await useCases.revoke[method](booking[token]);

    expect(await appointmentRow(booking.appointmentId)).toEqual(before);
  });

  it('works on a cancelled appointment, and on a past one', async () => {
    const cancelled = await book();
    await testPool().query(
      "UPDATE appointment SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'CUSTOMER' WHERE id = $1",
      [cancelled.appointmentId],
    );
    expect(await useCases.revoke[method](cancelled[token])).toEqual({ ok: true, value: 'UNSUBSCRIBED' });

    await truncateAppointments();
    const past = await book();
    currentNow = Temporal.Instant.from('2026-10-01T08:00:00Z');
    expect(await useCases.revoke[method](past[token])).toEqual({ ok: true, value: 'UNSUBSCRIBED' });
  });

  it('stops a notification still pending: it ends as not sent (FR-016)', async () => {
    const booking = await book();

    await useCases.revoke[method](booking[token]);
    const report = await useCases.dispatch.dispatchOne(booking.notificationId);

    expect(report?.status).toBe('NOT_SENT');
    const { rows } = await testPool().query<{ status: string; skip_reason: string }>(
      'SELECT status, skip_reason FROM notification',
    );
    expect(rows[0]).toEqual({ status: 'NOT_SENT', skip_reason: 'CONSENT_ENDED' });
  });

  it.each([
    ['unknown', 'A'.repeat(43)],
    ['malformed', 'not-a-token'],
    ['empty', ''],
  ])('answers NOT_FOUND for a token %s', async (_what, value) => {
    await book();
    expect(await useCases.revoke[method](value)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('answers NOT_FOUND once the appointment has been anonymised (FR-018)', async () => {
    const booking = await book();
    await createPersonalDataPurge(() => testPool()).anonymizeOne(booking.appointmentId);

    expect(await useCases.revoke[method](booking[token])).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('by the management token, an appointment without a consent', () => {
  it('is harmless: there is nothing to end (FR-017)', async () => {
    const result = await useCases.confirmBooking({
      serviceIds: [CORTE],
      startsAt: FRIDAY_1130,
      contact: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    });
    if (!result.ok) throw new Error('the fixture booking was rejected');

    expect(await useCases.revoke.byManagementToken(result.value.token)).toEqual({ ok: true, value: 'NO_CONSENT' });
  });
});

describe('inspect, for the page before the button (FR-015)', () => {
  it('names the salon and says whether it is already done, without ending anything', async () => {
    const booking = await book();

    expect(await useCases.revoke.inspect(booking.unsubscribe)).toEqual({
      ok: true,
      value: { salonName: 'Peluqueria Aurora', alreadyEnded: false },
    });
    expect((await consentRow())?.ended_at).toBeNull();

    await useCases.revoke.byUnsubscribeToken(booking.unsubscribe);
    expect(await useCases.revoke.inspect(booking.unsubscribe)).toEqual({
      ok: true,
      value: { salonName: 'Peluqueria Aurora', alreadyEnded: true },
    });
  });

  it('answers NOT_FOUND as the revocation does', async () => {
    expect(await useCases.revoke.inspect('A'.repeat(43))).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});
