import { expect, test, type Page } from '@playwright/test';
import { closeAppointmentsPool, resetAppointments } from './helpers/appointments';
import { atSalon, fillCustomer, openNewAppointment, openWeekday, PANEL, TIMELINE } from './helpers/agenda';
import { expectNoAccessibilityViolations } from './helpers/axe';
import { closeOwnerPool, insertBooking, insertPeriod, resetOwnerAccess, resetPeriods, signInAsOwner } from './helpers/owner';

/**
 * 002, Historia 6 — resolver un conflicto a la vista (T113), at 360 px and at
 * 1280 px. The dialog is a modal: focus kept inside, given back to the
 * button that opened it, and the conflict announced (Principio VII).
 * Escenario 5, two devices at once, is proven against the database by T110.
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

async function tryAt16(page: Page, day: string) {
  await openNewAppointment(page, day, '16:00');
  await fillCustomer(page, LUIS);
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();
  return page.getByRole('dialog');
}

test('escenarios 1 y 2 — Ana is named before anything is touched, and walking away changes nothing', async ({ page }) => {
  const day = openWeekday();
  await insertBooking({ startsAt: atSalon(day, '15:45'), name: 'Ana' });

  const dialog = await tryAt16(page, day);

  await expect(dialog).toContainText('15:45–16:15');
  await expect(dialog).toContainText('Ana · Corte');
  await expect(dialog.getByRole('alert')).toContainText('Hay algo en esa hora.');
  await expectNoAccessibilityViolations(page);

  await dialog.getByRole('button', { name: 'Volver sin cambiar nada' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' })).toBeFocused();

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await expect(page.locator(`${TIMELINE} article`)).toHaveCount(1);
  await expect(page.locator(`${TIMELINE} article`)).toContainText('Ana');
});

test('escenarios 3 y 6 — cancelling Ana and saving the new one happen together', async ({ page }) => {
  const day = openWeekday();
  await insertBooking({ startsAt: atSalon(day, '15:45'), name: 'Ana' });

  const dialog = await tryAt16(page, day);
  await dialog.getByLabel('Cancelar esta cita para dejar sitio').check();
  await dialog.getByRole('button', { name: 'Aplicar y guardar' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Cita apuntada.' })).toBeVisible();
  await page.goto(`/gestion/agenda?fecha=${day}&canceladas=1`);
  await expect(page.locator(`${TIMELINE} article`).filter({ hasText: 'Ana' })).toContainText('Cancelada por ti');
  await expect(page.locator(`${TIMELINE} article`).filter({ hasText: 'Luis Pérez' })).toContainText('16:00–16:30');
});

test('escenario 4 — a blocked stretch is named with its reason, and shortened to make room', async ({ page }) => {
  const day = openWeekday();
  await insertPeriod(atSalon(day, '15:30'), atSalon(day, '17:00'), 'Recado');

  const dialog = await tryAt16(page, day);
  await expect(dialog).toContainText('15:30–17:00');
  await expect(dialog).toContainText('Recado');
  await expect(dialog.getByLabel('Eliminar el rato bloqueado')).toBeVisible();

  await dialog.getByLabel('Dejarlo de 15:30 a 16:00').check();
  await dialog.getByRole('button', { name: 'Aplicar y guardar' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Cita apuntada.' })).toBeVisible();
  await expect(page.locator(`${TIMELINE} li.timeline-unavailable`)).toContainText('15:30–16:00');
});
