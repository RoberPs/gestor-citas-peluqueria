import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { createOwnerAccountRepository } from '@/infrastructure/db/owner-account-repository';
import { passwordHasher } from '@/infrastructure/security/password';
import { ensureSchema, testPool } from '../../integration/helpers/test-db';
import { contractAt } from '../helpers/openapi';

/** What the owner suites share: the contract, one provisioned account and its cookie. */

export const ownerContract = contractAt('002-salon-management/contracts/owner-api.yaml');

export const OWNER = { username: 'duena', password: 'una contraseña muy larga' } as const;

/** Exactly one account, provisioned the way `owner:provision` does it (FR-003). */
export async function provisionOwner(): Promise<void> {
  await ensureSchema();
  await createOwnerAccountRepository(testPool).replace({
    id: randomUUID(),
    username: OWNER.username,
    passwordHash: await passwordHasher.hash(OWNER.password),
    at: Temporal.Now.instant(),
  });
}

export function signInRequest(body: unknown): Request {
  return new Request('http://localhost/api/gestion/sesion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The `Cookie` header that carries the session a 204 sign-in set. */
export function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

/** Signs in through the real route and returns the `Cookie` header to send. */
export async function ownerCookie(): Promise<string> {
  const { POST } = await import('@/app/api/gestion/sesion/route');
  const response = await POST(signInRequest(OWNER));
  if (response.status !== 204) throw new Error('the fixture sign-in was rejected');
  return cookieFrom(response);
}

/** A GET with the owner's cookie, or without one when it is empty. */
export function ownerGet(url: string, cookie: string): Request {
  return new Request(url, { headers: cookie === '' ? {} : { Cookie: cookie } });
}
