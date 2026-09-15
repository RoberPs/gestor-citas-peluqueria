import { expect, test } from '@playwright/test';
import { closeAppointmentsPool, resetAppointments } from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { bookAppointment } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';

/**
 * Historia 3 — recibir la confirmación en pantalla.
 *
 * This screen is the **only** place the client ever gets their link: v1 sends
 * no message at all (asunción 5). If it fails to make that clear, the client
 * loses access to their own appointment.
 */

const APPOINTMENT_CARD = 'section[aria-labelledby="appointment-heading"]';

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test('escenario 1 — the confirmation carries the appointment and the salon (FR-014)', async ({
  page,
}) => {
  const { localTime } = await bookAppointment(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Cita confirmada!');

  const card = page.locator(APPOINTMENT_CARD);
  await expect(card).toContainText('Corte');
  await expect(card).toContainText(localTime);
  await expect(card).toContainText('30 min');
  await expect(card).toContainText('hasta 24 horas antes');

  const salon = page.locator('section[aria-labelledby="salon-heading"]');
  await expect(salon).toContainText('Peluquería Aurora');
  await expect(salon).toContainText('Calle Mayor 14');
  await expect(salon).toContainText('911 23 45 67');
});

test('escenario 2 — the link is shown with a prominent warning to save it (FR-015)', async ({
  page,
}) => {
  const { token } = await bookAppointment(page);

  const notice = page.locator('section[aria-labelledby="save-link-heading"]');

  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Guarda este enlace');
  // It says plainly that nothing will be sent, because nothing will be.
  await expect(notice).toContainText('No te lo vamos a enviar por SMS ni por email');
  // And the link itself is there, in full, ready to copy.
  await expect(notice.getByRole('link')).toHaveText(new RegExp(token));
});

test('escenario 3 — reloading the confirmation does not create a second appointment', async ({
  page,
}) => {
  const { url } = await bookAppointment(page);

  await page.reload();
  await page.reload();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Cita confirmada!');

  // The URL is a GET; the POST is never repeated (D-010).
  expect(page.url()).toBe(url);
  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Confirmada');
});

test('the same screen without ?nueva=1 drops the save notice but keeps the appointment', async ({
  page,
}) => {
  const { token } = await bookAppointment(page);

  await page.goto(`/cita/${token}`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cita');
  await expect(page.locator('section[aria-labelledby="save-link-heading"]')).toHaveCount(0);
  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Corte');
});

test('SC-010 y SC-011 — no WCAG AA violations and no sideways scroll at 360 px', async ({
  page,
}) => {
  await bookAppointment(page);

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
