import { expect, test } from '@playwright/test';
import {
  closeAppointmentsPool,
  resetAppointments,
  seedAppointment,
  slotDaysFromNow,
} from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { bookAppointment } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';

/**
 * Historia 4 — consultar la cita más tarde.
 *
 * The completed and cancelled views are seeded straight into the database:
 * against a real clock there is no other way to stand on the far side of an
 * appointment.
 */

const APPOINTMENT_CARD = 'section[aria-labelledby="appointment-heading"]';
const NEUTRAL_MESSAGE = 'No hemos encontrado ninguna cita con este enlace.';

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test('escenario 1 — a confirmed appointment in time shows everything and both actions', async ({
  page,
}) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}`);

  const card = page.locator(APPOINTMENT_CARD);
  await expect(card).toContainText('Confirmada');
  await expect(card).toContainText('Corte');
  await expect(card).toContainText(localTime);
  await expect(card).toContainText('30 min');

  await expect(page.getByRole('link', { name: 'Cambiar de hora' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancelar la cita' })).toBeVisible();
});

test('escenario 2 — four broken links, one message, no difference between them', async ({
  page,
}) => {
  // A link that never was.
  await page.goto(`/cita/${'a'.repeat(43)}`);
  const invented = await page.locator('main').innerText();

  // A malformed one.
  await page.goto('/cita/no-es-un-token');
  const malformed = await page.locator('main').innerText();

  // One whose appointment was deleted.
  const { token } = await bookAppointment(page);
  await resetAppointments();
  await page.goto(`/cita/${token}`);
  const deleted = await page.locator('main').innerText();

  // And one anonymised by retention: seeded, then stripped the way the purge
  // strips it (FR-035, BR-018).
  const seeded = await seedAppointment({ startsAt: slotDaysFromNow(5) });
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL_TEST'] ?? '', max: 1 });
  await pool.query(
    `UPDATE appointment
        SET customer_name = NULL, customer_phone = NULL, customer_email = NULL,
            customer_phone_normalized = NULL, customer_email_normalized = NULL,
            token_hash = NULL, anonymized_at = now()`,
  );
  await pool.end();
  await page.goto(`/cita/${seeded.token}`);
  const anonymised = await page.locator('main').innerText();

  for (const screen of [invented, malformed, deleted, anonymised]) {
    expect(screen).toContain(NEUTRAL_MESSAGE);
    expect(screen).toBe(invented);
  }

  // And the way out is offered rather than left to the client to find.
  await expect(page.getByRole('link', { name: 'Reservar una cita nueva' })).toBeVisible();
});

test('escenario 3 — a past appointment is read only, and a new one is offered', async ({
  page,
}) => {
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const { token } = await seedAppointment({ startsAt: past });

  await page.goto(`/cita/${token}`);

  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Completada');
  await expect(page.getByText('Esta cita ya ha pasado. Puedes consultarla, pero no cambiarla.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar la cita' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cambiar de hora' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Reservar una cita nueva' })).toBeVisible();
});

test('escenario 4 — a cancelled appointment is read only, and a new one is offered', async ({
  page,
}) => {
  const { token } = await seedAppointment({
    startsAt: slotDaysFromNow(6),
    status: 'CANCELLED',
  });

  await page.goto(`/cita/${token}`);

  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Cancelada');
  await expect(page.getByText('Esta cita está cancelada. Si quieres venir, reserva una nueva.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar la cita' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cambiar de hora' })).toBeDisabled();
});

test('escenario 5 — the link shows that appointment and nothing else (FR-018, BR-009)', async ({
  page,
}) => {
  const mine = await seedAppointment({ startsAt: slotDaysFromNow(6, 11, 30) });
  await seedAppointment({ startsAt: slotDaysFromNow(6, 16, 0) });

  await page.goto(`/cita/${mine.token}`);
  const screen = await page.locator('main').innerText();

  expect(screen).toContain('11:30');
  // The other client's hour is nowhere on the page.
  expect(screen).not.toContain('16:00');
  // Nor is any contact detail, not even the client's own.
  expect(screen).not.toContain('600112233');
  expect(screen).not.toContain('ana@example.com');
});

test('FR-028 — inside the deadline the actions are closed, with the reason and the phone', async ({
  page,
}) => {
  // Six hours away: past the 24 hour deadline.
  const soon = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const { token } = await seedAppointment({ startsAt: soon });

  await page.goto(`/cita/${token}`);

  await expect(page.getByRole('button', { name: 'Cancelar la cita' })).toBeDisabled();
  await expect(page.getByText(/Faltan menos de 24 horas para tu cita/)).toBeVisible();
  await expect(page.getByText(/Llama al salón al 911 23 45 67/)).toBeVisible();
});

test('SC-010 y SC-011 — no WCAG AA violations on all three views at 360 px', async ({ page }) => {
  const confirmed = await seedAppointment({ startsAt: slotDaysFromNow(6) });
  await page.goto(`/cita/${confirmed.token}`);
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  const cancelled = await seedAppointment({
    startsAt: slotDaysFromNow(7),
    status: 'CANCELLED',
  });
  await page.goto(`/cita/${cancelled.token}`);
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  const past = await seedAppointment({ startsAt: new Date(Date.now() - 48 * 60 * 60 * 1000) });
  await page.goto(`/cita/${past.token}`);
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  // And the neutral screen, which is a client-facing screen like any other.
  await page.goto(`/cita/${'a'.repeat(43)}`);
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
