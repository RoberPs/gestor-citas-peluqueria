import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './helpers/axe';
import { closeOwnerPool, E2E_OWNER, resetOwnerAccess, signInAsOwner } from './helpers/owner';

/**
 * 002, Historia 1 — entrar en la gestión del salón (T040).
 *
 * Every owner screen is found in the file system, as Next finds it, and
 * visited with no session: each must land on the sign-in form having shown
 * nothing (FR-002, SC-001). The API side of the same sweep is an integration
 * test; this is the screens'.
 */

const PAGES_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'app',
  'gestion',
);
const REJECTED = 'El usuario o la contraseña no son correctos.';

function ownerScreens(directory: string, route = '/gestion'): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return entry.startsWith('_') || entry.startsWith('[') ? [] : ownerScreens(full, `${route}/${entry}`);
    }
    return entry === 'page.tsx' ? [route] : [];
  });
}

const SCREENS = ownerScreens(PAGES_ROOT).filter((route) => route !== '/gestion/acceso');

test.beforeEach(async () => {
  await resetOwnerAccess();
});

test.afterAll(async () => {
  await closeOwnerPool();
});

test('finds the owner screens at all, so an empty sweep cannot pass', () => {
  expect(SCREENS).toEqual(expect.arrayContaining(['/gestion/agenda', '/gestion/cuenta']));
});

for (const screen of SCREENS) {
  test(`escenario 2 — ${screen} without a session lands on the sign-in form`, async ({ page }) => {
    await page.goto(screen);

    await expect(page).toHaveURL(/\/gestion\/acceso$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Entrar en la gestión del salón',
    );
    await expect(page.getByText('Agenda', { exact: true })).toHaveCount(0);
  });
}

test('escenario 1 — the right credentials open the agenda', async ({ page }) => {
  await page.goto('/gestion/acceso');

  await page.getByLabel('Usuario').fill(E2E_OWNER.username);
  await page.getByLabel('Contraseña').fill(E2E_OWNER.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/gestion\/agenda$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Agenda');
  await expect(page.getByRole('navigation', { name: 'Gestión del salón' })).toBeVisible();
});

test('escenario 3 — a wrong password and an unknown user get the very same message', async ({ page }) => {
  await page.goto('/gestion/acceso');

  await page.getByLabel('Usuario').fill(E2E_OWNER.username);
  await page.getByLabel('Contraseña').fill('no es la contraseña');
  await page.getByRole('button', { name: 'Entrar' }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText(REJECTED);
  const wrongPassword = await alert.innerText();

  await page.getByLabel('Usuario').fill('nadie');
  await page.getByLabel('Contraseña').fill(E2E_OWNER.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(alert).toContainText(REJECTED);
  const unknownUser = await alert.innerText();

  expect(wrongPassword).toContain(REJECTED);
  expect(unknownUser).toBe(wrongPassword);
  await expect(page).toHaveURL(/\/gestion\/acceso$/);
});

test('escenario 5 — after signing out, Back shows no owner data', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/gestion/agenda');
  await page.goto('/gestion/cuenta');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');

  await page.getByRole('main').getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/gestion\/acceso$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/gestion\/acceso$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entrar en la gestión del salón');
});

test('FR-005 — the form says what to do if the password is forgotten', async ({ page }) => {
  await page.goto('/gestion/acceso');

  await expect(page.getByText(/no se puede recuperar desde aquí/)).toBeVisible();
});

test('FR-004 — the password can be changed from the account screen', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/gestion/cuenta');

  await page.getByLabel('Contraseña actual').fill('no es la actual');
  await page.getByLabel('Contraseña nueva').fill(E2E_OWNER.password);
  await page.getByRole('button', { name: 'Guardar la contraseña nueva' }).click();
  await expect(page.getByText('La contraseña actual no es correcta.')).toBeVisible();

  await page.getByLabel('Contraseña actual').fill(E2E_OWNER.password);
  await page.getByLabel('Contraseña nueva').fill(E2E_OWNER.password);
  await page.getByRole('button', { name: 'Guardar la contraseña nueva' }).click();
  await expect(page.getByText(/Contraseña cambiada/)).toBeVisible();
});

test('the sign-in form and the account screen pass axe and fit the width', async ({ page }) => {
  await page.goto('/gestion/acceso');
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);

  await signInAsOwner(page);
  await page.goto('/gestion/cuenta');
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});
