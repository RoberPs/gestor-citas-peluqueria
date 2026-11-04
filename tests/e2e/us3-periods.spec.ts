import { Temporal } from '@js-temporal/polyfill';
import { expect, test, type Page } from '@playwright/test';
import { holidayDate } from '../../db/seed/seed';
import { CORTE_ID, closeAppointmentsPool, resetAppointments, seedAppointment } from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { DAY_GRID, SLOT_LIST } from './helpers/booking';
import { closeOwnerPool, resetOwnerAccess, resetPeriods, signInAsOwner } from './helpers/owner';

/**
 * 002, Historia 3 — bloquear y liberar ratos (T076), at 360 px and at 1280 px.
 *
 * The block is made and released through the agenda, and its effect is read
 * where it matters: on the client's booking screen, with no restart between
 * the two (SC-003).
 */

const TIMEZONE = 'Europe/Madrid';
const TIMELINE = 'ol.timeline';
const FORM = 'section[aria-labelledby="period-heading"]';

/** A weekday a few days ahead, open 10:00–20:00 in the seed and not its holiday. */
function openWeekday(): string {
  const holiday = holidayDate(TIMEZONE);
  let date = Temporal.Now.plainDateISO(TIMEZONE).add({ days: 4 });
  while (date.dayOfWeek > 5 || date.toString() === holiday) date = date.add({ days: 1 });
  return date.toString();
}

function atSalon(date: string, time: string): Date {
  const zoned = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: TIMEZONE, plainTime: Temporal.PlainTime.from(time) });
  return new Date(zoned.epochMilliseconds);
}

async function clientStarts(page: Page, day: string): Promise<readonly string[]> {
  await page.goto(`/?serviceIds=${CORTE_ID}&selectedDate=${day}`);
  await expect(page.locator(SLOT_LIST)).toBeVisible();
  // The visible start only: the hidden label also says when each slot ends.
  return page.locator(`${SLOT_LIST} li span[aria-hidden="true"]`).allInnerTexts();
}

async function blockHours(page: Page, from: string, to: string, reason: string): Promise<void> {
  const form = page.locator(FORM);
  await form.getByLabel('Desde').selectOption(from);
  await form.getByLabel('Hasta').selectOption(to);
  await form.getByLabel('Motivo (opcional)').fill(reason);
  await form.getByRole('button', { name: 'Bloquear este rato' }).click();
}

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

test('escenarios 1 y 2 — a lunch hour leaves the client screen at once, and comes back', async ({ page }) => {
  const day = openWeekday();
  expect(await clientStarts(page, day)).toContain('13:00');

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await blockHours(page, '13:00', '14:00', 'Comida');

  await expect(page.getByRole('status').filter({ hasText: 'Rato bloqueado' })).toBeVisible();
  const block = page.locator(`${TIMELINE} li.timeline-unavailable`);
  await expect(block).toContainText('13:00–14:00');
  await expect(block).toContainText('Comida');

  const blocked = await clientStarts(page, day);
  expect(blocked).toContain('12:30');
  expect(blocked).not.toContain('13:00');
  expect(blocked).not.toContain('13:30');
  expect(blocked).toContain('14:00');
  // FR-021: the reason never reaches the client.
  await expect(page.getByText('Comida')).toHaveCount(0);

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await page.locator(`${TIMELINE} li.timeline-unavailable`).getByRole('button', { name: 'Liberar este rato' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Rato liberado' })).toBeVisible();
  await expect(page.locator(`${TIMELINE} li.timeline-unavailable`)).toHaveCount(0);
  expect(await clientStarts(page, day)).toContain('13:00');
});

test('escenario 3 — whole days away read as closed for the client, without the reason', async ({ page }) => {
  const day = openWeekday();

  await page.goto(`/gestion/agenda?fecha=${day}`);
  const form = page.locator(FORM);
  await form.getByLabel('Qué quieres bloquear').selectOption('dias');
  await form.getByLabel('Primer día').fill(day);
  await form.getByLabel('Último día').fill(day);
  await form.getByLabel('Motivo (opcional)').fill('Vacaciones');
  await form.getByRole('button', { name: 'Bloquear este rato' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Rato bloqueado' })).toBeVisible();
  await expect(page.locator('main')).toContainText('El salón está cerrado este día.');

  await page.goto(`/?serviceIds=${CORTE_ID}`);
  const cell = page
    .locator(`${DAY_GRID} button`)
    .filter({ has: page.locator('.day-number', { hasText: new RegExp(`^${Temporal.PlainDate.from(day).day}$`) }) });
  await expect(cell).toHaveClass(/is-closed/);
  await expect(cell).toHaveAttribute('aria-label', /cerrado/);
  await expect(page.getByText('Vacaciones')).toHaveCount(0);
});

test('escenario 4 — blocking over an appointment names it and cancels nobody', async ({ page }) => {
  const day = openWeekday();
  await seedAppointment({ startsAt: atSalon(day, '13:00') });

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await blockHours(page, '13:00', '14:00', 'Comida');

  const warning = page.locator(FORM).getByRole('alert');
  await expect(warning).toContainText('En ese rato hay citas confirmadas');
  await expect(warning).toContainText('Ana López');
  await expect(warning).toContainText('13:00–13:30');
  await expect(page.locator(`${TIMELINE} li.timeline-unavailable`)).toHaveCount(0);

  await page.getByRole('button', { name: 'Bloquear igualmente, sin cancelar ninguna cita' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Rato bloqueado' })).toBeVisible();
  await expect(page.locator(`${TIMELINE} li.timeline-unavailable`)).toContainText('13:00–14:00');
  // The appointment is still there, confirmed.
  await expect(page.locator(`${TIMELINE} article`)).toContainText('Ana López');
  await expect(page.locator(`${TIMELINE} article`)).not.toContainText('Cancelada');
});

test('a period that is not one is explained, and nothing is saved', async ({ page }) => {
  const day = openWeekday();

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await blockHours(page, '14:00', '13:00', '');

  await expect(page.locator(FORM).getByRole('alert')).toContainText('El final del rato tiene que ser posterior a su inicio');
  await expect(page.locator(`${TIMELINE} li.timeline-unavailable`)).toHaveCount(0);
});

test('a past day offers no form and no release', async ({ page }) => {
  const yesterday = Temporal.Now.plainDateISO(TIMEZONE).subtract({ days: 1 }).toString();

  await page.goto(`/gestion/agenda?fecha=${yesterday}`);

  await expect(page.locator(FORM)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Liberar este rato' })).toHaveCount(0);
});

test('accessibility of the form and of the warning (Principio VII)', async ({ page }) => {
  const day = openWeekday();
  await seedAppointment({ startsAt: atSalon(day, '13:00') });

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  await blockHours(page, '13:00', '14:00', 'Comida');
  await expect(page.locator(FORM).getByRole('alert')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
