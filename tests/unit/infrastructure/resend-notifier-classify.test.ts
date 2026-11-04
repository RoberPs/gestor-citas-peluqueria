import { describe, expect, it } from 'vitest';
import { classifyStatus, createResendNotifier } from '@/infrastructure/notifications/resend-notifier';
import type { OutgoingEmail } from '@/application/ports';

/**
 * 004, D-006: a failure of the provider is transient or permanent, and the
 * result never carries the provider's words, which may repeat the address.
 */

const EMAIL = 'ana@example.com';

const MESSAGE: OutgoingEmail = {
  channel: 'EMAIL',
  to: EMAIL,
  fromName: 'Salón',
  subject: 'Tu cita',
  html: '<p>Hola</p>',
  text: 'Hola',
  headers: {},
};

function notifierAnswering(answer: () => Promise<Response>) {
  return createResendNotifier({
    apiKey: 'key',
    apiBaseUrl: 'https://provider.test',
    from: 'citas@salon.example',
    replyTo: null,
    timeoutMs: 1_000,
    fetch: () => answer(),
  });
}

describe('classifyStatus', () => {
  it.each([[429], [500], [502], [503], [504]])('treats %d as transient', (status) => {
    expect(classifyStatus(status)).toBe('TRANSIENT');
  });

  it.each([[400], [401], [403], [404], [409], [422]])('treats %d as permanent', (status) => {
    expect(classifyStatus(status)).toBe('PERMANENT');
  });

  it.each([[200], [201], [202]])('treats %d as accepted', (status) => {
    expect(classifyStatus(status)).toBeNull();
  });
});

describe('the notifier result', () => {
  it('is transient on a network error', async () => {
    const result = await notifierAnswering(() => Promise.reject(new TypeError(`fetch failed for ${EMAIL}`))).send(
      MESSAGE,
      'n1',
    );
    expect(result).toEqual({ ok: false, error: 'TRANSIENT' });
  });

  it('is transient on a timeout', async () => {
    const result = await notifierAnswering(() =>
      Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    ).send(MESSAGE, 'n1');
    expect(result).toEqual({ ok: false, error: 'TRANSIENT' });
  });

  it('is permanent on a 422, and carries nothing of its body', async () => {
    const result = await notifierAnswering(() =>
      Promise.resolve(new Response(JSON.stringify({ name: 'validation_error', message: `Invalid to: ${EMAIL}` }), { status: 422 })),
    ).send(MESSAGE, 'n1');
    expect(result).toEqual({ ok: false, error: 'PERMANENT' });
    expect(JSON.stringify(result)).not.toContain(EMAIL);
  });

  it('is accepted on a 200', async () => {
    const result = await notifierAnswering(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 })),
    ).send(MESSAGE, 'n1');
    expect(result).toEqual({ ok: true, value: undefined });
  });
});
