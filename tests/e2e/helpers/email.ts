import type { FakeEmailMode, ReceivedEmail } from '../../support/fake-email-provider';

/**
 * The fake email provider as the e2e tests see it (004, D-013): over HTTP,
 * because it runs in the runner's process and each test in a worker.
 */

export const E2E_EMAIL_PORT = Number(process.env['E2E_EMAIL_PORT'] ?? 4011);

const BASE = `http://127.0.0.1:${E2E_EMAIL_PORT}`;

export async function readMessages(): Promise<readonly ReceivedEmail[]> {
  const response = await fetch(`${BASE}/__messages`);
  return (await response.json()) as ReceivedEmail[];
}

export async function clearMessages(): Promise<void> {
  await fetch(`${BASE}/__messages`, { method: 'DELETE' });
}

export async function setMode(mode: FakeEmailMode): Promise<void> {
  await fetch(`${BASE}/__mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

/** The emails sent to that address, in the order they arrived. */
export async function messagesTo(address: string): Promise<readonly ReceivedEmail[]> {
  return (await readMessages()).filter((message) => {
    const to = message.body.to;
    return Array.isArray(to) ? to.includes(address) : to === address;
  });
}

/** The management and unsubscribe links of an email, read from its HTML. */
export function linksIn(message: ReceivedEmail): { readonly management: string; readonly unsubscribe: string } {
  const hrefs = [...(message.body.html ?? '').matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? '');
  const management = hrefs.find((href) => href.includes('/cita/'));
  const unsubscribe = hrefs.find((href) => href.includes('/baja/'));
  if (management === undefined || unsubscribe === undefined) {
    throw new Error('the email does not carry both of its links');
  }
  return { management, unsubscribe };
}
