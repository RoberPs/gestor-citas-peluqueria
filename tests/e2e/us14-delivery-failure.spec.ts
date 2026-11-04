import { Temporal } from '@js-temporal/polyfill';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { closeAppointmentsPool, notificationOf, resetAppointments } from './helpers/appointments';
import { TIMELINE } from './helpers/agenda';
import { expectNoAccessibilityViolations } from './helpers/axe';
import { bookAppointment } from './helpers/booking';
import { useOwnClientIp } from './helpers/client-ip';
import { clearMessages, setMode } from './helpers/email';
import { closeOwnerPool, resetOwnerAccess, signInAsOwner } from './helpers/owner';

/**
 * 004, Historia 3 — el envío nunca pone en riesgo la reserva. With the fake
 * provider down or refusing, the booking goes as always; a confirmation that
 * failed for good is marked for the owner, with the phone to call.
 */

const CUSTOMER = { name: 'Ana López', phone: '600 11 22 33', email: 'ana.us14@example.com' };
const MARK = 'Confirmación por email no enviada';

let pool: Pool | undefined;

/** The salon day of the only appointment booked with that email. */
async function dayOf(email: string): Promise<string> {
  pool ??= new Pool({ connectionString: process.env['DATABASE_URL_TEST'] ?? '', max: 1 });
  const { rows } = await pool.query<{ starts_at: Date }>(
    'SELECT starts_at FROM appointment WHERE customer_email_normalized = $1',
    [email],
  );
  const startsAt = rows[0]?.starts_at;
  if (startsAt === undefined) throw new Error('no such appointment');
  return Temporal.Instant.fromEpochMilliseconds(startsAt.getTime())
    .toZonedDateTimeISO('Europe/Madrid')
    .toPlainDate()
    .toString();
}

async function expectStatus(email: string, status: string): Promise<void> {
  await expect.poll(async () => (await notificationOf(email))?.status, { timeout: 15_000 }).toBe(status);
}

async function bookAsClient(page: Page) {
  const client = await page.context().browser()?.newPage();
  if (client === undefined) throw new Error('no browser');
  await useOwnClientIp(client, test.info());
  try {
    return await bookAppointment(client, { customer: CUSTOMER, emailConsent: true });
  } finally {
    await client.close();
  }
}

test.beforeEach(async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await resetAppointments();
  await clearMessages();
});

test.afterEach(async () => {
  await setMode('ok');
});

test.afterAll(async () => {
  await closeAppointmentsPool();
  await closeOwnerPool();
  await pool?.end();
});

test('escenario 1 — with the provider down, the booking and its confirmation screen are as always', async ({ page }) => {
  await setMode('fail');

  const { token } = await bookAppointment(page, { customer: CUSTOMER, emailConsent: true });

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Cita confirmada!');
  await expect(page.locator('section[aria-labelledby="save-link-heading"]')).toContainText(CUSTOMER.email);
  await expect(page.locator('section[aria-labelledby="save-link-heading"]').getByRole('link')).toHaveText(
    new RegExp(token),
  );
  // It waits for a retry; nothing about it reaches the client or the appointment.
  await expectStatus(CUSTOMER.email, 'PENDING');
  await expect(page.locator('section[aria-labelledby="appointment-heading"]')).toContainText('Confirmada');
});

test('escenarios 3 y 4 — a confirmation refused for good is marked in the agenda and the list, until cancelled', async ({
  page,
}) => {
  await setMode('reject');
  const { token } = await bookAsClient(page);
  await expectStatus(CUSTOMER.email, 'FAILED');
  const day = await dayOf(CUSTOMER.email);

  await resetOwnerAccess();
  await signInAsOwner(page);

  await page.goto(`/gestion/agenda?fecha=${day}`);
  const card = page.locator(`${TIMELINE} article`).filter({ hasText: CUSTOMER.name });
  await expect(card).toContainText(`⚠ ${MARK}`);
  await expect(card).toContainText('Llámale para darle su enlace.');
  await expect(card.locator('.confirmation-failed a[href="tel:600112233"]')).toHaveText(CUSTOMER.phone);
  await expectNoAccessibilityViolations(page);

  await page.goto('/gestion/reservas');
  const row = page.locator('ol.booking-list > li').filter({ hasText: CUSTOMER.name });
  await expect(row).toContainText(MARK);
  await expect(row.locator('.confirmation-failed a[href="tel:600112233"]')).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // The client cancels: nobody to call any more.
  const client = await page.context().browser()?.newPage();
  if (client === undefined) throw new Error('no browser');
  await useOwnClientIp(client, test.info());
  await client.goto(`/cita/${token}?cancelar=1`);
  await client.getByRole('button', { name: 'Sí, cancelar la cita' }).click();
  await expect(client.locator('section[aria-labelledby="appointment-heading"]')).toContainText('Cancelada');
  await client.close();

  await page.goto(`/gestion/agenda?fecha=${day}&canceladas=1`);
  await expect(page.locator(`${TIMELINE} article`).filter({ hasText: CUSTOMER.name })).not.toContainText(MARK);
  await page.goto('/gestion/reservas?estado=todas');
  await expect(page.locator('ol.booking-list > li').filter({ hasText: CUSTOMER.name })).not.toContainText(MARK);
});

test('a confirmation sent shows nothing to the owner', async ({ page }) => {
  await bookAsClient(page);
  await expectStatus(CUSTOMER.email, 'SENT');
  const day = await dayOf(CUSTOMER.email);

  await resetOwnerAccess();
  await signInAsOwner(page);
  await page.goto(`/gestion/agenda?fecha=${day}`);

  await expect(page.locator(`${TIMELINE} article`).filter({ hasText: CUSTOMER.name })).toBeVisible();
  await expect(page.getByText(MARK)).toHaveCount(0);
});
