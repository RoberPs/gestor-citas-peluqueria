import { describe, expect, it } from 'vitest';
import type { OutgoingEmail } from '@/application/ports';
import { createBrevoNotifier } from '@/infrastructure/notifications/brevo-notifier';

/**
 * 004, D-004 (revised 2026-11-04): Brevo's `POST /smtp/email`. What it sends,
 * and what each answer becomes, without ever carrying the provider's words.
 */

const EMAIL = 'ana@example.com';

const MESSAGE: OutgoingEmail = {
  channel: 'EMAIL',
  to: EMAIL,
  fromName: 'Niza, peluquería',
  subject: 'Tu cita',
  html: '<p>Hola</p>',
  text: 'Hola',
  headers: {
    'List-Unsubscribe': '<https://salon.example/api/unsubscribe/abc>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
};

type Call = { readonly url: string; readonly init: RequestInit };

function notifierAnswering(answer: () => Promise<Response>, replyTo: string | null = null) {
  const calls: Call[] = [];
  const notifier = createBrevoNotifier({
    apiKey: 'xkeysib-test',
    apiBaseUrl: 'https://provider.test/v3',
    from: 'citas@salon.example',
    replyTo,
    timeoutMs: 1_000,
    fetch: (url, init) => {
      calls.push({ url, init });
      return answer();
    },
  });
  return { notifier, calls };
}

const accepted = () => Promise.resolve(new Response(JSON.stringify({ messageId: '<x@brevo>' }), { status: 201 }));

function answer(status: number, body: unknown) {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('the request', () => {
  it('posts to /smtp/email with the key in the api-key header', async () => {
    const { notifier, calls } = notifierAnswering(accepted);
    await notifier.send(MESSAGE, '0b5f3c2e-8d1a-4c7e-9f60-2a4b6c8d0e1f');

    expect(calls[0]?.url).toBe('https://provider.test/v3/smtp/email');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toMatchObject({ 'api-key': 'xkeysib-test', 'content-type': 'application/json' });
  });

  it('carries the sender, the recipient, both parts and the idempotency key', async () => {
    const { notifier, calls } = notifierAnswering(accepted);
    await notifier.send(MESSAGE, '0b5f3c2e-8d1a-4c7e-9f60-2a4b6c8d0e1f');

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      sender: { name: 'Niza, peluquería', email: 'citas@salon.example' },
      to: [{ email: EMAIL }],
      subject: 'Tu cita',
      htmlContent: '<p>Hola</p>',
      textContent: 'Hola',
      headers: { idempotencyKey: '0b5f3c2e-8d1a-4c7e-9f60-2a4b6c8d0e1f' },
    });
  });

  it('leaves the unsubscribe headers out, because Brevo takes no standard header', async () => {
    const { notifier, calls } = notifierAnswering(accepted);
    await notifier.send(MESSAGE, 'n1');
    expect(String(calls[0]?.init.body)).not.toContain('List-Unsubscribe');
  });

  it('adds the reply-to only when it is configured', async () => {
    const { notifier, calls } = notifierAnswering(accepted, 'salon@salon.example');
    await notifier.send(MESSAGE, 'n1');
    expect(JSON.parse(String(calls[0]?.init.body)).replyTo).toEqual({ email: 'salon@salon.example' });
  });
});

describe('the notifier result (D-006)', () => {
  it('is accepted on a 201', async () => {
    expect(await notifierAnswering(accepted).notifier.send(MESSAGE, 'n1')).toEqual({ ok: true, value: undefined });
  });

  it('is accepted when the key was already used: that email is on its way (FR-012)', async () => {
    const { notifier } = notifierAnswering(answer(400, { code: 'duplicate_parameter', message: 'duplicate key' }));
    expect(await notifier.send(MESSAGE, 'n1')).toEqual({ ok: true, value: undefined });
  });

  it('is permanent on any other 400, and carries nothing of its body', async () => {
    const { notifier } = notifierAnswering(answer(400, { code: 'invalid_parameter', message: `email is not valid: ${EMAIL}` }));
    const result = await notifier.send(MESSAGE, 'n1');
    expect(result).toEqual({ ok: false, error: 'PERMANENT' });
    expect(JSON.stringify(result)).not.toContain(EMAIL);
  });

  it('is permanent on a 400 whose body is not JSON', async () => {
    const { notifier } = notifierAnswering(() => Promise.resolve(new Response('Bad Request', { status: 400 })));
    expect(await notifier.send(MESSAGE, 'n1')).toEqual({ ok: false, error: 'PERMANENT' });
  });

  it.each([[401], [402], [403]])('is permanent on a %d', async (status) => {
    const { notifier } = notifierAnswering(answer(status, { code: 'unauthorized', message: 'Key not found' }));
    expect(await notifier.send(MESSAGE, 'n1')).toEqual({ ok: false, error: 'PERMANENT' });
  });

  it.each([[429], [500], [503]])('is transient on a %d', async (status) => {
    const { notifier } = notifierAnswering(answer(status, { message: 'later' }));
    expect(await notifier.send(MESSAGE, 'n1')).toEqual({ ok: false, error: 'TRANSIENT' });
  });

  it('is transient on a network error, and carries nothing of it', async () => {
    const { notifier } = notifierAnswering(() => Promise.reject(new TypeError(`fetch failed for ${EMAIL}`)));
    const result = await notifier.send(MESSAGE, 'n1');
    expect(result).toEqual({ ok: false, error: 'TRANSIENT' });
    expect(JSON.stringify(result)).not.toContain(EMAIL);
  });
});
