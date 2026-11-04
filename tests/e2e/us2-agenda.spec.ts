import { Temporal } from '@js-temporal/polyfill';
import { expect, test } from '@playwright/test';
import {
  closeAppointmentsPool,
  resetAppointments,
  seedAppointment,
  slotDaysFromNow,
} from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { clickAndNavigate } from './helpers/booking';
import {
  closeOwnerPool,
  insertPeriod,
  resetOwnerAccess,
  resetPeriods,
  signInAsOwner,
} from './helpers/owner';

/**
 * 002, Historia 2 — ver la agenda del día (T063), at 360 px and at 1280 px.
 *
 * Appointments and the blocked hour are written straight into the database:
 * booking through the screens would spend the client rate limit on setup, and
 * the form for blocking time has its own suite (`us3-periods.spec.ts`).
 */

const TIMEZONE = 'Europe/Madrid';

function salonDate(at: Date): string {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(TIMEZONE).toPlainDate().toString();
}

function atSalon(date: string, time: string): Date {
  const zoned = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: TIMEZONE, plainTime: Temporal.PlainTime.from(time) });
  return new Date(zoned.epochMilliseconds);
}

function nextSunday(): string {
  let date = Temporal.Now.plainDateISO(TIMEZONE).add({ days: 1 });
  while (date.dayOfWeek !== 7) date = date.add({ days: 1 });
  return date.toString();
}

const TIMELINE = 'ol.timeline';

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

test('escenarios 1 y 7 — the appointments in order, with every service, name and phone', async ({ page }) => {
  const day = salonDate(slotDaysFromNow(3));
  await seedAppointment({ startsAt: atSalon(day, '16:00') });
  await seedAppointment({
    startsAt: atSalon(day, '11:00'),
    services: [
      { id: '00000000-0000-4000-8000-000000000011', name: 'Corte', minutes: 30, cents: 1800 },
      { id: '00000000-0000-4000-8000-000000000014', name: 'Lavado', minutes: 30, cents: null },
    ],
  });

  await page.goto(`/gestion/agenda?fecha=${day}`);

  const cards = page.locator(`${TIMELINE} article`);
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('11:00–12:00');
  await expect(cards.nth(0)).toContainText('Corte');
  await expect(cards.nth(0)).toContainText('Lavado');
  await expect(cards.nth(0)).toContainText('Ana López');
  await expect(cards.nth(0).getByRole('link', { name: '600112233' })).toBeVisible();
  await expect(cards.nth(1)).toContainText('16:00–16:30');
});

test('escenario 2 — the origin is said in words, beside its icon', async ({ page }) => {
  const day = salonDate(slotDaysFromNow(3));
  await seedAppointment({ startsAt: atSalon(day, '11:00') });

  await page.goto(`/gestion/agenda?fecha=${day}`);

  await expect(page.locator(`${TIMELINE} article`).first()).toContainText('Reservada online');
});

test('escenario 3 — a blocked hour shows on the timeline with its reason', async ({ page }) => {
  const day = salonDate(slotDaysFromNow(3));
  await insertPeriod(atSalon(day, '13:00'), atSalon(day, '14:00'), 'Comida');

  await page.goto(`/gestion/agenda?fecha=${day}`);

  await expect(page.locator(`${TIMELINE} .timeline-unavailable`)).toContainText('13:00–14:00');
  await expect(page.locator(`${TIMELINE} .timeline-unavailable`)).toContainText('No disponible · Comida');
});

test('escenario 4 — another day, then back to today in one click', async ({ page }) => {
  await page.goto('/gestion/agenda');
  const today = salonDate(new Date());

  await clickAndNavigate(page.getByRole('link', { name: 'Día siguiente' }));
  await expect(page).toHaveURL(/fecha=/);

  await clickAndNavigate(page.getByRole('link', { name: 'Hoy' }));
  await expect(page).toHaveURL(new RegExp(`fecha=${today}`));
  await expect(page.getByRole('link', { name: 'Hoy' })).toHaveAttribute('aria-current', 'date');
});

test('escenario 5 — a past day can be read, and says it cannot be changed', async ({ page }) => {
  const lastWeek = Temporal.Now.plainDateISO(TIMEZONE).subtract({ days: 7 }).toString();

  await page.goto(`/gestion/agenda?fecha=${lastWeek}`);

  await expect(page.getByText('Este día ya ha pasado: puedes consultarlo, pero no cambiar nada.')).toBeVisible();
});

test('escenario 6 — "no appointments" and "closed" are told apart', async ({ page }) => {
  await page.goto(`/gestion/agenda?fecha=${salonDate(slotDaysFromNow(3))}`);
  await expect(page.getByText('No hay ninguna cita este día.')).toBeVisible();

  await page.goto(`/gestion/agenda?fecha=${nextSunday()}`);
  await expect(page.getByText('El salón está cerrado este día.')).toBeVisible();
});

test('FR-015 — a cancelled appointment shows only when asked, saying who cancelled', async ({ page }) => {
  const day = salonDate(slotDaysFromNow(3));
  await seedAppointment({ startsAt: atSalon(day, '11:00'), status: 'CANCELLED' });

  await page.goto(`/gestion/agenda?fecha=${day}`);
  await expect(page.locator(`${TIMELINE} article`)).toHaveCount(0);

  await clickAndNavigate(page.getByRole('link', { name: 'Mostrar también las canceladas' }));
  await expect(page.locator(`${TIMELINE} article`)).toContainText('Cancelada por el cliente');
});

test('the agenda passes axe and fits the width', async ({ page }) => {
  const day = salonDate(slotDaysFromNow(3));
  await seedAppointment({ startsAt: atSalon(day, '11:00') });
  await insertPeriod(atSalon(day, '13:00'), atSalon(day, '14:00'), 'Comida');

  await page.goto(`/gestion/agenda?fecha=${day}`);

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
