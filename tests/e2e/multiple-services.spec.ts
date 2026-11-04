import { expect, test, type Page } from '@playwright/test';
import {
  closeAppointmentsPool,
  countStored,
  resetAppointments,
  seedAppointment,
  slotDaysFromNow,
} from './helpers/appointments';
import { expectNoAccessibilityViolations } from './helpers/axe';
import { DAY_GRID, SLOT_LIST, chooseOnlyService, clickAndNavigate } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';

/**
 * 005 — several services in one appointment, and services without a price.
 *
 * Walked at the size of each project (360 px and 1280 px). What only exists on
 * desktop — the service picker beside the form, FR-011 — sets its own size, as
 * does the tablet pass, so every size of 003 sees the selection (FR-022).
 */

const CORTE = '00000000-0000-4000-8000-000000000011';
const PEINADO = '00000000-0000-4000-8000-000000000013';

const SERVICES = 'section[aria-labelledby="service-heading"]';
const SELECTION = `${SERVICES} [aria-live="polite"]`;
const SUMMARY = 'section[aria-labelledby="summary-heading"]';
const APPOINTMENT = 'section[aria-labelledby="appointment-heading"]';

const DESKTOP = { width: 1280, height: 800 };
const TABLET = { width: 768, height: 1024 };

const ANA = { name: 'Ana López', phone: '600 11 22 33', email: 'ana@example.com' };

function service(page: Page, name: string) {
  return page.locator(`${SERVICES} button.service-option`, { hasText: name });
}

/** Marks or unmarks one service, and waits for the screen of the new selection. */
async function toggle(page: Page, name: string): Promise<void> {
  await clickAndNavigate(service(page, name));
}

/** The last weekday of the range with room: past the 24 h deadline, open 10:00 to 20:00. */
async function chooseLastWeekday(page: Page): Promise<void> {
  const weekday = page.locator(`${DAY_GRID} button.is-available`, {
    hasText: /lun|mar|mié|jue|vie/,
  });
  await clickAndNavigate(weekday.last());
}

async function slotTimes(page: Page): Promise<string[]> {
  const texts = await page.locator(`${SLOT_LIST} button`).allTextContents();
  return texts.map((text) => text.trim().slice(0, 5));
}

async function fillContact(page: Page): Promise<void> {
  await page.getByLabel('Nombre').fill(ANA.name);
  await page.getByLabel('Teléfono').fill(ANA.phone);
  await page.getByLabel('Email', { exact: true }).fill(ANA.email);
}

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test.describe('Historia 1 — reservar varios servicios en una sola cita', () => {
  test('escenario 1 — el primer servicio aparece elegido, con texto e icono', async ({ page }) => {
    await page.goto('/');

    const corte = service(page, 'Corte');
    await expect(corte).toHaveAttribute('aria-pressed', 'true');
    // Chosen is said in words and a mark, never by colour alone (FR-023).
    await expect(corte).toContainText('✓ Elegido');
    for (const other of ['Color', 'Peinado', 'Lavado']) {
      await expect(service(page, other)).toHaveAttribute('aria-pressed', 'false');
      await expect(service(page, other)).not.toContainText('Elegido');
    }

    // Name, duration and price of each, and no amount for the one without price.
    await expect(service(page, 'Peinado')).toContainText('45 min · 25,00 €');
    await expect(service(page, 'Lavado')).toContainText('Precio a consultar en el salón');
    await expect(page.locator(SELECTION)).toContainText('Duración total: 30 min');
  });

  test('escenario 2 — dos servicios y su duración total, también en la URL', async ({ page }) => {
    await page.goto('/');
    await toggle(page, 'Peinado');

    await expect(service(page, 'Corte')).toHaveAttribute('aria-pressed', 'true');
    await expect(service(page, 'Peinado')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(SELECTION)).toContainText('Corte, Peinado');
    await expect(page.locator(SELECTION)).toContainText('Duración total: 1 h 15 min');
    expect(new URL(page.url()).searchParams.get('serviceIds')).toBe(`${CORTE},${PEINADO}`);
  });

  test('escenario 3 — sólo se ofrecen inicios donde cabe la cita entera', async ({ page }) => {
    await page.goto('/');
    await toggle(page, 'Peinado');
    await chooseLastWeekday(page);

    const times = await slotTimes(page);
    // 18:30 + 75 min = 19:45, before the 20:00 close; 19:00 would not fit.
    expect(times.at(-1)).toBe('18:30');
    expect(times).not.toContain('19:00');
  });

  test('escenario 5 — cambiar la selección recalcula los 14 días', async ({ page }) => {
    await page.goto('/');
    const dayNames = () =>
      page
        .locator(`${DAY_GRID} button`)
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('aria-label') ?? ''));

    const before = await dayNames();
    await toggle(page, 'Color');
    const after = await dayNames();

    expect(after).toHaveLength(before.length);
    // Two hours instead of thirty minutes: fewer starts on every open day.
    expect(after).not.toEqual(before);
  });

  test('FR-006 — el resumen sigue el orden del catálogo, no el de las pulsaciones', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page, 'Peinado');
    await toggle(page, 'Corte');
    await toggle(page, 'Corte');

    await expect(page.locator(SELECTION)).toContainText('Corte, Peinado');
  });

  test('FR-004 — sin ningún servicio no hay días ni horas, y se pide elegir uno', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page, 'Corte');

    expect(new URL(page.url()).searchParams.get('serviceIds')).toBe('');
    await expect(
      page.getByText('Elige al menos un servicio para ver los días y las horas libres.'),
    ).toBeVisible();
    await expect(page.locator(DAY_GRID)).toHaveCount(0);
    await expect(page.locator(SLOT_LIST)).toHaveCount(0);
  });

  test('003 FR-010a — Atrás deshace el último cambio y recargar conserva la selección', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page, 'Peinado');

    await page.goBack();
    await expect(service(page, 'Peinado')).toHaveAttribute('aria-pressed', 'false');
    await expect(service(page, 'Corte')).toHaveAttribute('aria-pressed', 'true');

    await page.goForward();
    await expect(service(page, 'Peinado')).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(service(page, 'Corte')).toHaveAttribute('aria-pressed', 'true');
    await expect(service(page, 'Peinado')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(SELECTION)).toContainText('Duración total: 1 h 15 min');
  });

  test('escenarios 6 y 7 — cada servicio en el resumen, el precio total y una sola cita', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page, 'Lavado');
    await chooseLastWeekday(page);
    await page.locator(`${SLOT_LIST} button`).first().click();

    const summary = page.locator(SUMMARY);
    await expect(summary).toContainText('Corte · 30 min · 18,00 €');
    await expect(summary).toContainText('Lavado · 30 min · Precio a consultar en el salón');
    await expect(summary).toContainText('1 h');
    await expect(summary).toContainText('18,00 € + precio a consultar en el salón');
    await expect(summary).toContainText('hasta 24 horas antes');

    await fillContact(page);
    await page.getByRole('button', { name: 'Confirmar la cita' }).click();
    await page.waitForURL(/\/cita\/[A-Za-z0-9_-]{43}\?nueva=1/);

    const card = page.locator(APPOINTMENT);
    await expect(card).toContainText('Corte');
    await expect(card).toContainText('Lavado');
    expect(await countStored()).toEqual({ appointments: 1, services: 2 });
  });

  test('escenario 8 — si otro ocupa parte del tramo, la reserva se rechaza como en la 001', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page, 'Peinado');
    await chooseLastWeekday(page);
    await page.locator(`${SLOT_LIST} button`).first().click();
    await page.getByLabel('Nombre').waitFor();

    // Somebody takes the second half hour of the 75 minutes while this client types.
    const startsAt = new Date(new URL(page.url()).searchParams.get('startsAt') ?? '');
    await seedAppointment({ startsAt: new Date(startsAt.getTime() + 30 * 60_000) });

    await fillContact(page);
    await page.getByRole('button', { name: 'Confirmar la cita' }).click();

    await expect(page.getByText('Esa hora acaba de ocuparla otra persona.')).toBeVisible();
    await expect(page.getByLabel('Nombre')).toHaveValue(ANA.name);
    expect((await countStored()).appointments).toBe(1);
  });

  test('caso límite — un servicio que ya no se ofrece no entra en la selección', async ({
    page,
  }) => {
    const retired = '00000000-0000-4000-8000-0000000000ff';
    const startsAt = slotDaysFromNow(5, 10, 0).toISOString();

    await page.goto(`/reservar?serviceIds=${CORTE},${retired}&startsAt=${startsAt}`);

    const summary = page.locator(SUMMARY);
    await expect(summary).toContainText('Corte');
    await expect(summary).toContainText('30 min');
    await expect(summary).not.toContainText('1 h');
  });

  test('SC-007 — el recorrido entero con varios servicios se hace sólo con el teclado', async ({
    page,
  }) => {
    await page.goto('/');

    await tabTo(page, `${SERVICES} button.service-option`, 'Peinado');
    await page.keyboard.press('Enter');
    await page.waitForURL(/serviceIds=[^&]*%2C|serviceIds=[^&]*,/);
    await expect(service(page, 'Peinado')).toHaveAttribute('aria-pressed', 'true');

    await tabTo(page, `${DAY_GRID} button.is-available`);
    await page.keyboard.press('Space');
    await page.waitForURL(/selectedDate=/);

    await tabTo(page, `${SLOT_LIST} button`);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/reservar\?/);

    await tabTo(page, 'input#name');
    await page.keyboard.type(ANA.name);
    await tabTo(page, 'input#phone');
    await page.keyboard.type(ANA.phone);
    await tabTo(page, 'input#email');
    await page.keyboard.type(ANA.email);
    await tabTo(page, 'button[type="submit"]', 'Confirmar la cita');
    await page.keyboard.press('Enter');

    await page.waitForURL(/\/cita\/[A-Za-z0-9_-]{43}\?nueva=1/);
    await expect(page.locator(APPOINTMENT)).toContainText('Peinado');
  });
});

test.describe('en ordenador — cambiar los servicios con una hora elegida (FR-011, D-005)', () => {
  test.use({ viewport: DESKTOP });

  test('si la cita sigue cabiendo, se queda la hora y se actualiza el resumen', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseLastWeekday(page);
    const first = page.locator(`${SLOT_LIST} button`).first();
    const startsAt = (await first.getAttribute('value')) ?? '';
    await first.click();
    await page.waitForURL(/\/reservar\?/);
    await page.getByLabel('Nombre').fill(ANA.name);

    await toggle(page, 'Peinado');
    // The screen checks the hour and settles on its own URL (D-005).
    await page.waitForURL(
      (url) => url.pathname === '/reservar' && !url.searchParams.has('cambioServicios'),
    );

    expect(new URL(page.url()).pathname).toBe('/reservar');
    expect(new URL(page.url()).searchParams.get('startsAt')).toBe(startsAt);
    await expect(page.locator(SUMMARY)).toContainText('Peinado');
    await expect(page.getByLabel('Nombre')).toHaveValue(ANA.name);
  });

  test('si ya no cabe, se quita la hora con un aviso y se conservan el día y lo escrito', async ({
    page,
  }) => {
    await page.goto('/');
    await chooseLastWeekday(page);
    const day = new URL(page.url()).searchParams.get('selectedDate');
    // The last start of the day: no longer service fits after it.
    await page.locator(`${SLOT_LIST} button`).last().click();
    await page.waitForURL(/\/reservar\?/);
    await page.getByLabel('Nombre').fill(ANA.name);

    await toggle(page, 'Color');
    await page.waitForURL((url) => url.pathname === '/');

    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).searchParams.get('selectedDate')).toBe(day);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'La hora que habías elegido ya no cabe con los servicios nuevos.' }),
    ).toBeVisible();
    await expect(page.locator(`${DAY_GRID} button[aria-current="date"]`)).toHaveAttribute(
      'value',
      day ?? '',
    );

    await page.locator(`${SLOT_LIST} button`).first().click();
    await expect(page.getByLabel('Nombre')).toHaveValue(ANA.name);
  });
});

test.describe('en tableta — la misma selección (FR-022)', () => {
  test.use({ viewport: TABLET });

  test('dos servicios, su duración total y sin infracciones de accesibilidad', async ({ page }) => {
    await page.goto('/');
    await toggle(page, 'Peinado');

    await expect(page.locator(SELECTION)).toContainText('Duración total: 1 h 15 min');
    await expect(page.locator(DAY_GRID)).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});

/**
 * Presses Tab until the focus lands on what is asked for, the way somebody
 * without a mouse moves through the screen. Fails rather than loops forever.
 */
async function tabTo(page: Page, selector: string, text?: string): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press('Tab');
    const arrived = await page.evaluate(
      ({ selector, text }) => {
        const element = document.activeElement;
        if (element === null || !element.matches(selector)) return false;
        return text === undefined || (element.textContent ?? '').trim().startsWith(text);
      },
      { selector, text },
    );
    if (arrived) return;
  }

  throw new Error(`Tab never reached ${selector}${text === undefined ? '' : ` (${text})`}`);
}

test.describe('Historia 2 — consultar y reprogramar una cita con varios servicios', () => {
  const LAVADO = {
    id: '00000000-0000-4000-8000-000000000014',
    name: 'Lavado',
    minutes: 30,
    cents: null,
  };
  const CORTE_ROW = { id: CORTE, name: 'Corte', minutes: 30, cents: 1800 };

  test('escenario 1 — el enlace muestra los dos servicios, la duración y el precio total', async ({
    page,
  }) => {
    const { token } = await seedAppointment({
      startsAt: slotDaysFromNow(6),
      services: [CORTE_ROW, LAVADO],
    });

    await page.goto(`/cita/${token}`);

    const card = page.locator(APPOINTMENT);
    await expect(card).toContainText('Servicios');
    await expect(card).toContainText('Corte · 30 min · 18,00 €');
    await expect(card).toContainText('Lavado · 30 min · Precio a consultar en el salón');
    await expect(card).toContainText('1 h');
    await expect(card).toContainText('18,00 € + precio a consultar en el salón');
    await expect(card).toContainText('Confirmada');
    await expectNoAccessibilityViolations(page);
  });

  test('escenarios 2 a 4 — sólo cambia la hora, con inicios donde cabe la hora entera', async ({
    page,
  }) => {
    const { token } = await seedAppointment({
      startsAt: slotDaysFromNow(6, 11, 0),
      services: [CORTE_ROW, LAVADO],
    });

    await page.goto(`/cita/${token}/reprogramar`);

    await expect(
      page.getByText(
        'Estás cambiando la hora de tu cita (Corte y Lavado). Los servicios no cambian; si quieres otros, cancela esta cita y reserva una nueva.',
      ),
    ).toBeVisible();
    await expect(page.locator('.service-option')).toHaveCount(0);

    const times = await slotTimes(page);
    // The appointment's own day: a weekday or a Saturday, never a Sunday.
    expect(times).not.toContain('19:30');
    expect(times).toContain('11:00');
    await expect(page.locator(`${SLOT_LIST} button.is-current-appointment`)).toContainText(
      'tu hora actual',
    );

    const other = page.locator(`${SLOT_LIST} button:not(.is-current-appointment)`).first();
    const newTime = ((await other.textContent()) ?? '').trim().slice(0, 5);
    await other.click();
    await page.getByRole('button', { name: 'Sí, cambiar a esta hora' }).click();
    await page.waitForURL(new RegExp(`/cita/${token}`));

    const card = page.locator(APPOINTMENT);
    await expect(card).toContainText(newTime);
    await expect(card).toContainText('Corte · 30 min · 18,00 €');
    await expect(card).toContainText('Lavado · 30 min · Precio a consultar en el salón');
    expect((await countStored()).services).toBe(2);
  });

  test('escenario 5 — una cita de antes de la feature se ve igual que antes (FR-021)', async ({
    page,
  }) => {
    // One service row, which is exactly what migration 0003 leaves behind.
    const { token } = await seedAppointment({ startsAt: slotDaysFromNow(6) });

    await page.goto(`/cita/${token}`);

    const card = page.locator(APPOINTMENT);
    await expect(card.locator('dt', { hasText: /^Servicio$/ })).toBeVisible();
    await expect(card.locator('dt', { hasText: /^Servicios$/ })).toHaveCount(0);
    await expect(card).toContainText('Corte');
    await expect(card).toContainText('30 min');
    await expect(card).toContainText('18,00 €');
    await expect(page.getByText(/Estás cambiando/)).toHaveCount(0);
  });
});

test.describe('Historia 3 — «Precio a consultar» cuando un servicio no tiene precio', () => {
  const LAVADO_ROW = {
    id: '00000000-0000-4000-8000-000000000014',
    name: 'Lavado',
    minutes: 30,
    cents: null,
  };

  test('escenarios 1 y 2 — Lavado solo: catálogo, resumen, confirmación y enlace', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(service(page, 'Lavado')).toContainText('Precio a consultar en el salón');
    await expect(service(page, 'Lavado')).not.toContainText('€');

    await chooseOnlyService(page, 'Lavado');
    await chooseLastWeekday(page);
    await page.locator(`${SLOT_LIST} button`).first().click();

    const summary = page.locator(SUMMARY);
    await expect(summary.locator('dd').nth(4)).toHaveText('Precio a consultar en el salón');

    await fillContact(page);
    await page.getByRole('button', { name: 'Confirmar la cita' }).click();
    await page.waitForURL(/\/cita\/[A-Za-z0-9_-]{43}\?nueva=1/);
    await expect(page.locator(APPOINTMENT)).toContainText('Precio a consultar en el salón');

    await page.goto(page.url().replace('?nueva=1', ''));
    await expect(page.locator(APPOINTMENT)).toContainText('Precio a consultar en el salón');
  });

  test('escenarios 3 y 4 — todos con precio suman; la mezcla suma lo conocido', async ({
    page,
  }) => {
    const allPriced = await seedAppointment({
      startsAt: slotDaysFromNow(6, 10, 0),
      services: [
        { id: CORTE, name: 'Corte', minutes: 30, cents: 1800 },
        { id: PEINADO, name: 'Peinado', minutes: 45, cents: 2500 },
      ],
    });
    const mixed = await seedAppointment({
      startsAt: slotDaysFromNow(6, 16, 0),
      services: [{ id: CORTE, name: 'Corte', minutes: 30, cents: 1800 }, LAVADO_ROW],
    });

    await page.goto(`/cita/${allPriced.token}`);
    await expect(page.locator(APPOINTMENT)).toContainText('43,00 €');

    await page.goto(`/cita/${mixed.token}`);
    await expect(page.locator(APPOINTMENT)).toContainText(
      'Lavado · 30 min · Precio a consultar en el salón',
    );
    await expect(page.locator(APPOINTMENT)).toContainText(
      '18,00 € + precio a consultar en el salón',
    );
  });

  test('escenario 5 — un precio puesto después de reservar no llega a la cita', async ({
    page,
  }) => {
    // Booked when Corte had no price; the catalogue has given it one since.
    const { token } = await seedAppointment({
      startsAt: slotDaysFromNow(6),
      services: [{ id: CORTE, name: 'Corte', minutes: 30, cents: null }],
    });

    await page.goto(`/cita/${token}`);

    await expect(page.locator(APPOINTMENT)).toContainText('Precio a consultar en el salón');
    await expect(page.locator(APPOINTMENT)).not.toContainText('18,00 €');
  });

  test('SC-005 — ninguna pantalla muestra «0,00 €»', async ({ page }) => {
    const { token } = await seedAppointment({
      startsAt: slotDaysFromNow(6),
      services: [LAVADO_ROW],
    });
    const startsAt = slotDaysFromNow(5, 10, 0).toISOString();

    // Where a price is shown it is said in words; where none is shown, there is no 0 either.
    const screens = [
      { path: `/?serviceIds=${LAVADO_ROW.id}`, showsPrice: true },
      { path: `/reservar?serviceIds=${LAVADO_ROW.id}&startsAt=${startsAt}`, showsPrice: true },
      { path: `/cita/${token}`, showsPrice: true },
      { path: `/cita/${token}/reprogramar`, showsPrice: false },
    ];

    for (const { path, showsPrice } of screens) {
      await page.goto(path);
      if (showsPrice) {
        // On a phone `/reservar` hides the catalogue: what counts is what is in view.
        await expect(
          page.locator('text=Precio a consultar en el salón >> visible=true').first(),
        ).toBeVisible();
      }
      expect(await page.locator('body').innerText(), path).not.toContain('0,00 €');
    }
  });
});
