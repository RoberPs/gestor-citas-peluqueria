import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import type { ConfirmationContent } from '@/domain/notifications/confirmation-content';
import { renderConfirmationEmail } from '@/infrastructure/notifications/confirmation-email';

/**
 * 004, T015: the email as contracts/ui-and-email.md writes it. Its sections in
 * order, dates in words, both parts with the same content, no images, no
 * tracking, and nothing of the client but the name (FR-006, FR-007, FR-025).
 */

const CONTENT: ConfirmationContent = {
  salon: { name: 'Peluquería de Caballeros Niza', address: 'Calle Niza 12, Madrid', phone: '910 11 22 33' },
  customerName: 'Ana López',
  date: Temporal.PlainDate.from('2026-11-13'),
  weekday: 5,
  startTime: '11:30',
  endTime: '12:30',
  services: [
    { name: 'Corte', priceCents: 1800 },
    { name: 'Barba', priceCents: null },
  ],
  total: { kind: 'PARTIALLY_PRICED', knownCents: 1800 },
  cancellationDeadlineHours: 24,
};

const LINKS = {
  management: 'https://salon.example/cita/MANAGEMENT_TOKEN_0000000000000000000000000',
  unsubscribePage: 'https://salon.example/baja/UNSUBSCRIBE_TOKEN_000000000000000000000000',
  unsubscribeOneClick: 'https://salon.example/api/unsubscribe/UNSUBSCRIBE_TOKEN_000000000000000000000000',
};

const email = renderConfirmationEmail(CONTENT, LINKS);

function indexesIn(text: string, parts: readonly string[]): number[] {
  return parts.map((part) => text.indexOf(part));
}

describe('the subject', () => {
  it('names the salon, the short day and the hour', () => {
    expect(email.subject).toBe('Tu cita en Peluquería de Caballeros Niza: vie 13 nov, 11:30');
  });
});

describe('the headers', () => {
  it('offers the one-click unsubscribe of RFC 8058', () => {
    expect(email.headers).toEqual({
      'List-Unsubscribe': `<${LINKS.unsubscribeOneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});

describe.each([
  ['the plain text part', email.text],
  ['the HTML part', email.html],
])('%s', (_part, body) => {
  it('has the sections in the order of FR-006', () => {
    const positions = indexesIn(body, [
      'Hola, Ana López:',
      'Tu cita en Peluquería de Caballeros Niza está confirmada.',
      'viernes 13 de noviembre, de 11:30 a 12:30',
      'Corte',
      'Calle Niza 12, Madrid',
      '910 11 22 33',
      LINKS.management,
      'Puedes cambiarla o cancelarla hasta 24 horas antes.',
      'Recibes este email porque lo pediste al reservar.',
      LINKS.unsubscribePage,
    ]);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('gives each price, or says there is none, and the total by the rule of 005', () => {
    expect(body).toContain('18,00 €');
    expect(body).toContain('Precio a consultar en el salón');
    expect(body).toContain('18,00 € + precio a consultar en el salón');
  });

  it('says the link always shows what is current', () => {
    expect(body).toContain('Lo que veas en este enlace es siempre lo vigente, aunque cambie después de este email.');
  });

  it('never carries the phone or the email of the client', () => {
    expect(body).not.toContain('600112233');
    expect(body).not.toContain('ana@example.com');
  });
});

describe('the HTML part', () => {
  it('is Spanish, with no image and no tracking', () => {
    expect(email.html).toContain('<html lang="es">');
    expect(email.html).not.toMatch(/<img/i);
    expect(email.html).not.toMatch(/utm_|[?&]track/i);
  });

  it('gives every link a text that says where it goes', () => {
    expect(email.html).toContain(`<a href="${LINKS.management}">Ver, cambiar o cancelar tu cita</a>`);
    expect(email.html).toContain(`<a href="${LINKS.unsubscribePage}">Darme de baja</a>`);
  });

  it('shows the full management link in text under its button', () => {
    expect(email.html.split(LINKS.management).length - 1).toBe(2);
  });

  it('has a heading and a list of services', () => {
    expect(email.html).toMatch(/<h1[^>]*>/);
    expect(email.html).toMatch(/<ul[^>]*>[\s\S]*Corte[\s\S]*<\/ul>/);
  });

  it('escapes what comes from the database', () => {
    const escaped = renderConfirmationEmail({ ...CONTENT, customerName: '<b>Ana</b> & Co' }, LINKS);
    expect(escaped.html).toContain('&lt;b&gt;Ana&lt;/b&gt; &amp; Co');
    expect(escaped.html).not.toContain('<b>Ana</b>');
  });
});

describe('the total', () => {
  it('is the sum when every service has a price', () => {
    const all = renderConfirmationEmail({ ...CONTENT, total: { kind: 'ALL_PRICED', cents: 2600 } }, LINKS);
    expect(all.text).toContain('26,00 €');
  });

  it('is on request when none has one', () => {
    const none = renderConfirmationEmail({ ...CONTENT, total: { kind: 'NONE_PRICED' } }, LINKS);
    expect(none.text).toMatch(/Total: Precio a consultar en el salón/);
  });
});
