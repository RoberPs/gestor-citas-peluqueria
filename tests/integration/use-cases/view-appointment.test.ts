import { Temporal } from '@js-temporal/polyfill';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConfirmBooking } from '@/application/use-cases/confirm-booking';
import { createViewAppointment } from '@/application/use-cases/view-appointment';
import type { Clock } from '@/domain/shared/clock';
import { createAppointmentRepository } from '@/infrastructure/db/appointment-repository';
import { createSalonConfigRepository } from '@/infrastructure/db/salon-config-repository';
import { tokenGenerator } from '@/infrastructure/security/token';
import { closeTestDb, ensureSchema, testPool, truncateAppointments } from '../helpers/test-db';
import { COLOR, CORTE, seedContractDatabase } from '../../contract/helpers/seed-contract-db';

/**
 * The link resolves to that appointment and to nothing else (FR-018, BR-009),
 * and it shows the service as it was booked, not as the catalogue reads today
 * (FR-016, D-011).
 */

const NOW = Temporal.Instant.from('2026-09-15T08:00:00Z');
let currentNow = NOW;
const clock: Clock = { now: () => currentNow };

const FRIDAY_1130 = '2026-09-18T09:30:00Z';

function build() {
  const config = createSalonConfigRepository(() => testPool());
  const appointments = createAppointmentRepository(() => testPool());

  return {
    confirmBooking: createConfirmBooking({ config, appointments, tokens: tokenGenerator, clock }),
    viewAppointment: createViewAppointment({ config, appointments, tokens: tokenGenerator, clock }),
  };
}

let useCases: ReturnType<typeof build>;

async function bookColor(): Promise<string> {
  const result = await useCases.confirmBooking({
    serviceIds: [COLOR],
    startsAt: FRIDAY_1130,
    contact: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
  });
  if (!result.ok) throw new Error('the fixture booking was rejected');
  return result.value.token;
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
  currentNow = NOW;
  useCases = build();
});

describe('resolving the link', () => {
  it('finds the appointment by the hash of its token', async () => {
    const token = await bookColor();

    const detail = await useCases.viewAppointment(token);

    expect(detail).not.toBeNull();
    expect(detail?.appointment.customer?.name).toBe('Ana López');
    expect(detail?.view).toBe('CONFIRMED');
  });

  it('returns null for a token that resolves to nothing', async () => {
    await bookColor();

    expect(await useCases.viewAppointment('a'.repeat(43))).toBeNull();
  });

  it('returns null for a malformed token, without a separate path for it', async () => {
    await bookColor();

    expect(await useCases.viewAppointment('not-a-token')).toBeNull();
    expect(await useCases.viewAppointment('')).toBeNull();
  });

  it('returns null once the appointment has been anonymised (FR-020, BR-018)', async () => {
    const token = await bookColor();

    await testPool().query(
      `UPDATE appointment
          SET customer_name = NULL, customer_phone = NULL, customer_email = NULL,
              customer_phone_normalized = NULL, customer_email_normalized = NULL,
              token_hash = NULL, anonymized_at = now()`,
    );

    expect(await useCases.viewAppointment(token)).toBeNull();
  });
});

describe('what the link shows', () => {
  it('shows the service snapshot, not the current catalogue (FR-016)', async () => {
    const token = await bookColor();

    await testPool().query(
      `UPDATE service SET name = 'Color premium', price_cents = 9900, duration_minutes = 120
        WHERE id = $1`,
      [COLOR],
    );

    // A fresh use case, so nothing is being served from a warm cache.
    const detail = await build().viewAppointment(token);

    expect(detail?.appointment.services).toEqual([
      {
        serviceId: COLOR,
        name: 'Color',
        durationMinutes: 90,
        priceCents: 5500,
      },
    ]);
  });

  it('carries the salon details every screen shows (FR-014)', async () => {
    const token = await bookColor();

    const detail = await useCases.viewAppointment(token);

    expect(detail?.salon.name.length).toBeGreaterThan(0);
    expect(detail?.salon.address.length).toBeGreaterThan(0);
    expect(detail?.salon.phone.length).toBeGreaterThan(0);
  });

  it('derives COMPLETED from the clock once the appointment is over (FR-031)', async () => {
    const token = await bookColor();

    currentNow = Temporal.Instant.from('2026-09-19T08:00:00Z');

    expect((await useCases.viewAppointment(token))?.view).toBe('COMPLETED');
  });
});

describe('the link gives access to that appointment and no other (BR-009)', () => {
  it('never returns another client appointment', async () => {
    const mine = await bookColor();
    const theirs = await useCases.confirmBooking({
      serviceIds: [COLOR],
      startsAt: '2026-09-18T12:00:00Z',
      contact: { name: 'Otro', phone: '700112233', email: 'otro@example.com' },
    });
    if (!theirs.ok) throw new Error('the second fixture booking was rejected');

    const detail = await useCases.viewAppointment(mine);

    expect(detail?.appointment.id).not.toBe(theirs.value.appointment.id);
    expect(detail?.appointment.customer?.name).toBe('Ana López');
  });
});

describe('an appointment of several services (005, Historia 2)', () => {
  it('shows every service in catalogue order, as each was booked (FR-006, FR-014)', async () => {
    const result = await useCases.confirmBooking({
      serviceIds: [COLOR, CORTE],
      startsAt: FRIDAY_1130,
      contact: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    });
    if (!result.ok) throw new Error('the fixture booking was rejected');

    const detail = await build().viewAppointment(result.value.token);

    // By id: an earlier test in this file renames Color in the catalogue.
    expect(detail?.appointment.services.map((service) => service.serviceId)).toEqual([
      CORTE,
      COLOR,
    ]);
  });
});
