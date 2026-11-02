import { expect, test } from '@playwright/test';
import { closeAppointmentsPool, resetAppointments } from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { bookAppointment, DAY_GRID, SLOT_LIST, clickAndNavigate } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';

/** The appointment summary, as opposed to the salon one further down. */
const APPOINTMENT_CARD = 'section[aria-labelledby="appointment-heading"]';

/**
 * Historia 6 — reprogramar la cita.
 *
 * The six acceptance scenarios, at 360 px, with axe on the screen.
 */

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test('escenario 1 — only hours for the same service, with no way to change it', async ({
  page,
}) => {
  const { token } = await bookAppointment(page, { service: 'Color' });

  await page.goto(`/cita/${token}/reprogramar`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cambiar de hora');
  await expect(page.getByText(/Estás cambiando la hora de tu Color/)).toBeVisible();
  // FR-024: the service picker is not on this screen at all.
  await expect(page.locator('.service-option')).toHaveCount(0);
  await expect(page.locator(SLOT_LIST)).toBeVisible();
});

test('escenario 4 — the client own hour is offered and marked as theirs', async ({ page }) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}/reprogramar`);

  const own = page.locator(`${SLOT_LIST} button.is-current-appointment`);

  await expect(own).toHaveCount(1);
  await expect(own).toContainText(localTime);
  await expect(own).toContainText('tu hora actual');
});

test('escenario 2 — the appointment moves, and the link does not change', async ({ page }) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}/reprogramar`);

  // Any hour other than the one already held.
  const other = page
    .locator(`${SLOT_LIST} button:not(.is-current-appointment)`)
    .first();
  const newTime = ((await other.textContent()) ?? '').trim().slice(0, 5);
  await other.click();

  await page.getByRole('button', { name: 'Sí, cambiar a esta hora' }).click();

  // FR-026: the same token, and it still resolves.
  await page.waitForURL(`**/cita/${token}`);
  await expect(page.getByText('Confirmada')).toBeVisible();
  await expect(page.locator(APPOINTMENT_CARD)).toContainText(newTime);
  expect(newTime).not.toBe(localTime);
});

test('escenario 2 — the old hour is free again straight away', async ({ page }) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}/reprogramar`);
  const other = page.locator(`${SLOT_LIST} button:not(.is-current-appointment)`).first();
  await other.click();
  await page.getByRole('button', { name: 'Sí, cambiar a esta hora' }).click();
  await page.waitForURL(`**/cita/${token}`);

  // Back on the booking screen, the hour just vacated is on offer again.
  await page.goto('/');
  await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());

  const offered = (await page.locator(`${SLOT_LIST} button`).allTextContents()).map((text) =>
    text.trim().slice(0, 5),
  );
  expect(offered).toContain(localTime);
});

test('escenario 5 — choosing the hour already held changes nothing and says so', async ({
  page,
}) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}/reprogramar`);
  await page.locator(`${SLOT_LIST} button.is-current-appointment`).click();
  await page.getByRole('button', { name: 'Sí, cambiar a esta hora' }).click();

  await expect(
    page.getByText('Esa es la hora que ya tenías, así que no hemos cambiado nada.'),
  ).toBeVisible();

  // And the appointment is exactly where it was.
  await page.goto(`/cita/${token}`);
  await expect(page.locator(APPOINTMENT_CARD)).toContainText(localTime);
});

test('FR-022 — nothing moves without an explicit confirmation', async ({ page }) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}/reprogramar`);
  await page.locator(`${SLOT_LIST} button:not(.is-current-appointment)`).first().click();

  await expect(page.getByRole('heading', { name: '¿Cambias tu cita a esta hora?' })).toBeVisible();

  // Backing out leaves the appointment alone.
  await page.getByRole('link', { name: 'No, dejarlo como está' }).click();
  await page.goto(`/cita/${token}`);
  await expect(page.locator(APPOINTMENT_CARD)).toContainText(localTime);
});

test('escenario 6 — a cancelled appointment cannot be rescheduled', async ({ page }) => {
  const { token } = await bookAppointment(page);

  await page.goto(`/cita/${token}?cancelar=1`);
  await page.getByRole('button', { name: 'Sí, cancelar la cita' }).click();
  await page.waitForURL(`**/cita/${token}`);

  // The action is gone from the appointment screen…
  await expect(page.getByRole('button', { name: 'Cambiar de hora' })).toBeDisabled();

  // …and reaching the screen directly explains why rather than offering hours.
  await page.goto(`/cita/${token}/reprogramar`);
  await expect(page.getByText('No hemos podido cambiar la hora de esta cita.')).toBeVisible();
  await expect(page.getByText(/ya está cancelada/)).toBeVisible();
  await expect(page.locator(SLOT_LIST)).toHaveCount(0);
});

test('a link that does not resolve gets the neutral screen here too', async ({ page }) => {
  await page.goto(`/cita/${'a'.repeat(43)}/reprogramar`);

  await expect(
    page.getByText('No hemos encontrado ninguna cita con este enlace.'),
  ).toBeVisible();
});

test('SC-010 y SC-011 — no WCAG AA violations and no sideways scroll at 360 px', async ({
  page,
}) => {
  const { token } = await bookAppointment(page);

  await page.goto(`/cita/${token}/reprogramar`);
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  // The confirmation step is a screen of its own and gets checked as one.
  await page.locator(`${SLOT_LIST} button:not(.is-current-appointment)`).first().click();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
