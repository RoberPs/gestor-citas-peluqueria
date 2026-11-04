import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, testPool } from '../../integration/helpers/test-db';
import { cookieFrom, OWNER, ownerContract, provisionOwner, signInRequest } from './helpers';

/**
 * 002, T037: `POST`/`DELETE /gestion/sesion` and `PUT /gestion/cuenta/contrasena`
 * against contracts/owner-api.yaml.
 */

const { POST: signIn, DELETE: signOut } = await import('@/app/api/gestion/sesion/route');
const { PUT: changePassword } = await import('@/app/api/gestion/cuenta/contrasena/route');

const { responseSchema, expectMatchesContract } = ownerContract;

function withCookie(url: string, method: string, cookie: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie === '' ? {} : { Cookie: cookie }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signedIn(): Promise<string> {
  return cookieFrom(await signIn(signInRequest(OWNER)));
}

beforeAll(async () => {
  await provisionOwner();
});

beforeEach(async () => {
  await testPool().query('TRUNCATE owner_session');
  await testPool().query(
    'UPDATE owner_account SET failed_attempts = 0, first_failed_attempt_at = NULL, locked_until = NULL',
  );
});

afterAll(async () => {
  await testPool().query('TRUNCATE owner_account CASCADE');
  await closeTestDb();
});

describe('POST /gestion/sesion', () => {
  it('answers 204 and sets the __Host- cookie with every attribute of D-015, and no Max-Age', async () => {
    const response = await signIn(signInRequest(OWNER));

    expect(response.status).toBe(204);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-owner_session=[A-Za-z0-9_-]{43}; /);
    for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) {
      expect(cookie).toContain(attribute);
    }
    expect(cookie).not.toMatch(/Max-Age|Expires|Domain/i);
  });

  it('answers a rejected sign-in with SignInRejected', async () => {
    const response = await signIn(signInRequest({ ...OWNER, password: 'no es la contraseña' }));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expectMatchesContract(responseSchema('/gestion/sesion', 'post', '401'), await response.json());
  });

  it.each([[{}], [{ username: 'duena' }], [{ ...OWNER, extra: true }], [null]])(
    'answers 400 to a body of the wrong shape: %j',
    async (body) => {
      const response = await signIn(signInRequest(body));

      expect(response.status).toBe(400);
      expectMatchesContract(responseSchema('/gestion/sesion', 'post', '400'), await response.json());
    },
  );
});

describe('DELETE /gestion/sesion', () => {
  it('answers 401 Unauthorized without a session', async () => {
    const response = await signOut(withCookie('http://localhost/api/gestion/sesion', 'DELETE', ''));

    expect(response.status).toBe(401);
    expectMatchesContract(responseSchema('/gestion/sesion', 'delete', '401'), await response.json());
  });

  it('answers 204, expires the cookie, and the session is gone', async () => {
    const cookie = await signedIn();

    const response = await signOut(withCookie('http://localhost/api/gestion/sesion', 'DELETE', cookie));

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toMatch(/^__Host-owner_session=; .*Max-Age=0/);
    const again = await signOut(withCookie('http://localhost/api/gestion/sesion', 'DELETE', cookie));
    expect(again.status).toBe(401);
  });
});

describe('PUT /gestion/cuenta/contrasena', () => {
  const url = 'http://localhost/api/gestion/cuenta/contrasena';

  it('answers 401 Unauthorized without a session', async () => {
    const response = await changePassword(
      withCookie(url, 'PUT', '', { currentPassword: OWNER.password, newPassword: 'otra contraseña larga' }),
    );

    expect(response.status).toBe(401);
    expectMatchesContract(responseSchema('/gestion/cuenta/contrasena', 'put', '401'), await response.json());
  });

  it.each([
    [{ currentPassword: 'no es la actual', newPassword: 'otra contraseña larga' }, 'WRONG_CURRENT_PASSWORD'],
    [{ currentPassword: OWNER.password, newPassword: 'corta' }, 'PASSWORD_TOO_SHORT'],
  ])('answers 422 with a code that says which: %j', async (body, code) => {
    const cookie = await signedIn();

    const response = await changePassword(withCookie(url, 'PUT', cookie, body));

    expect(response.status).toBe(422);
    const payload = await response.json();
    expectMatchesContract(responseSchema('/gestion/cuenta/contrasena', 'put', '422'), payload);
    expect(payload.code).toBe(code);
  });

  it('answers 204 when the password changes', async () => {
    const cookie = await signedIn();

    const response = await changePassword(
      withCookie(url, 'PUT', cookie, { currentPassword: OWNER.password, newPassword: OWNER.password }),
    );

    expect(response.status).toBe(204);
  });
});
