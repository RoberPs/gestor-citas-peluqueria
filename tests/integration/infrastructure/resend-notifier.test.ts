import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OutgoingEmail } from '@/application/ports';
import { createResendNotifier } from '@/infrastructure/notifications/resend-notifier';
import {
  FAKE_EMAIL_API_KEY,
  startFakeEmailProvider,
  type FakeEmailProvider,
} from '../../support/fake-email-provider';

/**
 * 004, T014: the Resend adapter against the fake provider, over real HTTP.
 * What the provider receives is what production would send.
 */

const MESSAGE: OutgoingEmail = {
  channel: 'EMAIL',
  to: 'ana@example.com',
  fromName: 'Peluquería de Caballeros Niza',
  subject: 'Tu cita en Peluquería de Caballeros Niza: vie 14 nov, 11:30',
  html: '<!doctype html><html lang="es"><body><p>Hola</p></body></html>',
  text: 'Hola',
  headers: {
    'List-Unsubscribe': '<https://salon.example/api/unsubscribe/abc>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
};

let provider: FakeEmailProvider;

function notifier(options: { replyTo?: string | null; timeoutMs?: number } = {}) {
  return createResendNotifier({
    apiKey: FAKE_EMAIL_API_KEY,
    apiBaseUrl: provider.url,
    from: 'citas@example.test',
    replyTo: options.replyTo ?? null,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
}

beforeAll(async () => {
  provider = await startFakeEmailProvider();
});

afterAll(async () => {
  await provider.close();
});

beforeEach(() => {
  provider.clear();
  provider.setMode('ok');
});

describe('what the provider receives', () => {
  it('sends the email with its key, its sender and its unsubscribe headers', async () => {
    const result = await notifier().send(MESSAGE, 'notification-1');

    expect(result).toEqual({ ok: true, value: undefined });
    const [received] = provider.messages();
    expect(received?.authorization).toBe(`Bearer ${FAKE_EMAIL_API_KEY}`);
    expect(received?.idempotencyKey).toBe('notification-1');
    expect(received?.body).toEqual({
      from: 'Peluquería de Caballeros Niza <citas@example.test>',
      to: ['ana@example.com'],
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
      headers: MESSAGE.headers,
    });
  });

  it('adds the reply-to only when it is configured', async () => {
    await notifier({ replyTo: 'salon@salon.example' }).send(MESSAGE, 'notification-2');
    expect(provider.messages()[0]?.body.reply_to).toBe('salon@salon.example');
  });

  it('quotes a salon name the address syntax would misread', async () => {
    await notifier().send({ ...MESSAGE, fromName: 'Niza, peluquería' }, 'notification-3');
    expect(provider.messages()[0]?.body.from).toBe('"Niza, peluquería" <citas@example.test>');
  });

  it('is stored once when the same key is sent twice (FR-012)', async () => {
    await notifier().send(MESSAGE, 'notification-4');
    await notifier().send(MESSAGE, 'notification-4');
    expect(provider.messages()).toHaveLength(1);
  });
});

describe('what a failure becomes (D-006)', () => {
  it('is transient when the provider is unavailable', async () => {
    provider.setMode('fail');
    expect(await notifier().send(MESSAGE, 'n')).toEqual({ ok: false, error: 'TRANSIENT' });
  });

  it('is permanent when the provider rejects the email', async () => {
    provider.setMode('reject');
    expect(await notifier().send(MESSAGE, 'n')).toEqual({ ok: false, error: 'PERMANENT' });
  });

  it('is transient when the provider never answers, after the timeout', async () => {
    provider.setMode('hang');
    const started = Date.now();
    expect(await notifier({ timeoutMs: 300 }).send(MESSAGE, 'n')).toEqual({ ok: false, error: 'TRANSIENT' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('carries nothing of a body that repeats the address', async () => {
    provider.setMode('echo');
    const result = await notifier().send(MESSAGE, 'n');
    expect(result).toEqual({ ok: false, error: 'PERMANENT' });
    expect(JSON.stringify(result)).not.toContain('ana@example.com');
  });
});
