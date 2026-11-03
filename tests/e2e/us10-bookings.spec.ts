import { Temporal } from '@js-temporal/polyfill';
import { expect, test, type Page } from '@playwright/test';
import { closeAppointmentsPool, resetAppointments, slotDaysFromNow } from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { clickAndNavigate } from './helpers/booking';
import { closeOwnerPool, insertBooking, resetOwnerAccess, signInAsOwner } from './helpers/owner';

/**
 * 002, Historia 10 — consultar el listado de reservas (T176), its eleven
 * scenarios and US5-6 (who cancelled), at 360 px and at 1280 px.
 */

const TIMEZONE = 'Europe/Madrid';
const ROWS = 'ol.booking-list > li';

function daysFromNow(days: number, hour = 11): Date {
  return slotDaysFromNow(days, hour, 0);
}

function salonDate(at: Date): string {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(TIMEZONE).toPlainDate().toString();
}

async function filter(page: Page, choices: Record<string, string>): Promise<void> {
  for (const [label, value] of Object.entries(choices)) {
    const field = page.getByLabel(label, { exact: true });
    if ((await field.evaluate((element) => element.tagName)) === 'SELECT') await field.selectOption(value);
    else await field.fill(value);
  }
  await clickAndNavigate(page.getByRole('button', { name: 'Ver las reservas' }));
}

test.beforeEach(async ({ page }) => {
  await resetAppointments();
  await resetOwnerAccess();
  await signInAsOwner(page);
});

test.afterAll(async () => {
  await closeAppointmentsPool();
  await closeOwnerPool();
});

test('escenario 1 — upcoming confirmed bookings by default, by date, none cancelled', async ({ page }) => {
  await insertBooking({ startsAt: daysFromNow(5), name: 'Segunda' });
  await insertBooking({ startsAt: daysFromNow(2), name: 'Primera' });
  await insertBooking({ startsAt: daysFromNow(3), name: 'Cancelada', cancelledBy: 'CUSTOMER' });

  await page.goto('/gestion/reservas');

  await expect(page.locator(ROWS)).toHaveCount(2);
  await expect(page.locator(ROWS).nth(0)).toContainText('Primera');
  await expect(page.locator(ROWS).nth(1)).toContainText('Segunda');
});

test('escenario 2 — most recent bookings first, past ones included', async ({ page }) => {
  await insertBooking({ startsAt: daysFromNow(-10), name: 'Pasada', createdAt: new Date(Date.now() - 1000) });
  await insertBooking({ startsAt: daysFromNow(4), name: 'Antigua', createdAt: new Date(Date.now() - 86_400_000) });

  await page.goto('/gestion/reservas');
  await filter(page, { Orden: 'recientes' });

  await expect(page.locator(ROWS).nth(0)).toContainText('Pasada');
  await expect(page.locator(ROWS).nth(1)).toContainText('Antigua');
});

test('escenario 3 and US5-6 — cancelled ones say when and who: the client or you', async ({ page }) => {
  await insertBooking({ startsAt: daysFromNow(2), name: 'Por cliente', cancelledBy: 'CUSTOMER' });
  await insertBooking({ startsAt: daysFromNow(3), name: 'Por ti', cancelledBy: 'OWNER' });

  await page.goto('/gestion/reservas');
  await filter(page, { Estado: 'canceladas' });

  await expect(page.locator(ROWS).nth(0)).toContainText('× Cancelada por el cliente el');
  await expect(page.locator(ROWS).nth(1)).toContainText('× Cancelada por ti el');
});

test('escenario 4 — each row: day and hour, services, name, phone, state, origin and booking date', async ({ page }, testInfo) => {
  await insertBooking({ startsAt: daysFromNow(2), name: 'José Núñez' });

  await page.goto('/gestion/reservas');

  const row = page.locator(ROWS).first();
  await expect(row).toContainText('11:00–11:30');
  await expect(row).toContainText('Corte');
  await expect(row).toContainText('José Núñez');
  await expect(row.getByRole('link', { name: '600112233' })).toBeVisible();
  await expect(row).toContainText('Confirmada');
  const secondary = row.getByText(/Reservada online · Reservada el/);
  if (testInfo.project.name === 'desktop-1280') await expect(secondary).toBeVisible();
  else await expect(secondary).toBeHidden();
});

test('escenario 5 — by hand, and within a range of days', async ({ page }) => {
  const inRange = daysFromNow(3);
  await insertBooking({ startsAt: inRange, name: 'A mano dentro', origin: 'OWNER' });
  await insertBooking({ startsAt: daysFromNow(8), name: 'A mano fuera', origin: 'OWNER' });
  await insertBooking({ startsAt: daysFromNow(4), name: 'Online dentro' });

  await page.goto('/gestion/reservas');
  await filter(page, { Origen: 'mano', 'Desde el día': salonDate(inRange), 'Hasta el día': salonDate(daysFromNow(5)) });

  await expect(page.locator(ROWS)).toHaveCount(1);
  await expect(page.locator(ROWS).first()).toContainText('A mano dentro');
});

test('escenario 6 — twenty a page, the next page repeats nothing, back to the first keeps the filters', async ({ page }) => {
  for (let index = 0; index < 23; index += 1) {
    await insertBooking({ startsAt: daysFromNow(2 + Math.floor(index / 8), 10 + (index % 8)), name: `Cliente ${index}`, phone: `6001122${String(index).padStart(2, '0')}` });
  }

  await page.goto('/gestion/reservas');
  await filter(page, { 'Buscar por nombre o teléfono': 'cliente' });
  await expect(page.locator(ROWS)).toHaveCount(20);
  const firstPage = await page.locator(ROWS).allInnerTexts();

  await clickAndNavigate(page.getByRole('link', { name: 'Página siguiente' }));
  await expect(page.locator(ROWS)).toHaveCount(3);
  const secondPage = await page.locator(ROWS).allInnerTexts();
  expect(secondPage.some((text) => firstPage.includes(text))).toBe(false);

  await clickAndNavigate(page.getByRole('link', { name: 'Volver al principio' }));
  await expect(page.locator(ROWS)).toHaveCount(20);
  await expect(page.getByLabel('Buscar por nombre o teléfono')).toHaveValue('cliente');
});

test('escenario 7 — a row leads to that day of the agenda', async ({ page }) => {
  const startsAt = daysFromNow(3);
  await insertBooking({ startsAt });

  await page.goto('/gestion/reservas');
  await clickAndNavigate(page.locator(ROWS).first().getByRole('link', { name: 'Ver ese día en la agenda' }));

  await expect(page).toHaveURL(new RegExp(`/gestion/agenda\\?fecha=${salonDate(startsAt)}`));
});

test('escenario 8 — nothing found says so and offers the defaults back', async ({ page }) => {
  await insertBooking({ startsAt: daysFromNow(3) });

  await page.goto('/gestion/reservas');
  await filter(page, { Origen: 'mano' });

  await expect(page.getByText('No hay ninguna reserva con estos filtros.')).toBeVisible();
  await clickAndNavigate(page.getByRole('main').getByRole('link', { name: 'Volver a los filtros por defecto' }).first());
  await expect(page.locator(ROWS)).toHaveCount(1);
});

test('escenario 9 — a name without accents or case, and a phone any way it is written', async ({ page }) => {
  await insertBooking({ startsAt: daysFromNow(2), name: 'José Núñez', phone: '600112233' });
  await insertBooking({ startsAt: daysFromNow(3), name: 'Ana López', phone: '611223344' });
  await page.goto('/gestion/reservas');

  for (const term of ['jose', 'NUÑEZ', 'nunez', '+34 600 11 22 33', '0034600112233']) {
    await filter(page, { 'Buscar por nombre o teléfono': term });
    await expect(page.locator(ROWS)).toHaveCount(1);
    await expect(page.locator(ROWS).first()).toContainText('José Núñez');
  }

  await filter(page, { 'Buscar por nombre o teléfono': '600 11' });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Ese teléfono está incompleto.');
});

test('escenario 10 — cancelled, most recent first, of one client', async ({ page }) => {
  await insertBooking({ startsAt: daysFromNow(2), name: 'José Núñez', cancelledBy: 'CUSTOMER' });
  await insertBooking({ startsAt: daysFromNow(3), name: 'José Núñez' });
  await insertBooking({ startsAt: daysFromNow(4), name: 'Ana López', cancelledBy: 'CUSTOMER' });

  await page.goto('/gestion/reservas');
  await filter(page, { Orden: 'recientes', Estado: 'canceladas', 'Buscar por nombre o teléfono': 'jose' });

  await expect(page.locator(ROWS)).toHaveCount(1);
  await expect(page.locator(ROWS).first()).toContainText('José Núñez');
  await expect(page.locator(ROWS).first()).toContainText('Cancelada por el cliente');
});

test('escenario 11 — an anonymised booking shows without personal data and is never found', async ({ page }) => {
  await insertBooking({ startsAt: daysFromNow(2), name: null });

  await page.goto('/gestion/reservas');
  await expect(page.locator(ROWS).first()).toContainText('Datos del cliente borrados por antigüedad');

  await filter(page, { 'Buscar por nombre o teléfono': 'ana' });
  await expect(page.locator(ROWS)).toHaveCount(0);
});

test('the list passes axe and fits the width', async ({ page }) => {
  await insertBooking({ startsAt: daysFromNow(2), name: 'José Núñez' });
  await insertBooking({ startsAt: daysFromNow(3), name: 'Ana López', cancelledBy: 'OWNER' });

  await page.goto('/gestion/reservas?estado=todas');

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
