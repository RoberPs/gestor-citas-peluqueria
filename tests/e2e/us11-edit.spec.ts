import { expect, test, type Page } from '@playwright/test';
import { closeAppointmentsPool, CORTE_ID, resetAppointments, seedAppointment } from './helpers/appointments';
import { atSalon, clientStarts, openWeekday, PANEL, TIMELINE } from './helpers/agenda';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { clickAndNavigate } from './helpers/booking';
import { closeOwnerPool, insertBooking, resetOwnerAccess, resetPeriods, signInAsOwner } from './helpers/owner';

/**
 * 002, Historia 11 — editar una cita (T204), at 360 px and at 1280 px. Its
 * effect is read on the timeline, on the client's booking screen and on the
 * client's own link.
 */

const LAVADO = { id: '00000000-0000-4000-8000-000000000014', name: 'Lavado', minutes: 30, cents: null };
const CORTE = { id: CORTE_ID, name: 'Corte', minutes: 30, cents: 1500 };

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

async function openEdit(page: Page, day: string): Promise<void> {
  await page.goto(`/gestion/agenda?fecha=${day}`);
  await page.locator(`${TIMELINE} article`).first().getByRole('link', { name: /^Editar/ }).click();
  await expect(page.locator(PANEL).getByRole('heading', { name: 'Editar la cita' })).toBeVisible();
}

test('escenarios 1, 4 y 6 — a service added shows the new end, keeps the old price and keeps the link', async ({ page }) => {
  const day = openWeekday();
  const { token } = await seedAppointment({ startsAt: atSalon(day, '11:00'), services: [CORTE] });

  await openEdit(page, day);
  await clickAndNavigate(page.locator(PANEL).getByRole('button', { name: /^Lavado/ }));
  await expect(page.locator(PANEL)).toContainText('Terminaría a las 12:00');
  await page.locator(PANEL).getByRole('button', { name: 'Guardar los cambios' }).click();

  const done = page.getByRole('status').filter({ hasText: 'Cita editada.' });
  await expect(done).toContainText('El cliente no recibe ningún aviso');
  await expect(page.locator(`${TIMELINE} article`)).toContainText('11:00–12:00');
  expect(await clientStarts(page, day)).not.toContain('11:30');

  await page.goto(`/cita/${token}`);
  await expect(page.getByText('Lavado').first()).toBeVisible();
  // The service it already had keeps the price it was booked at (BR-021).
  await expect(page.getByText('15,00 €').first()).toBeVisible();
});

test('escenario 2 — a service removed frees the time; the last one cannot go', async ({ page }) => {
  const day = openWeekday();
  await seedAppointment({ startsAt: atSalon(day, '11:00'), services: [CORTE, LAVADO] });

  await openEdit(page, day);
  await clickAndNavigate(page.locator(PANEL).getByRole('button', { name: /^Lavado/ }));
  await page.locator(PANEL).getByRole('button', { name: 'Guardar los cambios' }).click();
  await expect(page.locator(`${TIMELINE} article`)).toContainText('11:00–11:30');
  expect(await clientStarts(page, day)).toContain('11:30');

  await openEdit(page, day);
  await clickAndNavigate(page.locator(PANEL).getByRole('button', { name: /^Corte/ }));
  await page.locator(PANEL).getByRole('button', { name: 'Guardar los cambios' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Una cita tiene al menos un servicio.' })).toBeVisible();
});

test('escenario 3 — growing over Ana names her, and nothing changes until it is resolved', async ({ page }) => {
  const day = openWeekday();
  await seedAppointment({ startsAt: atSalon(day, '11:00'), services: [CORTE] });
  await insertBooking({ startsAt: atSalon(day, '11:30'), name: 'Ana' });

  await openEdit(page, day);
  await clickAndNavigate(page.locator(PANEL).getByRole('button', { name: /^Lavado/ }));
  await page.locator(PANEL).getByRole('button', { name: 'Guardar los cambios' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('11:30–12:00');
  await expect(dialog).toContainText('Ana · Corte');
  await expectNoAccessibilityViolations(page);
  await dialog.getByRole('button', { name: 'Volver sin cambiar nada' }).click();

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await expect(page.locator(`${TIMELINE} article`).first()).toContainText('11:00–11:30');
});

test('escenario 5 — a malformed phone is refused by name; a good one is saved and the link still works', async ({
  page,
}) => {
  const day = openWeekday();
  const { token } = await seedAppointment({ startsAt: atSalon(day, '11:00') });

  await openEdit(page, day);
  await page.locator(PANEL).getByLabel('Teléfono').fill('123');
  await page.locator(PANEL).getByRole('button', { name: 'Guardar los cambios' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Revisa el teléfono.' })).toBeVisible();

  await page.locator(PANEL).getByLabel('Teléfono').fill('699 88 77 66');
  await page.locator(PANEL).getByRole('button', { name: 'Guardar los cambios' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cita editada.' })).toContainText('699 88 77 66');

  await page.goto(`/cita/${token}`);
  await expect(page.getByText('11:00').first()).toBeVisible();
});

test('escenario 7 — a cancelled one offers no «Editar»', async ({ page }) => {
  const day = openWeekday();
  await seedAppointment({ startsAt: atSalon(day, '11:00'), status: 'CANCELLED' });

  await page.goto(`/gestion/agenda?fecha=${day}&canceladas=1`);
  await expect(page.locator(`${TIMELINE} article`).getByRole('link', { name: /^Editar/ })).toHaveCount(0);
});

test('SC-010 y SC-011 — the edit panel has no WCAG AA violations and no sideways scroll', async ({ page }) => {
  const day = openWeekday();
  await seedAppointment({ startsAt: atSalon(day, '11:00') });

  await openEdit(page, day);

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
