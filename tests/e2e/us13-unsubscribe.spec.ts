import { expect, test, type Page } from '@playwright/test';
import { closeAppointmentsPool, resetAppointments } from './helpers/appointments';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { bookAppointment } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';
import { clearMessages, linksIn, messagesTo } from './helpers/email';

/**
 * 004, Historia 2 — darse de baja del email, from the email and from the
 * appointment screen. Each project runs it at its own width; the tablet one
 * runs only `accessibility.spec.ts`, so the 768 px check sits here with its own
 * viewport.
 */

const CUSTOMER = { name: 'Ana López', phone: '600 11 22 33', email: 'ana.us13@example.com' };

async function bookAndReadEmail(page: Page) {
  const booked = await bookAppointment(page, { customer: CUSTOMER, emailConsent: true });
  await expect.poll(async () => (await messagesTo(CUSTOMER.email)).length, { timeout: 10_000 }).toBe(1);
  const [email] = await messagesTo(CUSTOMER.email);
  if (email === undefined) throw new Error('unreachable');
  return { ...booked, links: linksIn(email) };
}

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
  await clearMessages();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
});

test('escenarios 1 y 2 — from the email: opening asks, the button unsubscribes, the appointment stays', async ({
  page,
}) => {
  const { links, token } = await bookAndReadEmail(page);

  await page.goto(links.unsubscribe);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dejar de recibir emails');
  await expect(page.locator('main')).toContainText('Dejarás de recibir emails de Peluquería Aurora sobre tu cita.');
  await expect(page.getByRole('button', { name: 'Darme de baja' })).toBeVisible();

  // Nothing of the appointment: not its day, not its service, not the name (FR-024).
  await expect(page.locator('main')).not.toContainText('Corte');
  await expect(page.locator('main')).not.toContainText(CUSTOMER.name);
  await expect(page.locator('main')).not.toContainText(/\d{1,2}:\d{2}/);

  // Opening it, and opening it again, unsubscribes nobody (FR-015).
  await page.reload();
  await page.goto(`/cita/${token}`);
  await expect(page.getByText('Recibes la confirmación de esta cita por email.')).toBeVisible();

  await page.goto(links.unsubscribe);
  await page.getByRole('button', { name: 'Darme de baja' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Te has dado de baja');
  await expect(page.getByRole('status')).toContainText(
    'Ya no te enviaremos emails sobre esta cita. Tu cita no cambia.',
  );
  await expectNoAccessibilityViolations(page);

  await page.goto(`/cita/${token}`);
  await expect(page.getByText('Recibes la confirmación de esta cita por email.')).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="appointment-heading"]')).toContainText('Confirmada');
});

test('escenario 3 — opening it again says it was already done', async ({ page }) => {
  const { links } = await bookAndReadEmail(page);
  await page.goto(links.unsubscribe);
  await page.getByRole('button', { name: 'Darme de baja' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Te has dado de baja');

  await page.goto(links.unsubscribe);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ya te habías dado de baja');
  await expect(page.locator('main')).toContainText('No te enviaremos emails sobre esta cita.');
  await expect(page.getByRole('button', { name: 'Darme de baja' })).toHaveCount(0);
});

test('FR-017 — from the appointment screen, without JavaScript, and the section goes', async ({
  page: jsPage,
  browser,
}, testInfo) => {
  const { token } = await bookAppointment(jsPage, { customer: CUSTOMER, emailConsent: true });

  const context = await browser.newContext({ ...testInfo.project.use, javaScriptEnabled: false });
  const page = await context.newPage();
  await useOwnClientIp(page, testInfo);

  await page.goto(`/cita/${token}`);
  await expect(page.getByText('Recibes la confirmación de esta cita por email.')).toBeVisible();
  await page.getByRole('button', { name: 'Dejar de recibir emails' }).click();

  await expect(page.getByRole('status')).toContainText('Ya no te enviaremos emails sobre esta cita. Tu cita no cambia.');
  await expect(page.getByText('Recibes la confirmación de esta cita por email.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dejar de recibir emails' })).toHaveCount(0);
  await context.close();
});

test('FR-018 — an unsubscribe link that resolves to nothing gets the neutral screen', async ({ page }) => {
  await page.goto(`/baja/${'A'.repeat(43)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No hemos encontrado ninguna cita con este enlace.');
  await expectNoAccessibilityViolations(page);
});

for (const width of [360, 768, 1280]) {
  test(`FR-026 — the unsubscribe page passes axe and does not scroll sideways at ${width} px`, async ({ page }) => {
    const { links } = await bookAndReadEmail(page);
    await page.setViewportSize({ width, height: 900 });

    await page.goto(links.unsubscribe);
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });
}
