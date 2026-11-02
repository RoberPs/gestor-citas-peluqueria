import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * WCAG 2.2 level AA on every client-facing screen (SC-010, Principio VII).
 *
 * Any violation fails the build. Reserving a haircut is an everyday errand;
 * excluding somebody who uses a screen reader is not an edge case.
 */
export async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.help}`),
  ).toEqual([]);
}

/** SC-011: the page itself never scrolls sideways at 360 px. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
}
