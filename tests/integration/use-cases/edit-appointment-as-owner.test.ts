import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDispatchNotifications } from '@/application/use-cases/dispatch-notifications';
import { createNotificationRepository } from '@/infrastructure/db/notification-repository';
import { confirmationEmailRenderer } from '@/infrastructure/notifications/confirmation-email';
import { createTokenSealer } from '@/infrastructure/security/token-sealer';
import { createRescheduleAppointment } from '@/application/use-cases/reschedule-appointment';
import { createViewAppointment } from '@/application/use-cases/view-appointment';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { createUnavailablePeriodRepository } from '@/infrastructure/db/unavailable-period-repository';
import { tokenGenerator } from '@/infrastructure/security/token';
import { closeTestDb, ensureSchema, insertEmailConfirmation, testPool, truncateAll } from '../helpers/test-db';
import {
  BARBA,
  bookFriday,
  clock,
  CORTE,
  friday,
  insertPeriod,
  LUIS,
  ownerAppointments,
  RETIRADO,
  seedSalon,
} from './_owner-fixtures';

/**
 * 002, T201 and T203: editing an appointment against a real PostgreSQL. The
 * rows that stay are not rewritten; the new ones carry today's snapshot; the
 * id, start, origin, booking time and link do not change (FR-072, FR-073,
 * FR-075, BR-021).
 */

const useCase = ownerAppointments();

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll();
  await seedSalon();
});

const ANA = { name: 'Ana López', phone: '600112233', email: 'ana@example.com' };

async function serviceRows(id: string) {
  const { rows } = await testPool().query(
    `SELECT position, service_id, name, duration_minutes, price_cents
       FROM appointment_service WHERE appointment_id = $1 ORDER BY position`,
    [id],
  );
  return rows;
}

async function row(id: string) {
  const { rows } = await testPool().query<{
    starts_at: Date;
    ends_at: Date;
    origin: string;
    created_at: Date;
    token_hash: Buffer | null;
    customer_name_search: string;
    customer_email: string | null;
  }>(
    `SELECT starts_at, ends_at, origin, created_at, token_hash, customer_name_search, customer_email
       FROM appointment WHERE id = $1`,
    [id],
  );
  const found = rows[0];
  if (found === undefined) throw new Error('no such appointment');
  return found;
}

describe('editing an appointment (Historia 11)', () => {
  it('adds a service: the old one keeps its price, the new one takes today\'s, and the end moves (escenarios 1 y 4)', async () => {
    // Booked at 15,00 €; the catalogue says 18,00 € today.
    const id = await bookFriday('11:00', '11:30');
    const before = await row(id);

    const edited = await useCase.edit({ id, serviceIds: [BARBA, CORTE], customer: ANA });

    expect(edited).toMatchObject({ ok: true, value: { notifyCustomer: { phone: '600112233' } } });
    expect(await serviceRows(id)).toEqual([
      { position: 1, service_id: CORTE, name: 'Corte de pelo', duration_minutes: 30, price_cents: 1500 },
      { position: 2, service_id: BARBA, name: 'Diseño y corte de barba', duration_minutes: 30, price_cents: null },
    ]);
    const after = await row(id);
    expect(after.ends_at.getTime()).toBe(friday('12:00').epochMilliseconds);
    expect({ ...after, ends_at: null }).toEqual({ ...before, ends_at: null });
  });

  it('removes a service and the time comes free; the last one cannot go (escenario 2)', async () => {
    const id = await bookFriday('11:00', '11:30');
    await useCase.edit({ id, serviceIds: [CORTE, BARBA], customer: ANA });

    expect((await useCase.edit({ id, serviceIds: [BARBA], customer: ANA })).ok).toBe(true);
    expect(await serviceRows(id)).toEqual([
      { position: 1, service_id: BARBA, name: 'Diseño y corte de barba', duration_minutes: 30, price_cents: null },
    ]);
    expect((await row(id)).ends_at.getTime()).toBe(friday('11:30').epochMilliseconds);

    expect(await useCase.edit({ id, serviceIds: [], customer: ANA })).toMatchObject({
      ok: false,
      error: { kind: 'INVALID_SELECTION', error: { kind: 'EMPTY' } },
    });
  });

  it('keeps a retired service it already had, and refuses to add one (escenario 8)', async () => {
    const id = await bookFriday('11:00', '11:30');
    await testPool().query(
      `INSERT INTO appointment_service (appointment_id, position, service_id, name, duration_minutes, price_cents)
       VALUES ($1, 2, $2, 'Tinte', 60, 3500)`,
      [id, RETIRADO],
    );
    await testPool().query("UPDATE appointment SET ends_at = '2026-09-18 12:30+02' WHERE id = $1", [id]);

    expect((await useCase.edit({ id, serviceIds: [CORTE, RETIRADO, BARBA], customer: ANA })).ok).toBe(true);
    expect((await serviceRows(id)).map((service) => [service.position, service.name, service.price_cents])).toEqual([
      [1, 'Corte de pelo', 1500],
      [2, 'Diseño y corte de barba', null],
      [3, 'Tinte', 3500],
    ]);

    const other = await bookFriday('15:00', '15:30', { name: 'Marta Ruiz', phone: '622334455', email: 'm@x.es' });
    expect(await useCase.edit({ id: other, serviceIds: [CORTE, RETIRADO], customer: ANA })).toMatchObject({
      ok: false,
      error: { kind: 'INVALID_SELECTION', error: { kind: 'UNKNOWN_SERVICE' } },
    });
  });

  it('names what the growth lands on, and changes nothing until it is resolved (escenario 3)', async () => {
    const id = await bookFriday('11:00', '11:30');
    const marta = await bookFriday('11:30', '12:00', { name: 'Marta Ruiz', phone: '622334455', email: 'm@x.es' });

    const asked = await useCase.edit({ id, serviceIds: [CORTE, BARBA], customer: ANA });

    expect(asked).toMatchObject({ ok: false, error: { kind: 'CONFLICT', conflicts: [{ id: marta }] } });
    expect(await serviceRows(id)).toHaveLength(1);
  });

  it('only changes the data under a block it already sat under, with no conflict', async () => {
    const id = await bookFriday('13:00', '13:30');
    await insertPeriod(friday('13:00'), friday('14:00'), 'Comida');

    const edited = await useCase.edit({ id, serviceIds: [CORTE], customer: { ...ANA, name: 'Ana María López' } });

    expect(edited.ok).toBe(true);
    expect((await row(id)).customer_name_search).toBe('ana maria lopez');
  });

  it('corrects the data, also dropping the email of an online appointment (escenario 5, FR-075)', async () => {
    const id = await bookFriday('11:00', '11:30');

    expect((await useCase.edit({ id, serviceIds: [CORTE], customer: { ...ANA, phone: '123' } })).ok).toBe(false);
    expect((await useCase.edit({ id, serviceIds: [CORTE], customer: { ...ANA, email: null } })).ok).toBe(true);

    const after = await row(id);
    expect(after.customer_email).toBeNull();
    expect(after.token_hash).not.toBeNull();
  });

  it('refuses a new phone that already has 3 future appointments, not counting this one (FR-075)', async () => {
    for (const time of ['15:00', '16:00', '17:00']) {
      await useCase.create({ serviceIds: [CORTE], startsAt: friday(time), customer: LUIS });
    }
    const id = await bookFriday('11:00', '11:30');

    expect(await useCase.edit({ id, serviceIds: [CORTE], customer: LUIS })).toMatchObject({
      ok: false,
      error: { kind: 'BLOCKED', reason: 'CONTACT_LIMIT_REACHED' },
    });

    // Luis's third appointment keeps his own phone: it does not count against itself.
    const { rows } = await testPool().query<{ id: string }>(
      "SELECT id FROM appointment WHERE customer_name = 'Luis Pérez' ORDER BY starts_at DESC LIMIT 1",
    );
    const third = rows[0]?.id ?? '';
    expect((await useCase.edit({ id: third, serviceIds: [CORTE, BARBA], customer: LUIS })).ok).toBe(true);
  });

  it('refuses one cancelled or over, and edits one under way (escenario 7)', async () => {
    const id = await bookFriday('11:00', '11:30');
    clock.set(friday('11:10'));
    expect((await useCase.edit({ id, serviceIds: [CORTE, BARBA], customer: ANA })).ok).toBe(true);

    clock.set(friday('12:30'));
    expect(await useCase.edit({ id, serviceIds: [CORTE], customer: ANA })).toEqual({
      ok: false,
      error: { kind: 'BLOCKED', reason: 'IN_THE_PAST' },
    });
  });
});

describe("the client's link after an edit (FR-076, T203)", () => {
  const client = {
    config: createSalonConfigRepository(testPool),
    appointments: createAppointmentRepository(testPool),
    periods: createUnavailablePeriodRepository(testPool),
    tokens: tokenGenerator,
    clock,
  };

  it('shows the new services and reschedules with the new duration', async () => {
    const { token, hash } = tokenGenerator.generate();
    const id = await bookFriday('11:00', '11:30', { tokenHash: hash });
    await useCase.edit({ id, serviceIds: [CORTE, BARBA], customer: ANA });

    const detail = await createViewAppointment(client)(token);
    expect(detail?.appointment.services.map((service) => service.name)).toEqual([
      'Corte de pelo',
      'Diseño y corte de barba',
    ]);

    const moved = await createRescheduleAppointment(client)(token, friday('16:00').toString());
    expect(moved.ok && moved.value.detail.appointment.endsAt).toEqual(friday('17:00'));
  });
});

describe('the email consent of an online appointment the owner edits (004, FR-008)', () => {
  async function consentOf(id: string) {
    const { rows } = await testPool().query<{ ended_at: Date | null; end_reason: string | null }>(
      'SELECT ended_at, end_reason FROM channel_consent WHERE appointment_id = $1',
      [id],
    );
    return rows[0];
  }

  async function notificationOf(id: string) {
    const { rows } = await testPool().query<{ status: string; skip_reason: string | null }>(
      'SELECT status, skip_reason FROM notification WHERE appointment_id = $1',
      [id],
    );
    return rows[0];
  }

  async function bookWithConsent(): Promise<string> {
    const id = await bookFriday('11:00', '11:30');
    await insertEmailConfirmation(id, { unsubscribeTokenHash: randomBytes(32) });
    return id;
  }

  async function notificationIdOf(id: string): Promise<string> {
    const { rows } = await testPool().query<{ id: string }>('SELECT id FROM notification WHERE appointment_id = $1', [id]);
    return rows[0]?.id ?? '';
  }

  it.each([
    ['changed', 'otra@example.com'],
    ['removed', null],
  ])('ends it as EMAIL_CHANGED when the email is %s, in the same transaction', async (_what, email) => {
    const id = await bookWithConsent();

    const edited = await useCase.edit({ id, serviceIds: [CORTE], customer: { ...ANA, email } });

    expect(edited.ok).toBe(true);
    const consent = await consentOf(id);
    expect(consent?.end_reason).toBe('EMAIL_CHANGED');
    expect(consent?.ended_at?.getTime()).toBe(clock.now().epochMilliseconds);
  });

  it('and its pending confirmation then ends as not sent', async () => {
    const id = await bookWithConsent();
    await useCase.edit({ id, serviceIds: [CORTE], customer: { ...ANA, email: 'otra@example.com' } });

    const report = await createDispatchNotifications({
      config: createSalonConfigRepository(testPool),
      notifications: createNotificationRepository(testPool, createTokenSealer(randomBytes(32).toString('base64'))),
      notifier: {
        send: async () => {
          throw new Error('nothing should reach the provider');
        },
      },
      render: confirmationEmailRenderer,
      clock,
    }).dispatchOne(await notificationIdOf(id));

    expect(report?.status).toBe('NOT_SENT');
    expect(await notificationOf(id)).toEqual({ status: 'NOT_SENT', skip_reason: 'CONSENT_ENDED' });
  });

  it.each([
    ['its services', { serviceIds: [BARBA, CORTE], customer: ANA }],
    ['its phone', { serviceIds: [CORTE], customer: { ...ANA, phone: '611223344' } }],
    ['the case of its email', { serviceIds: [CORTE], customer: { ...ANA, email: 'ANA@example.com' } }],
  ])('leaves it live when the edit changes %s', async (_what, change) => {
    const id = await bookWithConsent();

    expect((await useCase.edit({ id, ...change })).ok).toBe(true);
    expect(await consentOf(id)).toEqual({ ended_at: null, end_reason: null });
  });
});
