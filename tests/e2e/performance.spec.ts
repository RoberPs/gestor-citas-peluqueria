import { expect, test, type Page } from '@playwright/test';
import {
  closeAppointmentsPool,
  resetAppointments,
  seedAppointment,
  slotDaysFromNow,
} from './helpers/appointments';
import { DAY_GRID, EMAIL_CONSENT_LABEL, SLOT_LIST, chooseOnlyService, clickAndNavigate } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';
import { setMode } from './helpers/email';

/**
 * SC-004 and the JavaScript budget (T112).
 *
 * The budget is a proxy; the target is the time. A route can sit comfortably
 * under 120 KB and still feel slow, so what is asserted here is how long each
 * step of the flow takes on a mid-range phone over 4G — and the bytes are
 * recorded alongside it rather than instead of it.
 *
 * The numbers this run produces are written up in `docs/performance-budget.md`.
 */

/** 4G: 4 Mbit down, 3 Mbit up, 20 ms round trip. */
const FOUR_G = {
  offline: false,
  downloadThroughput: (4 * 1024 * 1024) / 8,
  uploadThroughput: (3 * 1024 * 1024) / 8,
  latency: 20,
};

/** A mid-range phone is roughly four times slower than this machine. */
const MID_RANGE_CPU = 4;

const BUDGET_BYTES = 120 * 1024;
const PERCEIVED_LIMIT_MS = 2_000;

async function throttle(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', FOUR_G);
  await session.send('Emulation.setCPUThrottlingRate', { rate: MID_RANGE_CPU });
  return session;
}

/**
 * Counts the bytes that actually travel.
 *
 * `content-length` is missing from most of these responses — they are
 * compressed and chunked — so reading that header silently counts almost
 * nothing. `encodedDataLength` is what went over the wire, which is what the
 * budget is stated in.
 */
function countScriptBytes(session: Awaited<ReturnType<typeof throttle>>) {
  const scripts = new Set<string>();
  let bytes = 0;

  session.on('Network.responseReceived', (event) => {
    if (event.type === 'Script') scripts.add(event.requestId);
  });
  session.on('Network.loadingFinished', (event) => {
    if (scripts.has(event.requestId)) bytes += event.encodedDataLength;
  });

  return {
    total: () => bytes,
    reset: () => {
      bytes = 0;
      scripts.clear();
    },
  };
}

/** Milliseconds from the action to the page being usable again. */
async function timeOf(action: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await action();
  return Date.now() - started;
}

function record(step: string, ms: number): void {
  test.info().annotations.push({ type: 'SC-004', description: `${step}: ${ms} ms` });
}

function recordBytes(step: string, bytes: number): void {
  const kib = Math.round((bytes / 1024) * 10) / 10;
  test.info().annotations.push({ type: 'budget', description: `${step}: ${bytes} B (${kib} KiB)` });
}

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test('SC-004 — no step of the booking flow takes more than 2 s on 4G', async ({ page }) => {
  await throttle(page);

  const openBooking = await timeOf(() => page.goto('/', { waitUntil: 'load' }));
  record('open the booking screen', openBooking);

  const chooseService = await timeOf(async () => {
    await clickAndNavigate(page.getByRole('button', { name: /^Color/ }));
    await page.locator(SLOT_LIST).waitFor();
  });
  record('choose a service', chooseService);

  const chooseDay = await timeOf(async () => {
    await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
    await page.locator(SLOT_LIST).waitFor();
  });
  record('choose a day', chooseDay);

  const chooseSlot = await timeOf(async () => {
    await page.locator(`${SLOT_LIST} button`).first().click();
    await page.getByLabel('Nombre').waitFor();
  });
  record('choose an hour', chooseSlot);

  const confirm = await timeOf(async () => {
    await page.getByLabel('Nombre').fill('Ana López');
    await page.getByLabel('Teléfono').fill('600112233');
    await page.getByLabel('Email', { exact: true }).fill('ana@example.com');
    await page.getByRole('button', { name: 'Confirmar la cita' }).click();
    await page.waitForURL(/\/cita\//);
  });
  record('confirm', confirm);

  for (const [step, ms] of Object.entries({
    openBooking,
    chooseService,
    chooseDay,
    chooseSlot,
    confirm,
  })) {
    expect(ms, `${step} took ${ms} ms`).toBeLessThan(PERCEIVED_LIMIT_MS);
  }
});

test('005 SC-004 — four services chosen, and still no step over 2 s', async ({ page }) => {
  await throttle(page);

  const openBooking = await timeOf(() => page.goto('/', { waitUntil: 'load' }));
  record('open the booking screen', openBooking);

  // Corte comes chosen; each of the other three is one more press and one more
  // recalculation of the 14 days for a longer selection (FR-009).
  const steps: Record<string, number> = { openBooking };
  for (const name of ['Color', 'Peinado', 'Lavado']) {
    steps[`add ${name}`] = await timeOf(async () => {
      await clickAndNavigate(
        page.locator('section[aria-labelledby="service-heading"] button.service-option', {
          hasText: name,
        }),
      );
      await page.locator(DAY_GRID).waitFor();
    });
    record(`add ${name}`, steps[`add ${name}`] ?? 0);
  }

  steps['chooseDay'] = await timeOf(async () => {
    await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
    await page.locator(SLOT_LIST).waitFor();
  });
  record('choose a day', steps['chooseDay'] ?? 0);

  steps['chooseSlot'] = await timeOf(async () => {
    await page.locator(`${SLOT_LIST} button`).first().click();
    await page.getByLabel('Nombre').waitFor();
  });
  record('choose an hour', steps['chooseSlot'] ?? 0);

  steps['confirm'] = await timeOf(async () => {
    await page.getByLabel('Nombre').fill('Ana López');
    await page.getByLabel('Teléfono').fill('600112233');
    await page.getByLabel('Email', { exact: true }).fill('ana@example.com');
    await page.getByRole('button', { name: 'Confirmar la cita' }).click();
    await page.waitForURL(/\/cita\//);
  });
  record('confirm', steps['confirm'] ?? 0);

  for (const [step, ms] of Object.entries(steps)) {
    expect(ms, `${step} took ${ms} ms`).toBeLessThan(PERCEIVED_LIMIT_MS);
  }
});

/**
 * 004, SC-002: the checkbox adds nothing to the wait. The email leaves after
 * the answer (D-003), so neither a provider that answers nor one that never
 * does can be seen from the confirmation.
 */
for (const mode of ['ok', 'hang'] as const) {
  test(`004 SC-002 — confirming with the email checkbox stays under 2 s, provider ${mode}`, async ({ page }) => {
    await setMode(mode);
    try {
      await page.goto('/');
      await chooseOnlyService(page, 'Corte');
      await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
      await page.locator(`${SLOT_LIST} button`).first().click();
      await page.getByLabel('Nombre').waitFor();

      await throttle(page);
      await page.getByLabel('Nombre').fill('Ana López');
      await page.getByLabel('Teléfono').fill('600112233');
      await page.getByLabel('Email', { exact: true }).fill('ana.sc002@example.com');
      await page.getByLabel(EMAIL_CONSENT_LABEL).check();

      const confirm = await timeOf(async () => {
        await page.getByRole('button', { name: 'Confirmar la cita' }).click();
        await page.waitForURL(/\/cita\//);
      });
      record(`confirm with the email checkbox, provider ${mode}`, confirm);

      expect(confirm, `confirm took ${confirm} ms`).toBeLessThan(PERCEIVED_LIMIT_MS);
    } finally {
      await setMode('ok');
    }
  });
}

test('SC-004 — the management screens answer inside 2 s too', async ({ page }) => {
  await throttle(page);

  const { token } = await seedAppointment({ startsAt: slotDaysFromNow(6) });

  const openAppointment = await timeOf(() =>
    page.goto(`/cita/${token}`, { waitUntil: 'load' }),
  );
  record('open the appointment', openAppointment);

  const openReschedule = await timeOf(() =>
    page.goto(`/cita/${token}/reprogramar`, { waitUntil: 'load' }),
  );
  record('open the reschedule screen', openReschedule);

  expect(openAppointment).toBeLessThan(PERCEIVED_LIMIT_MS);
  expect(openReschedule).toBeLessThan(PERCEIVED_LIMIT_MS);
});

test('the booking route stays inside its JavaScript budget', async ({ page }) => {
  const session = await throttle(page);
  const scripts = countScriptBytes(session);

  await page.goto('/', { waitUntil: 'load' });
  const bookingScreen = scripts.total();

  scripts.reset();
  await chooseOnlyService(page, 'Corte');
  await clickAndNavigate(page.locator(`${DAY_GRID} button.is-available`).last());
  await page.locator(`${SLOT_LIST} button`).first().click();
  await page.getByLabel('Nombre').waitFor();
  const formScreen = scripts.total();

  recordBytes('booking screen JavaScript over the wire', bookingScreen);
  recordBytes('form screen JavaScript over the wire', formScreen);

  expect(bookingScreen).toBeGreaterThan(0);
  expect(bookingScreen).toBeLessThanOrEqual(BUDGET_BYTES);
  expect(formScreen).toBeLessThanOrEqual(BUDGET_BYTES);
});
