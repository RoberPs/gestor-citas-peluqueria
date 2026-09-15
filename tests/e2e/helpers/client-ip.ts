import type { Page, TestInfo } from '@playwright/test';

/**
 * Gives each test its own client IP.
 *
 * The per-IP limits are real product behaviour (FR-038, FR-039) and the suite
 * would otherwise share one bucket: the sixth test that books would be refused
 * by the application working exactly as intended, and the failure would look
 * like a bug. A distinct IP per test keeps them independent **and** exercises
 * the keying rather than stepping around it.
 *
 * The addresses come from 203.0.113.0/24, reserved for documentation.
 */
export async function useOwnClientIp(page: Page, testInfo: TestInfo): Promise<void> {
  const slot = (testInfo.workerIndex * 97 + testInfo.line * 7 + testInfo.column) % 250;

  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `203.0.113.${slot + 1}` });
}
