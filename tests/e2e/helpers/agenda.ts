import { Temporal } from '@js-temporal/polyfill';
import { expect, type Page } from '@playwright/test';
import { holidayDate } from '../../../db/seed/seed';
import { CORTE_ID } from './appointments';
import { SLOT_LIST } from './booking';

/**
 * What the suites of the owner's appointments share (002, Historias 4, 5, 6
 * y 11): a day the seeded salon is open, salon wall times as instants, and
 * the client's starts of a day, which is where a change shows (SC-003).
 */

export const TIMEZONE = 'Europe/Madrid';
export const TIMELINE = 'ol.timeline';
export const PANEL = 'section#accion';

/** A weekday a few days ahead, open 10:00–20:00 in the seed and not its holiday. */
export function openWeekday(daysAhead = 4): string {
  const holiday = holidayDate(TIMEZONE);
  let date = Temporal.Now.plainDateISO(TIMEZONE).add({ days: daysAhead });
  while (date.dayOfWeek > 5 || date.toString() === holiday) date = date.add({ days: 1 });
  return date.toString();
}

export function atSalon(date: string, time: string): Date {
  const zoned = Temporal.PlainDate.from(date).toZonedDateTime({
    timeZone: TIMEZONE,
    plainTime: Temporal.PlainTime.from(time),
  });
  return new Date(zoned.epochMilliseconds);
}

export async function clientStarts(page: Page, day: string): Promise<readonly string[]> {
  await page.goto(`/?serviceIds=${CORTE_ID}&selectedDate=${day}`);
  await expect(page.locator(SLOT_LIST)).toBeVisible();
  return page.locator(`${SLOT_LIST} li span[aria-hidden="true"]`).allInnerTexts();
}

/** Opens the panel to write an appointment by hand at `time`, with the picker's default service. */
export async function openNewAppointment(page: Page, day: string, time: string): Promise<void> {
  await page.goto(`/gestion/agenda?fecha=${day}&nueva=${time}#accion`);
  await expect(page.locator(PANEL).getByRole('heading', { name: 'Apuntar una cita' })).toBeVisible();
}

export async function fillCustomer(page: Page, customer: { name: string; phone: string; email?: string }): Promise<void> {
  const panel = page.locator(PANEL);
  await panel.getByLabel('Nombre').fill(customer.name);
  await panel.getByLabel('Teléfono').fill(customer.phone);
  if (customer.email !== undefined) await panel.getByLabel('Email (opcional)').fill(customer.email);
}
