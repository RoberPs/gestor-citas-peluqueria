import { expect, test } from '@playwright/test';
import { closeAppointmentsPool, resetAppointments } from './helpers/appointments';
import { atSalon, clientStarts, fillCustomer, openNewAppointment, openWeekday, PANEL, TIMELINE } from './helpers/agenda';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { clickAndNavigate } from './helpers/booking';
import { closeOwnerPool, insertBooking, resetOwnerAccess, resetPeriods, signInAsOwner } from './helpers/owner';

/**
 * 002, Historia 4 — apuntar una cita a mano (T088), at 360 px and at 1280 px.
 * Its effect is read on the timeline and on the client's booking screen.
 */

const LUIS = { name: 'Luis Pérez', phone: '611 22 33 44' };

test.beforeEach(async ({ page }) => {
  await resetAppointments();
  await resetPeriods();
  await resetOwnerAccess();
  await signInAsOwner(page);
});

test.afterAll(async () => {
  await closeAppointmentsPool();
  await closeOwnerPool();
});

test('escenarios 1, 2 y 6 — without email, marked as hers, and the client stops seeing the hour', async ({ page }) => {
  const day = openWeekday();
  expect(await clientStarts(page, day)).toContain('16:00');

  await openNewAppointment(page, day, '16:00');
  await fillCustomer(page, LUIS);
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Cita apuntada.' })).toBeVisible();
  const card = page.locator(`${TIMELINE} article`).filter({ hasText: 'Luis Pérez' });
  await expect(card).toContainText('16:00–16:30');
  await expect(card).toContainText('Apuntada por ti');
  // Nobody to call: the client has no link to be told through.
  await expect(page.getByText('El cliente no recibe ningún aviso')).toHaveCount(0);

  expect(await clientStarts(page, day)).not.toContain('16:00');
});

test('escenario 2 — without a name it is not created, and the form says which field', async ({ page }) => {
  const day = openWeekday();
  await openNewAppointment(page, day, '16:00');
  await fillCustomer(page, { name: '', phone: LUIS.phone });
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Revisa el nombre.' })).toBeVisible();
  await expect(page.locator(PANEL).getByLabel('Nombre')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator(PANEL).getByLabel('Teléfono')).toHaveValue(LUIS.phone);
});

test('escenario 4 — outside the opening hours it warns, and creates once confirmed', async ({ page }) => {
  const day = openWeekday();
  await openNewAppointment(page, day, '20:30');
  await page.locator(PANEL).getByLabel('Hora').selectOption('20:30');
  await fillCustomer(page, LUIS);
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Queda fuera del horario del salón.');
  await expectNoAccessibilityViolations(page);
  await dialog.getByRole('button', { name: 'Aplicar y guardar' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Cita apuntada.' })).toBeVisible();
  await expect(page.locator(`${TIMELINE} article`).filter({ hasText: 'Luis Pérez' })).toContainText('20:30–21:00');
});

test('escenario 5 — the fourth future appointment of the same phone is refused', async ({ page }) => {
  const day = openWeekday();
  for (const time of ['10:00', '11:00', '12:00']) {
    await insertBooking({ startsAt: atSalon(day, time), name: 'Luis Pérez', phone: '611223344', origin: 'OWNER' });
  }

  await openNewAppointment(page, day, '16:00');
  await fillCustomer(page, LUIS);
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'ya tiene 3 citas por delante' })).toBeVisible();
});

test('escenarios 7 y 8 — two services show their total and fill it; none is refused', async ({ page }) => {
  const day = openWeekday();
  await openNewAppointment(page, day, '16:00');

  await clickAndNavigate(page.locator(PANEL).getByRole('button', { name: /^Lavado/ }));
  await expect(page.locator(PANEL).locator('.selection-summary')).toContainText('1 h');

  await fillCustomer(page, LUIS);
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();
  await expect(page.locator(`${TIMELINE} article`).filter({ hasText: 'Luis Pérez' })).toContainText('16:00–17:00');

  await openNewAppointment(page, day, '18:00');
  await clickAndNavigate(page.locator(PANEL).getByRole('button', { name: /^Corte/ }));
  await fillCustomer(page, { name: 'Marta Ruiz', phone: '622 33 44 55' });
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Una cita tiene al menos un servicio.' })).toBeVisible();
});

test('SC-002 — from the agenda in four gestures: the free stretch, the data, «Guardar»', async ({ page }) => {
  const day = openWeekday();
  await page.goto(`/gestion/agenda?fecha=${day}`);

  await page.locator(`${TIMELINE} li.timeline-free`).first().getByRole('link', { name: /Apuntar una cita aquí/ }).click();
  await fillCustomer(page, LUIS);
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Cita apuntada.' })).toBeVisible();
});

test('SC-010 y SC-011 — no WCAG AA violations and no sideways scroll', async ({ page }) => {
  await openNewAppointment(page, openWeekday(), '16:00');

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
