import { Temporal } from '@js-temporal/polyfill';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  closeAppointmentsPool,
  resetAppointments,
  seedAppointment,
  slotDaysFromNow,
} from './helpers/appointments';
import { expectNoHorizontalScroll } from './helpers/axe';
import { useOwnClientIp } from './helpers/client-ip';

/**
 * 003 — the client screens at the three sizes of the responsive layout.
 *
 * Every scenario sets its own viewport, so the file runs in the `desktop-1280`
 * project only (D-009).
 */

const SERVICE_ID = '00000000-0000-4000-8000-000000000011';
const TIMEZONE = process.env['SALON_TIMEZONE'] ?? 'Europe/Madrid';

const SERVICES = 'section[aria-labelledby="service-heading"]';
const DAYS = 'section[aria-labelledby="day-heading"]';
const SLOTS = 'section[aria-labelledby="slot-heading"]';
const SUMMARY = 'section[aria-labelledby="summary-heading"]';
const FORM = 'section[aria-labelledby="form-heading"]';

const CHOOSE_HOUR_HINT =
  'Elige una hora y aquí verás el resumen de tu cita y el formulario para tus datos.';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 360, height: 740 };

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

/** A free hour for Corte, in the URL shape `/reservar` receives it. */
function freeSlotUrl(): string {
  return `/reservar?serviceId=${SERVICE_ID}&startsAt=${slotDaysFromNow(5).toISOString()}`;
}

/** The salon's calendar day of an instant. */
function salonDateOf(at: Date): string {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime())
    .toZonedDateTimeISO(TIMEZONE)
    .toPlainDate()
    .toString();
}

/** The next Sunday, when the seeded salon is closed, inside the first range. */
function nextSunday(): string {
  let date = Temporal.Now.plainDateISO(TIMEZONE).add({ days: 1 });
  while (date.dayOfWeek !== 7) date = date.add({ days: 1 });
  return date.toString();
}

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (rect === null) throw new Error('element is not rendered');
  return rect;
}

async function chooseLastDay(page: Page): Promise<string> {
  const day = page.locator(`${DAYS} button.is-available`).last();
  const date = (await day.getAttribute('value')) ?? '';
  await day.click();
  await page.waitForURL(new RegExp(`selectedDate=${date}`));
  return date;
}

async function chooseHour(page: Page, index: number): Promise<string> {
  const hour = page.locator(`${SLOTS} button[name="startsAt"]`).nth(index);
  const startsAt = (await hour.getAttribute('value')) ?? '';
  await hour.click();
  await page.waitForURL((url) => url.searchParams.get('startsAt') === startsAt);
  return startsAt;
}

async function fillContact(page: Page, contact: { name: string; phone: string; email: string }) {
  await page.getByLabel('Nombre').fill(contact.name);
  await page.getByLabel('Teléfono').fill(contact.phone);
  await page.getByLabel('Email').fill(contact.email);
}

async function expectContact(page: Page, contact: { name: string; phone: string; email: string }) {
  await expect(page.getByLabel('Nombre')).toHaveValue(contact.name);
  await expect(page.getByLabel('Teléfono')).toHaveValue(contact.phone);
  await expect(page.getByLabel('Email')).toHaveValue(contact.email);
}

const ANA = { name: 'Ana López', phone: '600 11 22 33', email: 'ana@example.com' };

test.describe('sin desplazamiento horizontal', () => {
  const WIDTHS = [320, 360, 640, 768, 1024, 1280, 1920];

  async function screens(): Promise<string[]> {
    const { token } = await seedAppointment({ startsAt: slotDaysFromNow(6) });

    return [
      '/',
      freeSlotUrl(),
      `/cita/${token}`,
      `/cita/${token}/reprogramar`,
      `/cita/${'a'.repeat(43)}`,
    ];
  }

  for (const width of WIDTHS) {
    test(`SC-003 — ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });

      for (const path of await screens()) {
        await page.goto(path);
        await expectNoHorizontalScroll(page);
      }
    });
  }

  test('FR-005 — 1280 × 800 al 400 % de zoom, emulado con 320 × 200', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 200 });

    for (const path of await screens()) {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
    }
  });
});

test.describe('US1 — reserva en ordenador', () => {
  test.use({ viewport: DESKTOP });

  test('escenario 1 — servicio y días a la izquierda, horas a la derecha', async ({ page }) => {
    await page.goto('/');

    const services = await box(page.locator(SERVICES));
    const days = await box(page.locator(DAYS));
    const slots = await box(page.locator(SLOTS));

    expect(services.x).toBeLessThan(slots.x);
    expect(days.x).toBeLessThan(slots.x);
    expect(services.y).toBeLessThan(DESKTOP.height / 2);
    expect(slots.y).toBeLessThan(DESKTOP.height / 2);
    await expect(page.locator(DAYS)).toBeInViewport();

    await expect(page.getByText(CHOOSE_HOUR_HINT)).toBeVisible();

    // SC-002: at least 900 px of the 1280 are put to use.
    expect((await box(page.locator('main'))).width).toBeGreaterThanOrEqual(900);
  });

  test('escenario 2 — elegir día muestra sus horas a la derecha', async ({ page }) => {
    await page.goto('/');
    const before = await page.locator(`${SLOTS} p.muted`).first().textContent();

    const date = await chooseLastDay(page);

    await expect(page.locator(`${DAYS} button[value="${date}"]`)).toHaveAttribute(
      'aria-current',
      'date',
    );
    await expect(page.locator(`${SLOTS} p.muted`).first()).not.toHaveText(before ?? '');
    expect((await box(page.locator(DAYS))).x).toBeLessThan((await box(page.locator(SLOTS))).x);
  });

  test('escenario 3 — elegir hora pone resumen y formulario a la derecha', async ({ page }) => {
    await page.goto('/');
    const date = await chooseLastDay(page);
    const startsAt = await chooseHour(page, 0);

    expect(new URL(page.url()).pathname).toBe('/reservar');

    const chosen = page.locator(`${SLOTS} button[aria-pressed="true"]`);
    await expect(chosen).toHaveCount(1);
    await expect(chosen).toHaveAttribute('value', startsAt);
    await expect(chosen).toContainText('Elegida');

    const days = await box(page.locator(DAYS));
    expect((await box(page.locator(SUMMARY))).x).toBeGreaterThan(days.x);
    expect((await box(page.locator(FORM))).x).toBeGreaterThan(days.x);

    await expect(page.locator(SERVICES)).toBeVisible();
    await expect(page.locator(`${SERVICES} button[aria-pressed="true"]`)).toBeVisible();
    await expect(page.locator(`${DAYS} button[value="${date}"]`)).toHaveAttribute(
      'aria-current',
      'date',
    );
  });

  test('escenario 4 — lo escrito sobrevive al cambio de hora y de día', async ({ page }) => {
    await page.goto('/');
    await chooseLastDay(page);
    await chooseHour(page, 0);
    await fillContact(page, ANA);

    await chooseHour(page, 1);
    await expectContact(page, ANA);

    const firstDay = page.locator(`${DAYS} button.is-available`).first();
    await firstDay.click();
    await page.waitForURL((url) => url.pathname === '/');
    await chooseHour(page, 0);
    await expectContact(page, ANA);
  });

  test('escenario 5 — el error queda junto a su campo, en la columna derecha', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseLastDay(page);
    await chooseHour(page, 0);
    await fillContact(page, { ...ANA, phone: '123' });
    await page.getByRole('button', { name: 'Confirmar la cita' }).click();

    const error = page.locator('#phone-error');
    await expect(error).toBeVisible();
    expect((await box(error)).x).toBeGreaterThan((await box(page.locator(DAYS))).x);
    await expect(page.getByLabel('Nombre')).toHaveValue(ANA.name);
    await expect(page.getByLabel('Email')).toHaveValue(ANA.email);
  });

  test('escenario 6 — un día cerrado ofrece el siguiente con huecos', async ({ page }) => {
    await page.goto(`/?serviceId=${SERVICE_ID}&selectedDate=${nextSunday()}`);

    const slots = page.locator(SLOTS);
    await expect(slots.getByText('El salón está cerrado este día.')).toBeVisible();
    await expect(slots.getByRole('button', { name: /el siguiente día con huecos/ })).toBeVisible();
    expect((await box(slots)).x).toBeGreaterThan((await box(page.locator(DAYS))).x);
  });

  test('escenario 7 — Atrás deshace la hora y recargar la conserva', async ({ page }) => {
    await page.goto('/');
    const date = await chooseLastDay(page);
    await chooseHour(page, 0);

    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/');
    expect(new URL(page.url()).searchParams.get('startsAt')).toBeNull();
    expect(new URL(page.url()).searchParams.get('selectedDate')).toBe(date);
    await expect(page.locator(`${SLOTS} button[aria-pressed="true"]`)).toHaveCount(0);

    const startsAt = await chooseHour(page, 0);
    await fillContact(page, ANA);
    await page.reload();

    await expect(page.locator(`${SLOTS} button[aria-pressed="true"]`)).toHaveAttribute(
      'value',
      startsAt,
    );
    await expect(page.locator(`${DAYS} button[value="${date}"]`)).toHaveAttribute(
      'aria-current',
      'date',
    );
    await expect(page.locator(`${SERVICES} button[aria-pressed="true"]`)).toBeVisible();
    await expectContact(page, { name: '', phone: '', email: '' });
  });

  test('D-003 — elegir hora navega sin recargar la página', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __softNav: boolean }).__softNav = true;
    });

    await chooseHour(page, 0);

    expect(
      await page.evaluate(() => (window as unknown as { __softNav?: boolean }).__softNav),
    ).toBe(true);
    expect(page.url()).toContain('startsAt=');
  });

  test('FR-009 — los datos personales no quedan en el navegador ni en la URL', async ({
    page,
  }) => {
    const contact = { name: 'Zacarías Prueba', phone: '611 22 33 44', email: 'zp@ejemplo.test' };

    await page.goto('/');
    await chooseLastDay(page);
    await chooseHour(page, 0);
    await fillContact(page, contact);
    await chooseHour(page, 1);

    const stored = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        cookie: document.cookie,
      }),
    );

    for (const value of [contact.name, contact.phone, contact.email]) {
      expect(stored).not.toContain(value);
      expect(decodeURIComponent(page.url())).not.toContain(value);
    }
  });

  test('FR-016 — los cambios se anuncian sin mover el foco', async ({ page }) => {
    await page.goto('/');

    const day = page.locator(`${DAYS} button.is-available`).last();
    const date = (await day.getAttribute('value')) ?? '';
    const dayName = /^\S+ (\d+ de \S+),/.exec((await day.getAttribute('aria-label')) ?? '')?.[1];
    await day.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`selectedDate=${date}`));

    expect(
      await page.evaluate(() => (document.activeElement as HTMLButtonElement | null)?.value),
    ).toBe(date);
    await expect(page.locator(`${SLOTS} [aria-live="polite"]`)).toContainText(dayName ?? '-');

    const hour = page.locator(`${SLOTS} button[name="startsAt"]`).first();
    await hour.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === '/reservar');
    await expect(page).toHaveTitle('Tus datos · Reserva tu cita');

    const summaryTime = page.locator(`${SUMMARY} dd`).nth(2);
    const before = await summaryTime.textContent();
    const other = page.locator(`${SLOTS} button[name="startsAt"]`).nth(1);
    const otherStartsAt = (await other.getAttribute('value')) ?? '';
    await other.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.searchParams.get('startsAt') === otherStartsAt);

    expect(
      await page.evaluate(() => (document.activeElement as HTMLButtonElement | null)?.value),
    ).toBe(otherStartsAt);
    await expect(page.locator(SUMMARY)).toHaveAttribute('aria-live', 'polite');
    await expect(summaryTime).not.toHaveText(before ?? '');
    await expect(page.locator(`${SLOTS} [aria-live]`)).toHaveCount(0);
  });

  test('Principio VI — una hora ocupada al confirmar desaparece de la pantalla', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseLastDay(page);
    const startsAt = await chooseHour(page, 0);

    const context = await page.context().browser()?.newContext();
    const other = await context?.newPage();
    if (other === undefined || context === undefined) throw new Error('no second browser context');
    await other.setExtraHTTPHeaders({ 'x-forwarded-for': '198.51.100.78' });
    await other.goto(`/reservar?serviceId=${SERVICE_ID}&startsAt=${startsAt}`);
    await fillContact(other, { name: 'Otro', phone: '700112233', email: 'otro@example.com' });
    await other.getByRole('button', { name: 'Confirmar la cita' }).click();
    await other.waitForURL(/\/cita\//);
    await context.close();

    await fillContact(page, ANA);
    await page.getByRole('button', { name: 'Confirmar la cita' }).click();

    await expect(page.getByText('Esa hora acaba de ocuparla otra persona.')).toBeVisible();
    await expectContact(page, ANA);
    await expect(page.locator(`button[value="${startsAt}"]`)).toHaveCount(0);
  });

  test('Principio V — parámetros inválidos caen al rango por defecto', async ({ page }) => {
    const at = slotDaysFromNow(5);
    const response = await page.goto(
      `/reservar?serviceId=${SERVICE_ID}&startsAt=${at.toISOString()}` +
        '&rangeStart=xx&selectedDate=2999-01-01',
    );

    expect(response?.status()).toBe(200);
    await expect(page.locator(SUMMARY)).toBeVisible();
    await expect(page.locator(FORM)).toBeVisible();
    await expect(page.locator(`${DAYS} button[value="${salonDateOf(at)}"]`)).toHaveAttribute(
      'aria-current',
      'date',
    );
  });
});

test.describe('US1 — el móvil no cambia', () => {
  test.use({ viewport: PHONE });

  test('FR-002 — /reservar sigue siendo sólo resumen y formulario', async ({ page }) => {
    await page.goto(freeSlotUrl());

    await expect(page.locator(DAYS)).toBeHidden();
    await expect(page.locator(SLOTS)).toBeHidden();
    await expect(page.locator(SUMMARY)).toBeVisible();
    await expect(page.locator(FORM)).toBeVisible();
  });
});
