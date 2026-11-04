import { expect, test, type Page } from '@playwright/test';
import { closeAppointmentsPool, resetAppointments } from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { DAY_GRID, SLOT_LIST, chooseOnlyService, clickAndNavigate } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';

/**
 * Historia 2 — confirmar la cita.
 *
 * The six acceptance scenarios at 360 px, with axe on the form.
 */

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

/** Walks as far as the form and stops there. */
async function reachForm(page: Page): Promise<string> {
  await page.goto('/');
  await chooseOnlyService(page, 'Corte');
  await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());

  const slot = page.locator(`${SLOT_LIST} button`).first();
  const localTime = ((await slot.textContent()) ?? '').trim().slice(0, 5);
  await slot.click();

  await expect(page).toHaveURL(/\/reservar/);
  return localTime;
}

test('escenario 1 — exactly three fields are asked for, and no fourth', async ({ page }) => {
  await reachForm(page);

  await expect(page.getByLabel('Nombre')).toBeVisible();
  await expect(page.getByLabel('Teléfono')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();

  // FR-008: three inputs the client fills in, and nothing else. The checkbox
  // of the confirmation by email (004, FR-001) asks for no data of its own.
  const visible = page.locator('form input:not([type="hidden"]):not([type="checkbox"])');
  await expect(visible).toHaveCount(3);
});

test('escenario 2 — the summary before confirming carries everything FR-010 asks for', async ({
  page,
}) => {
  const localTime = await reachForm(page);

  const summary = page.locator('section[aria-labelledby="summary-heading"]');

  await expect(summary).toContainText('Corte');
  await expect(summary).toContainText(localTime);
  await expect(summary).toContainText('30 min');
  await expect(summary).toContainText('18,00 €');
  // The cancellation deadline, before committing rather than after.
  await expect(summary).toContainText('hasta 24 horas antes');
});

test('escenario 3 — confirming books the slot and takes it off the board', async ({ page }) => {
  const started = Date.now();
  const localTime = await reachForm(page);

  await page.getByLabel('Nombre').fill('Ana López');
  await page.getByLabel('Teléfono').fill('600 11 22 33');
  await page.getByLabel('Email', { exact: true }).fill('ana@example.com');
  await page.getByRole('button', { name: 'Confirmar la cita' }).click();

  await page.waitForURL(/\/cita\/[A-Za-z0-9_-]{43}\?nueva=1/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Cita confirmada!');

  // SC-001 asks for a booking in under 90 seconds. Recorded, never asserted:
  // the target is about a person deciding, and a timing assertion here would
  // measure the CI machine instead.
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  test.info().annotations.push({
    type: 'SC-001',
    description: `service to confirmation walked in ${seconds}s (reference only)`,
  });

  // The hour is gone from the board for everybody.
  await page.goto('/');
  await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
  const offered = (await page.locator(`${SLOT_LIST} button`).allTextContents()).map((text) =>
    text.trim().slice(0, 5),
  );
  expect(offered).not.toContain(localTime);
});

test('escenario 4 — an invalid phone is named, and nothing else typed is lost', async ({
  page,
}) => {
  await reachForm(page);

  await page.getByLabel('Nombre').fill('Ana López');
  await page.getByLabel('Teléfono').fill('12345');
  await page.getByLabel('Email', { exact: true }).fill('ana@example.com');
  await page.getByRole('button', { name: 'Confirmar la cita' }).click();

  // Still on the form, with the field named and told how to fix it.
  await expect(page).toHaveURL(/\/reservar/);
  await expect(
    page.getByText('Escribe un teléfono español de 9 cifras, por ejemplo 600 11 22 33.'),
  ).toBeVisible();

  // The two fields that were right keep what was typed in them.
  await expect(page.getByLabel('Nombre')).toHaveValue('Ana López');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('ana@example.com');
  await expect(page.getByLabel('Teléfono')).toHaveValue('12345');
});

test('escenario 4 — the error is tied to its field for a screen reader', async ({ page }) => {
  await reachForm(page);

  await page.getByLabel('Nombre').fill('Ana López');
  await page.getByLabel('Teléfono').fill('12345');
  await page.getByLabel('Email', { exact: true }).fill('ana@example.com');
  await page.getByRole('button', { name: 'Confirmar la cita' }).click();

  const phone = page.getByLabel('Teléfono');
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  await expect(phone).toHaveAttribute('aria-describedby', /phone-error/);
});

test('escenario 5 — a slot taken meanwhile is explained, with what is left offered', async ({
  page,
}) => {
  const localTime = await reachForm(page);
  const formUrl = page.url();

  // Somebody else takes that hour while this client is still typing.
  const startsAt = new URL(formUrl).searchParams.get('startsAt') ?? '';
  const context = await page.context().browser()?.newContext();
  const other = await context?.newPage();
  if (other === undefined || context === undefined) throw new Error('no second browser context');
  await other.setExtraHTTPHeaders({ 'x-forwarded-for': '198.51.100.77' });
  await other.goto(`/reservar?serviceIds=00000000-0000-4000-8000-000000000011&startsAt=${startsAt}`);
  await other.getByLabel('Nombre').fill('Otro');
  await other.getByLabel('Teléfono').fill('700112233');
  await other.getByLabel('Email', { exact: true }).fill('otro@example.com');
  await other.getByRole('button', { name: 'Confirmar la cita' }).click();
  await other.waitForURL(/\/cita\//);
  await context.close();

  await page.getByLabel('Nombre').fill('Ana López');
  await page.getByLabel('Teléfono').fill('600112233');
  await page.getByLabel('Email', { exact: true }).fill('ana@example.com');
  await page.getByRole('button', { name: 'Confirmar la cita' }).click();

  await expect(page.getByText('Esa hora acaba de ocuparla otra persona.')).toBeVisible();
  await expect(
    page.getByText('Elige otra de las horas que quedan libres ese día, aquí debajo.'),
  ).toBeVisible();
  expect(localTime).not.toBe('');
});

test('escenario 6 — a fourth future appointment is refused with the limit explained', async ({
  page,
}) => {
  const customer = { name: 'Ana López', phone: '600 11 22 33', email: 'ana@example.com' };

  for (let booking = 0; booking < 3; booking += 1) {
    await page.goto('/');
    await chooseOnlyService(page, 'Corte');
    await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
    await page.locator(`${SLOT_LIST} button`).nth(booking).click();
    await page.getByLabel('Nombre').fill(customer.name);
    await page.getByLabel('Teléfono').fill(customer.phone);
    await page.getByLabel('Email', { exact: true }).fill(customer.email);
    await page.getByRole('button', { name: 'Confirmar la cita' }).click();
    await page.waitForURL(/\/cita\//);
  }

  await page.goto('/');
  await chooseOnlyService(page, 'Corte');
  await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
  await page.locator(`${SLOT_LIST} button`).nth(3).click();
  await page.getByLabel('Nombre').fill(customer.name);
  await page.getByLabel('Teléfono').fill(customer.phone);
  await page.getByLabel('Email', { exact: true }).fill(customer.email);
  await page.getByRole('button', { name: 'Confirmar la cita' }).click();

  await expect(
    page.getByText('Ya tienes 3 citas reservadas por delante, que es el máximo.'),
  ).toBeVisible();
  // The way out is named: cancel one, or call the salon.
  await expect(page.getByText(/Cancela una de las que tienes o llama al salón al/)).toBeVisible();
});

test('SC-010 y SC-011 — no WCAG AA violations and no sideways scroll at 360 px', async ({
  page,
}) => {
  await reachForm(page);

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  // The form carrying its errors is a different rendering, and gets checked too.
  await page.getByLabel('Nombre').fill('Ana');
  await page.getByLabel('Teléfono').fill('12345');
  await page.getByLabel('Email', { exact: true }).fill('nope');
  await page.getByRole('button', { name: 'Confirmar la cita' }).click();
  await expect(page.getByText('Revisa estos datos antes de confirmar:')).toBeVisible();

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
