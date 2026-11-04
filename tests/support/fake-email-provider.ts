import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for Resend's `POST /emails` (004, D-013).
 *
 * The real adapter is pointed at it with `EMAIL_API_BASE_URL`, so what the
 * integration, contract and e2e suites exercise is the adapter that runs in
 * production, not a mock of it. Everything it receives stays in memory and is
 * read back through `GET /__messages`.
 *
 * `GET /` is an inbox for a person: each email rendered as the client would
 * see it, with its plain text part beside it, newest first.
 *
 * Modes, switched with `POST /__mode {"mode": …}`:
 * - `ok`: `200 {id}`; a repeated `Idempotency-Key` gets the same id and is
 *   stored once, as Resend does.
 * - `fail`: `503`, a transient failure.
 * - `reject`: `422`, a permanent one.
 * - `hang`: never answers, so the caller's timeout is what ends the request.
 * - `echo`: `422` with a body that repeats the recipient, the way a real
 *   provider's validation error can (D-006).
 */

export type FakeEmailMode = 'ok' | 'fail' | 'reject' | 'hang' | 'echo';

export const FAKE_EMAIL_MODES: readonly FakeEmailMode[] = ['ok', 'fail', 'reject', 'hang', 'echo'];

export type ReceivedEmail = {
  readonly id: string;
  readonly idempotencyKey: string | null;
  readonly authorization: string | null;
  /** Epoch milliseconds at which the request arrived. */
  readonly receivedAt: number;
  readonly body: {
    readonly from?: string;
    readonly to?: string | readonly string[];
    readonly reply_to?: string;
    readonly subject?: string;
    readonly html?: string;
    readonly text?: string;
    readonly headers?: Readonly<Record<string, string>>;
  };
};

export type FakeEmailProvider = {
  readonly url: string;
  readonly port: number;
  readonly messages: () => readonly ReceivedEmail[];
  readonly clear: () => void;
  readonly setMode: (mode: FakeEmailMode) => void;
  /** Called with each message the provider accepts, after it is stored. */
  readonly onAccepted: (listener: (message: ReceivedEmail) => void) => void;
  readonly close: () => Promise<void>;
};

export const FAKE_EMAIL_API_KEY = 'fake-email-api-key';

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function recipients(to: ReceivedEmail['body']['to']): string {
  return typeof to === 'string' ? to : (to ?? []).join(', ');
}

/** The inbox page: every email rendered in a sandboxed frame, newest first. */
function inboxPage(messages: readonly ReceivedEmail[], mode: FakeEmailMode): string {
  const cards = [...messages]
    .reverse()
    .map((message) => {
      const { body } = message;
      const headers = Object.entries(body.headers ?? {})
        .map(([name, value]) => `<li><code>${escapeHtml(name)}: ${escapeHtml(value)}</code></li>`)
        .join('');
      return `<article>
  <h2>${escapeHtml(body.subject ?? '(sin asunto)')}</h2>
  <dl>
    <dt>Para</dt><dd>${escapeHtml(recipients(body.to))}</dd>
    <dt>De</dt><dd>${escapeHtml(body.from ?? '')}</dd>
    ${body.reply_to === undefined ? '' : `<dt>Responder a</dt><dd>${escapeHtml(body.reply_to)}</dd>`}
    <dt>Recibido</dt><dd>${new Date(message.receivedAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</dd>
    <dt>Id del envío</dt><dd><code>${escapeHtml(message.idempotencyKey ?? '')}</code></dd>
  </dl>
  <div class="parts">
    <section><h3>Como lo ve el cliente (HTML)</h3>
      <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${escapeHtml(body.html ?? '')}" title="${escapeHtml(body.subject ?? 'email')}"></iframe>
    </section>
    <section><h3>Versión de sólo texto</h3><pre>${escapeHtml(body.text ?? '')}</pre></section>
  </div>
  <details><summary>Cabeceras</summary><ul>${headers}</ul></details>
</article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bandeja del proveedor falso (${messages.length})</title>
<style>
  body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #f3f3f3; color: #1a1a1a; }
  header { display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: baseline; }
  article { background: #fff; border: 1px solid #ccc; border-radius: 8px; padding: 16px; margin: 16px 0; }
  h2 { margin: 0 0 8px; font-size: 1.15rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 12px; }
  dt { font-weight: 600; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .parts { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  h3 { font-size: 0.95rem; margin: 0 0 6px; }
  iframe { width: 100%; height: 640px; border: 1px solid #ccc; border-radius: 4px; background: #fff; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: 12px; background: #fafafa; border: 1px solid #ccc; border-radius: 4px; max-height: 640px; overflow: auto; }
</style>
</head>
<body>
<header>
  <h1>Bandeja del proveedor falso</h1>
  <p>${messages.length} email(s) · modo <strong>${mode}</strong> · <a href="/">Recargar</a> · <a href="/__messages">JSON</a></p>
</header>
${messages.length === 0 ? '<p>Todavía no ha llegado ningún email. Reserva marcando la casilla y recarga.</p>' : cards}
</body>
</html>`;
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
}

export async function startFakeEmailProvider(
  options: { readonly port?: number; readonly mode?: FakeEmailMode; readonly apiKey?: string } = {},
): Promise<FakeEmailProvider> {
  const apiKey = options.apiKey ?? FAKE_EMAIL_API_KEY;
  let mode: FakeEmailMode = options.mode ?? 'ok';
  const received: ReceivedEmail[] = [];
  const byKey = new Map<string, string>();
  const listeners: Array<(message: ReceivedEmail) => void> = [];
  const hanging = new Set<ServerResponse>();

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://fake').pathname;

    if (path === '/' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(inboxPage(received, mode));
      return;
    }
    if (path === '/__messages' && request.method === 'GET') return json(response, 200, received);
    if (path === '/__messages' && request.method === 'DELETE') {
      received.length = 0;
      byKey.clear();
      response.writeHead(204).end();
      return;
    }
    if (path === '/__mode' && request.method === 'POST') {
      const requested = (JSON.parse(await readBody(request)) as { mode?: unknown }).mode;
      if (!FAKE_EMAIL_MODES.includes(requested as FakeEmailMode)) return json(response, 400, { error: 'mode' });
      mode = requested as FakeEmailMode;
      response.writeHead(204).end();
      return;
    }
    if (path !== '/emails' || request.method !== 'POST') return json(response, 404, { name: 'not_found' });

    const receivedAt = Date.now();
    const text = await readBody(request);
    const authorization = header(request, 'authorization');
    if (authorization !== `Bearer ${apiKey}`) {
      return json(response, 401, { name: 'missing_api_key', message: 'Missing API key' });
    }

    const body = JSON.parse(text) as ReceivedEmail['body'];

    switch (mode) {
      case 'fail':
        return json(response, 503, { name: 'internal_server_error', message: 'Unavailable' });
      case 'reject':
        return json(response, 422, { name: 'validation_error', message: 'Invalid recipient' });
      case 'echo':
        return json(response, 422, {
          name: 'validation_error',
          message: `Invalid \`to\` field: ${JSON.stringify(body.to)}`,
        });
      case 'hang':
        hanging.add(response);
        response.on('close', () => hanging.delete(response));
        return;
      case 'ok':
        break;
    }

    const idempotencyKey = header(request, 'idempotency-key');
    const known = idempotencyKey === null ? undefined : byKey.get(idempotencyKey);
    if (known !== undefined) return json(response, 200, { id: known });

    const message: ReceivedEmail = {
      id: randomUUID(),
      idempotencyKey,
      authorization,
      receivedAt,
      body,
    };
    received.push(message);
    if (idempotencyKey !== null) byKey.set(idempotencyKey, message.id);
    for (const listener of listeners) listener(message);

    json(response, 200, { id: message.id });
  }

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) json(response, 400, { name: 'bad_request' });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    messages: () => [...received],
    clear: () => {
      received.length = 0;
      byKey.clear();
    },
    setMode: (next) => {
      mode = next;
    },
    onAccepted: (listener) => {
      listeners.push(listener);
    },
    close: async () => {
      for (const response of hanging) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
