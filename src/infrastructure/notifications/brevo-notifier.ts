import type { Notifier } from '@/application/ports';
import { err, ok } from '@/domain/shared/result';
import { classifyStatus, PROVIDER_TIMEOUT_MS } from './provider-response';

/**
 * Brevo's `POST /smtp/email`, with `fetch` and no SDK (004, D-004 revised on
 * 2026-11-04).
 *
 * - A repeated send is harmless while Brevo remembers the key: the
 *   notification id, a UUID, travels as `idempotencyKey` and a second request
 *   with it is refused as `duplicate_parameter`. That refusal means the email
 *   is already on its way, so it counts as accepted (FR-012).
 * - The unsubscribe headers of the message are not sent. Brevo takes no
 *   standard header in `headers` and adds its own `List-Unsubscribe`; the
 *   unsubscribe link in the body is still the app's own.
 * - Nothing the provider says comes back up (D-006). Of a `400` only its
 *   `code` is read, a value from Brevo's own list; its `message` can repeat
 *   the address and is never looked at.
 */

const DUPLICATE_KEY = 'duplicate_parameter';

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string'
    ) {
      return body.code;
    }
  } catch {
    // Not JSON: the request was refused all the same.
  }
  return null;
}

export function createBrevoNotifier(config: {
  readonly apiKey: string;
  readonly apiBaseUrl: string;
  readonly from: string;
  readonly replyTo: string | null;
  readonly timeoutMs?: number;
  /** Test seam; the global `fetch` otherwise. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}): Notifier {
  const send = config.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = config.timeoutMs ?? PROVIDER_TIMEOUT_MS;

  return {
    async send(message, idempotencyKey) {
      let response: Response;
      try {
        response = await send(`${config.apiBaseUrl}/smtp/email`, {
          method: 'POST',
          headers: {
            'api-key': config.apiKey,
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: message.fromName, email: config.from },
            to: [{ email: message.to }],
            ...(config.replyTo === null ? {} : { replyTo: { email: config.replyTo } }),
            subject: message.subject,
            htmlContent: message.html,
            textContent: message.text,
            headers: { idempotencyKey },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // A network error or the timeout. Its message is dropped too: an
        // undici error can quote the request.
        return err('TRANSIENT');
      }

      if (response.status === 400) {
        return (await errorCode(response)) === DUPLICATE_KEY ? ok(undefined) : err('PERMANENT');
      }

      // Any other body is released unread.
      await response.body?.cancel().catch(() => undefined);

      const failure = classifyStatus(response.status);
      return failure === null ? ok(undefined) : err(failure);
    },
  };
}
