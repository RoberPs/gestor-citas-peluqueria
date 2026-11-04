import { expect, test } from '@playwright/test';
import { closeAppointmentsPool, resetAppointments, seedAppointment } from './helpers/appointments';
import { atSalon, clientStarts, openWeekday, PANEL, TIMELINE } from './helpers/agenda';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { closeOwnerPool, resetOwnerAccess, resetPeriods, signInAsOwner } from './helpers/owner';

/**
 * 002, Historia 5 — mover o cancelar una cita desde la agenda (T100), at 360
 * px and at 1280 px. Escenario 6 —«Cancelada por ti» in the bookings list—
 * is checked by T176 on the list's own screen.
 */

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

test('escenarios 1 y 5 — moved half an hour, the old hour is offered again and she is told to call', async ({ page }) => {
  const day = openWeekday();
  const { token } = await seedAppointment({ startsAt: atSalon(day, '11:00') });

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await page.locator(`${TIMELINE} article`).getByRole('link', { name: /^Mover/ }).click();
  await page.locator(PANEL).getByLabel('Hora').selectOption('11:30');
  await page.locator(PANEL).getByRole('button', { name: 'Mover a esta hora' }).click();

  const done = page.getByRole('status').filter({ hasText: 'Cita movida.' });
  await expect(done).toContainText('El cliente no recibe ningún aviso');
  await expect(done.getByRole('link', { name: '600112233' })).toBeVisible();
  await expect(page.locator(`${TIMELINE} article`)).toContainText('11:30–12:00');

  const starts = await clientStarts(page, day);
  expect(starts).toContain('11:00');
  expect(starts).not.toContain('11:30');

  // Its link keeps working, at the new hour (FR-041).
  await page.goto(`/cita/${token}`);
  await expect(page.getByText('11:30').first()).toBeVisible();
});

test('escenarios 2, 3 y 7 — cancelled after an explicit question naming it; the client reads the salon did it', async ({
  page,
}) => {
  const day = openWeekday(1);
  const { token } = await seedAppointment({ startsAt: atSalon(day, '12:00') });

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await page.locator(`${TIMELINE} article`).getByRole('link', { name: /^Cancelar/ }).click();

  const panel = page.locator(PANEL);
  await expect(panel).toContainText('¿Cancelas la cita de Ana López');
  await expect(panel).toContainText('12:00');
  await expectNoAccessibilityViolations(page);
  await panel.getByRole('button', { name: 'Sí, cancelar la cita' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Cita cancelada.' })).toContainText('600112233');

  await page.goto(`/cita/${token}`);
  await expect(page.getByText(/^El salón ha cancelado esta cita/)).toContainText('911 23 45 67');
});

test('escenario 4 — a cancelled appointment cannot be moved nor cancelled again', async ({ page }) => {
  const day = openWeekday();
  await seedAppointment({ startsAt: atSalon(day, '11:00'), status: 'CANCELLED' });

  await page.goto(`/gestion/agenda?fecha=${day}&canceladas=1`);

  const card = page.locator(`${TIMELINE} article`);
  await expect(card).toContainText('Cancelada');
  await expect(card.getByRole('link', { name: /^Mover/ })).toHaveCount(0);
  await expect(card.getByRole('link', { name: /^Cancelar/ })).toHaveCount(0);
});

test('SC-010 y SC-011 — the move panel has no WCAG AA violations and no sideways scroll', async ({ page }) => {
  const day = openWeekday();
  await seedAppointment({ startsAt: atSalon(day, '11:00') });
  await page.goto(`/gestion/agenda?fecha=${day}`);
  await page.locator(`${TIMELINE} article`).getByRole('link', { name: /^Mover/ }).click();

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
