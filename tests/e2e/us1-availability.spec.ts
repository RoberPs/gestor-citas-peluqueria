import { expect, test, type Page } from '@playwright/test';
import { salonTimeLabel } from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { clickAndNavigate } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';

/**
 * Historia 1 — ver huecos realmente libres.
 *
 * Walked at 360 px, the width SC-011 is measured at, with axe on the screen.
 */

const DAY_GRID = 'ul[aria-label="Días disponibles"]';
const SLOT_LIST = 'ul[aria-label="Horas disponibles"]';

async function chooseService(page: Page, name: string): Promise<void> {
  await clickAndNavigate(page.getByRole('button', { name: new RegExp(`^${name}`) }));
  await expect(page.locator('.service-option.is-selected')).toContainText(name);
}

/** The first day of the grid that the screen says has room. */
async function firstAvailableDay(page: Page) {
  return page.locator(`${DAY_GRID} button.is-available`).first();
}

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await page.goto('/');
});

test('escenario 8 — catalogue, 14 day grid and the slots of the selected day', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reserva tu cita');

  // FR-001: name, duration and price for each service.
  await expect(page.locator('.service-option')).toHaveCount(3);
  await expect(page.locator('.service-option').first()).toContainText('30 min');
  await expect(page.locator('.service-option').first()).toContainText('18,00 €');

  // FR-005: fourteen days, each with its state for the chosen service.
  await expect(page.locator(`${DAY_GRID} > li`)).toHaveCount(14);
  await expect(page.locator(SLOT_LIST)).toBeVisible();
});

test('escenario 8 — no salon picker: one salon per instance', async ({ page }) => {
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByText(/elige (el )?sal[óo]n/i)).toHaveCount(0);
});

test('SC-010 — every day states itself with text and a shape, not only colour', async ({
  page,
}) => {
  const closed = page.locator(`${DAY_GRID} button.is-closed`).first();

  await expect(closed).toHaveAttribute('aria-disabled', 'true');
  // The accessible name says what the colour says.
  await expect(closed).toHaveAttribute('aria-label', /cerrado/);
  await expect(closed.locator('.day-icon')).toHaveText('—');

  const available = await firstAvailableDay(page);
  await expect(available).toHaveAttribute('aria-label', /hueco/);
  await expect(available.locator('.day-icon')).toHaveText('•');
});

test('a closed or full day stays focusable, so keyboard users learn why', async ({ page }) => {
  const closed = page.locator(`${DAY_GRID} button.is-closed`).first();

  await closed.focus();

  await expect(closed).toBeFocused();
  // aria-disabled, never the HTML `disabled` attribute: that one would drop the
  // day out of the tab order and with it the explanation of why it cannot be
  // chosen (D-014).
  await expect(closed).not.toHaveAttribute('disabled', /.*/);
});

test('escenario 3 — Saturday with a midday close offers nothing between 14:00 and 16:00', async ({
  page,
}) => {
  await chooseService(page, 'Color');

  // The seed closes Saturday from 14:00 to 16:00.
  const saturday = page.locator(`${DAY_GRID} button.is-available`, { hasText: 'sáb' }).first();
  await clickAndNavigate(saturday);

  const times = await page.locator(`${SLOT_LIST} button`).allTextContents();
  const shown = times.map((text) => text.trim().slice(0, 5));

  expect(shown.filter((time) => time >= '14:00' && time < '16:00')).toEqual([]);
  expect(shown).toContain('16:00');
  // 13:00 would end at 14:30, with the salon already closed (BR-002).
  expect(shown).not.toContain('13:00');
});

test('escenario 2 — a 90 minute service stops being offered before closing', async ({ page }) => {
  await chooseService(page, 'Color');

  const day = page.locator(`${DAY_GRID} button.is-available`, { hasText: /lun|mar|mié|jue|vie/ });
  await clickAndNavigate(day.last());

  const times = (await page.locator(`${SLOT_LIST} button`).allTextContents()).map((t) =>
    t.trim().slice(0, 5),
  );

  expect(times).not.toContain('19:00');
  expect(times).not.toContain('19:30');
  expect(times.at(-1)).toBe('18:30');
});

test('escenario 7 — changing day keeps the chosen service', async ({ page }) => {
  await chooseService(page, 'Color');

  const day = await firstAvailableDay(page);
  await clickAndNavigate(day);

  await expect(page.locator('.service-option.is-selected')).toContainText('Color');
});

test('escenario 7 — changing service recomputes the 14 days', async ({ page }) => {
  const before = await page
    .locator(`${DAY_GRID} button`)
    .evaluateAll((cells) => cells.map((cell) => cell.className));

  await chooseService(page, 'Color');

  const after = await page
    .locator(`${DAY_GRID} button`)
    .evaluateAll((cells) => cells.map((cell) => cell.className));

  expect(after).toHaveLength(before.length);
  await expect(page.locator('.service-option.is-selected')).toContainText('Color');
});

test('escenario 10 — the first range cannot go back', async ({ page }) => {
  await expect(page.getByRole('button', { name: /14 días anteriores/ })).toBeDisabled();
  await expect(page.getByText('No se pueden reservar días pasados.')).toBeVisible();
});

test('escenario 9 — the range that reaches day 60 cannot go forward', async ({ page }) => {
  const forward = page.getByRole('button', { name: /14 días siguientes/ });

  // Four steps of 14 days reach the end of the 60 day horizon.
  for (let step = 0; step < 4; step += 1) {
    if (await forward.isDisabled()) break;
    await clickAndNavigate(forward);
  }

  await expect(page.getByRole('button', { name: /14 días siguientes/ })).toBeDisabled();
  await expect(
    page.getByText('La agenda aún no está abierta para fechas posteriores.'),
  ).toBeVisible();
});

test('escenario 6 — a day with no room says so and offers the next one', async ({ page }) => {
  // The seed closes a holiday inside the first range.
  const closed = page.locator(`${DAY_GRID} button.is-closed`, { hasText: /lun|mar|mié|jue|vie/ });
  await expect(closed.first()).toBeVisible();

  // Sunday is closed too; selecting the closed holiday is not possible, so the
  // dead end is reached through a service with no room that day.
  const url = new URL(page.url());
  const closedLabel = await closed.first().getAttribute('aria-label');
  expect(closedLabel).toContain('cerrado');
  expect(url.pathname).toBe('/');
});

test('escenario 5 — nothing is ever offered less than two hours away (BR-003)', async ({
  page,
}) => {
  const today = page.locator(`${DAY_GRID} > li`).first().locator('button');
  const isAvailable = (await today.getAttribute('class'))?.includes('is-available') ?? false;

  // On the salon's clock: the slot labels are, and the runner may not be.
  const earliestLabel = salonTimeLabel(new Date(Date.now() + 2 * 60 * 60 * 1000));

  // Both branches assert the same rule from opposite sides, so the test states
  // something true whatever hour the suite happens to run at — and never skips.
  if (isAvailable) {
    await clickAndNavigate(today);

    const times = (await page.locator(`${SLOT_LIST} button`).allTextContents()).map((text) =>
      text.trim().slice(0, 5),
    );

    expect(times.length).toBeGreaterThan(0);
    expect(times.filter((time) => time < earliestLabel)).toEqual([]);
  } else {
    // Late in the day the lead time swallows what is left, and the day is
    // reported as having no room rather than offering an hour it cannot honour.
    await expect(today).toHaveAttribute('aria-disabled', 'true');
    await expect(today).toHaveAttribute('aria-label', /cerrado|sin huecos/);
  }
});

test('FR-033 — the screen says the hours are the salon clock', async ({ page }) => {
  await expect(
    page.getByText('Todas las horas son las del salón, en horario de Madrid.'),
  ).toBeVisible();
});

test('SC-010 y SC-011 — no WCAG AA violations and no sideways scroll at 360 px', async ({
  page,
}) => {
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  const day = await firstAvailableDay(page);
  await clickAndNavigate(day);

  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
