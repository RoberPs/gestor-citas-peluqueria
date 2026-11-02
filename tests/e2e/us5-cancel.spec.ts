import { expect, test } from '@playwright/test';
import {
  closeAppointmentsPool,
  resetAppointments,
  seedAppointment,
} from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { bookAppointment, DAY_GRID, SLOT_LIST, clickAndNavigate } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';

/**
 * Historia 5 — cancelar la cita.
 *
 * The scenario that matters most to the salon is the last one: a cancelled
 * hour has to come straight back onto the board, because an hour nobody can
 * book is an hour nobody pays for (FR-023, BR-005).
 */

const APPOINTMENT_CARD = 'section[aria-labelledby="appointment-heading"]';

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test('escenario 1 — cancelling asks for an explicit confirmation first (FR-022)', async ({
  page,
}) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}`);
  await page.getByRole('link', { name: 'Cancelar la cita' }).click();

  await expect(page.getByRole('heading', { name: '¿Seguro que quieres cancelar?' })).toBeVisible();
  await expect(page.getByText('No se puede deshacer.')).toBeVisible();

  // Backing out leaves the appointment exactly as it was.
  await page.getByRole('link', { name: 'No, quedarme con la cita' }).click();
  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Confirmada');
  await expect(page.locator(APPOINTMENT_CARD)).toContainText(localTime);
});

test('escenario 2 — confirming cancels it and the hour goes back on the board', async ({
  page,
}) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}?cancelar=1`);
  await page.getByRole('button', { name: 'Sí, cancelar la cita' }).click();
  await page.waitForURL(`**/cita/${token}`);

  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Cancelada');

  await page.goto('/');
  await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
  const offered = (await page.locator(`${SLOT_LIST} button`).allTextContents()).map((text) =>
    text.trim().slice(0, 5),
  );
  expect(offered).toContain(localTime);
});

test('escenario 3 — inside the 24 hours the options are gone, with the reason and the phone', async ({
  page,
}) => {
  const soon = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const { token } = await seedAppointment({ startsAt: soon });

  await page.goto(`/cita/${token}`);

  // The appointment is still shown in full…
  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Corte');
  // …and both actions are visibly unavailable, with the reason spelled out.
  await expect(page.getByRole('button', { name: 'Cancelar la cita' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cambiar de hora' })).toBeDisabled();
  await expect(page.getByText(/Faltan menos de 24 horas/)).toBeVisible();
  // The phone appears twice on purpose: in the reason and in the salon card.
  await expect(page.getByText(/911 23 45 67/).first()).toBeVisible();
});

test('escenario 4 — cancelling twice is refused and the current state is shown', async ({
  page,
}) => {
  const { token } = await bookAppointment(page);

  await page.goto(`/cita/${token}?cancelar=1`);
  await page.getByRole('button', { name: 'Sí, cancelar la cita' }).click();
  await page.waitForURL(`**/cita/${token}`);

  // Asking for the confirmation panel again gets nowhere: the action is closed.
  await page.goto(`/cita/${token}?cancelar=1`);

  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Cancelada');
  await expect(page.getByRole('button', { name: 'Sí, cancelar la cita' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar la cita' })).toBeDisabled();
  await expect(page.getByText(/Esta cita ya está cancelada/)).toBeVisible();
});

test('escenario 5 — another client can book the freed hour with no fuss', async ({
  page,
  browser,
}) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}?cancelar=1`);
  await page.getByRole('button', { name: 'Sí, cancelar la cita' }).click();
  await page.waitForURL(`**/cita/${token}`);

  // A different client, on a different connection.
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const other = await context.newPage();
  await other.setExtraHTTPHeaders({ 'x-forwarded-for': '198.51.100.42' });

  await other.goto('/');
  await clickAndNavigate(other.getByRole('button', { name: /^Corte/ }));
  await clickAndNavigate(other.locator(`${DAY_GRID} button.is-available`).last());
  await other.getByRole('button', { name: new RegExp(`^${localTime}`) }).click();
  await other.getByLabel('Nombre').fill('Otro Cliente');
  await other.getByLabel('Teléfono').fill('700112233');
  await other.getByLabel('Email').fill('otro@example.com');
  await other.getByRole('button', { name: 'Confirmar la cita' }).click();

  await other.waitForURL(/\/cita\/[A-Za-z0-9_-]{43}\?nueva=1/);
  await expect(other.locator(APPOINTMENT_CARD)).toContainText(localTime);

  await context.close();
});

test('the cancelled appointment stays readable: it is history, not a deletion', async ({
  page,
}) => {
  const { token, localTime } = await bookAppointment(page);

  await page.goto(`/cita/${token}?cancelar=1`);
  await page.getByRole('button', { name: 'Sí, cancelar la cita' }).click();
  await page.waitForURL(`**/cita/${token}`);

  await page.goto(`/cita/${token}`);

  await expect(page.locator(APPOINTMENT_CARD)).toContainText('Corte');
  await expect(page.locator(APPOINTMENT_CARD)).toContainText(localTime);
});

test('SC-010 y SC-011 — no WCAG AA violations and no sideways scroll at 360 px', async ({
  page,
}) => {
  const { token } = await bookAppointment(page);

  // The confirmation panel is a screen state of its own.
  await page.goto(`/cita/${token}?cancelar=1`);
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Sí, cancelar la cita' }).click();
  await page.waitForURL(`**/cita/${token}`);
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
