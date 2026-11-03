import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Walking a booking through the real screens, which is how every story after
 * the first one gets an appointment to work with.
 *
 * It picks a day near the end of the range on purpose: the 24 hour deadline is
 * what decides whether cancelling and rescheduling are on offer, and a fixture
 * that sometimes lands on today would make those suites depend on the hour they
 * run at.
 */

export const DAY_GRID = 'ul[aria-label="Días disponibles"]';
export const SLOT_LIST = 'ul[aria-label="Horas disponibles"]';

/**
 * Choosing a service, a day or a range is an in-app navigation since 003
 * (D-003): the URL changes a moment after the click, with no page load for
 * Playwright to wait on. This waits for it, so whatever is read or clicked
 * next belongs to the new choice and not to the screen being left.
 */
export async function clickAndNavigate(target: Locator): Promise<void> {
  const page = target.page();
  const before = page.url();
  await target.click();
  await page.waitForURL((url) => url.href !== before);
}

/**
 * Leaves exactly that service chosen (005). Services are marked and unmarked,
 * so pressing the first one — already chosen on arrival — would unmark it:
 * this presses only what has to change, one navigation per press.
 */
export async function chooseOnlyService(page: Page, name: string): Promise<void> {
  const options = page.locator('section[aria-labelledby="service-heading"] button.service-option');
  const target = options.filter({ hasText: name });

  if ((await target.getAttribute('aria-pressed')) !== 'true') await clickAndNavigate(target);

  for (;;) {
    const other = options.and(page.locator('[aria-pressed="true"]')).filter({ hasNotText: name });
    if ((await other.count()) === 0) return;
    await clickAndNavigate(other.first());
  }
}

export type BookedAppointment = {
  readonly token: string;
  readonly url: string;
  readonly localTime: string;
};

export async function bookAppointment(
  page: Page,
  options: { service?: string; customer?: { name: string; phone: string; email: string } } = {},
): Promise<BookedAppointment> {
  const service = options.service ?? 'Corte';
  const customer = options.customer ?? {
    name: 'Ana López',
    phone: '600 11 22 33',
    email: 'ana@example.com',
  };

  await page.goto('/');
  await chooseOnlyService(page, service);

  // The last day with room in the range: comfortably past the 24 hour deadline.
  const day = page.locator(`${DAY_GRID} button.is-available`).last();
  await expect(day).toBeVisible();
  await clickAndNavigate(day);

  const slot = page.locator(`${SLOT_LIST} button`).first();
  await expect(slot).toBeVisible();
  const localTime = ((await slot.textContent()) ?? '').trim().slice(0, 5);
  await slot.click();

  await page.getByLabel('Nombre').fill(customer.name);
  await page.getByLabel('Teléfono').fill(customer.phone);
  await page.getByLabel('Email').fill(customer.email);
  await page.getByRole('button', { name: 'Confirmar la cita' }).click();

  await page.waitForURL(/\/cita\/[A-Za-z0-9_-]{43}\?nueva=1/);

  const url = page.url();
  const token = new URL(url).pathname.replace('/cita/', '');

  return { token, url, localTime };
}
