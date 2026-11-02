import { expect, test } from '@playwright/test';
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

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test.describe('sin desplazamiento horizontal', () => {
  const WIDTHS = [320, 360, 640, 768, 1024, 1280, 1920];

  async function screens(): Promise<string[]> {
    const { token } = await seedAppointment({ startsAt: slotDaysFromNow(6) });
    const freeSlot = slotDaysFromNow(5).toISOString();

    return [
      '/',
      `/reservar?serviceId=${SERVICE_ID}&startsAt=${freeSlot}`,
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
