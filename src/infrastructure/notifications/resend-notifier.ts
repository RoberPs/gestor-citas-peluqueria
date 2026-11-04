import type { Notifier } from '@/application/ports';
import { err, ok } from '@/domain/shared/result';

/**
 * Resend's `POST /emails`, with `fetch` and no SDK (004, D-004).
 *
 * Two promises it keeps:
 * - A repeated send is harmless: the notification id travels as the
 *   `Idempotency-Key`, so the provider stores it once (FR-012).
 * - Nothing the provider says comes back up. Its error body can repeat the
 *   address (FR-022), so the result is only `TRANSIENT` or `PERMANENT` and the
 *   body is never read (D-006).
 */

export const PROVIDER_TIMEOUT_MS = 10_000;

/** D-006: `null` when accepted. */
export function classifyStatus(status: number): 'TRANSIENT' | 'PERMANENT' | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429 || status >= 500) return 'TRANSIENT';
  return 'PERMANENT';
}

/** A display name the address syntax would misread goes in quotes (RFC 5322). */
function mailbox(name: string, address: string): string {
  const display = /[",;:<>@()[\]\\]/.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}"` : name;
  return `${display} <${address}>`;
}

export function createResendNotifier(config: {
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
        response = await send(`${config.apiBaseUrl}/emails`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            from: mailbox(message.fromName, config.from),
            to: [message.to],
            ...(config.replyTo === null ? {} : { reply_to: config.replyTo }),
            subject: message.subject,
            html: message.html,
            text: message.text,
            headers: message.headers,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // A network error or the timeout. Its message is dropped too: an
        // undici error can quote the request.
        return err('TRANSIENT');
      }

      // The body is released unread whatever the status.
      await response.body?.cancel().catch(() => undefined);

      const failure = classifyStatus(response.status);
      return failure === null ? ok(undefined) : err(failure);
    },
  };
}
