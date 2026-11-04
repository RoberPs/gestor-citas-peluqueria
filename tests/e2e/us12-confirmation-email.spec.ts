import { expect, test, type Page } from '@playwright/test';
import { closeAppointmentsPool, notificationOf, resetAppointments } from './helpers/appointments';
import { fillCustomer, openNewAppointment, openWeekday, PANEL } from './helpers/agenda';
import { expectNoAccessibilityViolations } from './helpers/axe';
import { bookAppointment, EMAIL_CONSENT_LABEL, openBookingForm } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';
import { clearMessages, linksIn, messagesTo } from './helpers/email';
import { closeOwnerPool, resetOwnerAccess, resetPeriods, signInAsOwner } from './helpers/owner';

/**
 * 004, Historia 1 — recibir la confirmación por email al reservar.
 *
 * The server runs with the email channel on and sends to the fake provider
 * started in `global-setup.ts`; what it received is read back over HTTP.
 */

const CUSTOMER = { name: 'Ana López', phone: '600 11 22 33', email: 'ana.us12@example.com' };

/** SC-001: within seconds of the booking, without the dispatch command. */
const ARRIVAL_LIMIT_MS = 10_000;

async function waitForEmailTo(address: string) {
  await expect.poll(async () => (await messagesTo(address)).length, { timeout: ARRIVAL_LIMIT_MS }).toBe(1);
  const [message] = await messagesTo(address);
  if (message === undefined) throw new Error('unreachable');
  return message;
}

/** Long enough for a first attempt that should not happen to have happened. */
async function expectNoEmailTo(page: Page, address: string): Promise<void> {
  await page.waitForTimeout(2_000);
  expect(await messagesTo(address)).toHaveLength(0);
}

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
  await clearMessages();
});

test.afterAll(async () => {
  await closeAppointmentsPool();
  await closeOwnerPool();
});

test('FR-001 — the checkbox is there, unticked, with its label and its help', async ({ page }) => {
  await openBookingForm(page);

  const checkbox = page.getByLabel(EMAIL_CONSENT_LABEL);
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toHaveAccessibleDescription(
    'Sólo te enviaremos la confirmación de esta cita, sin publicidad. Podrás darte de baja desde el propio email.',
  );

  await expectNoAccessibilityViolations(page);
});

test('escenarios 1 y 2 — with the checkbox, the screen names the address and one email arrives', async ({ page }) => {
  const started = Date.now();
  const { token, localTime } = await bookAppointment(page, { customer: CUSTOMER, emailConsent: true });

  const notice = page.locator('section[aria-labelledby="save-link-heading"]');
  await expect(notice).toContainText(`Te enviamos la confirmación a ${CUSTOMER.email}.`);
  await expect(notice).toContainText('mira en la carpeta de spam');
  await expect(notice).not.toContainText('No te lo vamos a enviar');
  await expect(notice.getByRole('link')).toHaveText(new RegExp(token));
  await expectNoAccessibilityViolations(page);

  const email = await waitForEmailTo(CUSTOMER.email);
  expect(email.receivedAt - started).toBeLessThan(ARRIVAL_LIMIT_MS);

  const text = email.body.text ?? '';
  expect(email.body.subject).toContain('Tu cita en Peluquería Aurora');
  expect(text).toContain(`de ${localTime} a `);
  expect(text).toMatch(/(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d+ de [a-z]+/);
  expect(text).toContain('Corte: 18,00 €');
  expect(text).toContain('Total: 18,00 €');
  expect(text).toContain('Calle Mayor 14');
  expect(text).toContain('911 23 45 67');
  expect(text).toContain('Darme de baja');
  for (const part of [email.body.text ?? '', email.body.html ?? '']) {
    expect(part).not.toContain('600 11 22 33');
    expect(part).not.toContain('600112233');
    expect(part).not.toContain(CUSTOMER.email);
  }

  // Its management link opens that very appointment.
  const { management } = linksIn(email);
  expect(management).toContain(`/cita/${token}`);
  await page.goto(management);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cita');
  await expect(page.locator('section[aria-labelledby="appointment-heading"]')).toContainText(localTime);
});

test('escenario 3 — without the checkbox, the text of 001 and no email', async ({ page }) => {
  await bookAppointment(page, { customer: CUSTOMER });

  await expect(page.locator('section[aria-labelledby="save-link-heading"]')).toContainText(
    'No te lo vamos a enviar por SMS ni por email',
  );
  await expectNoEmailTo(page, CUSTOMER.email);
  expect(await notificationOf(CUSTOMER.email)).toBeNull();
});

test('the checkbox keeps its state after an error in another field (001, FR-009)', async ({ page }) => {
  await openBookingForm(page);

  await page.getByLabel('Nombre').fill(CUSTOMER.name);
  await page.getByLabel('Teléfono').fill('12345');
  await page.getByLabel('Email', { exact: true }).fill(CUSTOMER.email);
  await page.getByLabel(EMAIL_CONSENT_LABEL).check();
  await page.getByRole('button', { name: 'Confirmar la cita' }).click();

  await expect(page.getByLabel('Teléfono')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel(EMAIL_CONSENT_LABEL)).toBeChecked();
});

test('FR-009 — an appointment the owner writes by hand, with an email, sends nothing', async ({ page }) => {
  await resetPeriods();
  await resetOwnerAccess();
  await signInAsOwner(page);

  await openNewAppointment(page, openWeekday(), '16:00');
  await fillCustomer(page, { name: 'Luis Pérez', phone: '611 22 33 44', email: 'luis.us12@example.com' });
  await page.locator(PANEL).getByRole('button', { name: 'Guardar la cita' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cita apuntada.' })).toBeVisible();

  await expectNoEmailTo(page, 'luis.us12@example.com');
  expect(await notificationOf('luis.us12@example.com')).toBeNull();
});
