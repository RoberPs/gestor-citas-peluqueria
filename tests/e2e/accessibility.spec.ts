import { expect, test, type Page } from '@playwright/test';
import {
  closeAppointmentsPool,
  resetAppointments,
  seedAppointment,
  slotDaysFromNow,
} from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { bookAppointment, DAY_GRID, SLOT_LIST, clickAndNavigate } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';

/**
 * The accessibility pass over every client-facing screen (SC-010, SC-011,
 * Principio VII).
 *
 * The per-story suites already run axe on the screen they exercise. This one
 * exists so that no screen is covered only incidentally, and it adds the two
 * things axe cannot judge on its own: that the whole screen can be reached by
 * keyboard with the focus visible, and that what you tap is big enough to hit.
 */

/** WCAG 2.2 AA target size, and the project's own floor. */
const MIN_TARGET_PX = 44;

/**
 * The controls a finger goes for. Links inside a sentence — the salon phone in
 * its own line of the address card — are exempt from the target size rule and
 * would fail a blanket check for the wrong reason.
 */
const TAPPABLE = 'button, a.button, a.button-secondary, .day-cell, .slot, .service-option';

async function expectTargetsBigEnough(page: Page): Promise<void> {
  const tooSmall = await page.locator(TAPPABLE).evaluateAll(
    (elements, minimum) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            label: `${element.tagName.toLowerCase()}.${element.className} ${Math.round(
              box.width,
            )}x${Math.round(box.height)}`,
            width: box.width,
            height: box.height,
          };
        })
        // A hidden control has no box and is not a target.
        .filter((box) => box.width > 0 && box.height > 0)
        .filter((box) => box.width < minimum || box.height < minimum)
        .map((box) => box.label),
    MIN_TARGET_PX,
  );

  expect(tooSmall).toEqual([]);
}

/**
 * Walks the screen with the Tab key and checks the focus never goes invisible.
 *
 * `:focus-visible` is what draws the ring, and it only applies to keyboard
 * focus — calling `.focus()` would not prove anything.
 */
async function expectKeyboardReachable(page: Page, expectedStops: number): Promise<void> {
  await page.evaluate(() => document.body.focus());

  const seen: string[] = [];

  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');

    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;

      const style = getComputedStyle(element);
      return {
        name: `${element.tagName.toLowerCase()}.${element.className}`,
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth),
      };
    });

    if (focused === null) break;
    if (seen.includes(focused.name) && seen.length >= expectedStops) break;

    // The ring is there, and it is not a hairline.
    expect(focused.outlineStyle, `focus ring on ${focused.name}`).not.toBe('none');
    expect(focused.outlineWidth, `focus ring on ${focused.name}`).toBeGreaterThanOrEqual(2);

    seen.push(focused.name);
  }

  expect(seen.length).toBeGreaterThanOrEqual(expectedStops);
}

async function checkScreen(page: Page, stops: number): Promise<void> {
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  await expectTargetsBigEnough(page);
  await expectKeyboardReachable(page, stops);
}

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test('ruta 1 — la pantalla de reservas', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator(DAY_GRID)).toBeVisible();
  await checkScreen(page, 10);
});

test('ruta 2 — la pantalla de datos', async ({ page }) => {
  await page.goto('/');
  await clickAndNavigate(page.getByRole('button', { name: /^Corte/ }));
  await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
  await page.locator(`${SLOT_LIST} button`).first().click();

  await expect(page.getByLabel('Nombre')).toBeVisible();
  await checkScreen(page, 4);
});

test('ruta 3a — la cita recién creada, con ?nueva=1', async ({ page }) => {
  await bookAppointment(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Cita confirmada!');
  await checkScreen(page, 4);
});

test('ruta 3b — la cita cancelada', async ({ page }) => {
  const { token } = await seedAppointment({
    startsAt: slotDaysFromNow(6),
    status: 'CANCELLED',
  });

  await page.goto(`/cita/${token}`);

  await expect(page.locator('.status-cancelled')).toHaveText('× Cancelada');
  await checkScreen(page, 3);
});

test('ruta 3c — la cita completada', async ({ page }) => {
  const { token } = await seedAppointment({
    startsAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
  });

  await page.goto(`/cita/${token}`);

  await expect(page.locator('.status-completed')).toHaveText('✓ Completada');
  await checkScreen(page, 3);
});

test('ruta 4 — la pantalla de reprogramación', async ({ page }) => {
  const { token } = await seedAppointment({ startsAt: slotDaysFromNow(6) });

  await page.goto(`/cita/${token}/reprogramar`);

  await expect(page.locator(SLOT_LIST)).toBeVisible();
  await checkScreen(page, 10);
});

test('ruta 5 — la pantalla de enlace no válido', async ({ page }) => {
  await page.goto(`/cita/${'a'.repeat(43)}`);

  await expect(page.getByText('No hemos encontrado ninguna cita con este enlace.')).toBeVisible();
  await checkScreen(page, 1);
});

test('el estado de un día nunca depende sólo del color (SC-010)', async ({ page }) => {
  await page.goto('/');

  // Every day carries its state in its accessible name as well as its colour.
  const names = await page
    .locator(`${DAY_GRID} button`)
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('aria-label') ?? ''));

  expect(names).toHaveLength(14);
  for (const name of names) {
    expect(name).toMatch(/hueco|huecos|cerrado|sin huecos/);
  }

  // And in a shape, which survives a screenshot in greyscale.
  const icons = await page
    .locator(`${DAY_GRID} .day-icon`)
    .evaluateAll((spans) => spans.map((span) => span.textContent ?? ''));

  expect(new Set(icons).size).toBeGreaterThan(1);
  for (const icon of icons) expect(['•', '×', '—']).toContain(icon);
});
