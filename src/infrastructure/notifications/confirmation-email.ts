import type { ConfirmationEmailRenderer } from '@/application/ports';
import type { PriceTotal } from '@/domain/catalog/selection';
import type { ConfirmationContent } from '@/domain/notifications/confirmation-content';
import { messages } from '@/messages/es-ES';
import { managementLink, oneClickUnsubscribeLink, unsubscribeLink } from '../config/env';

/**
 * The confirmation email, written out (004, contracts/ui-and-email.md).
 *
 * The domain decided what it says; this only puts it into words, from the
 * message catalogue, twice: HTML and plain text with the same content
 * (FR-025). No image, no tracking, nothing commercial (FR-007).
 */

export type ConfirmationLinks = {
  readonly management: string;
  readonly unsubscribePage: string;
  /** The `List-Unsubscribe` target, for the mail client's own button (RFC 8058). */
  readonly unsubscribeOneClick: string;
};

export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
};

const { common, email: copy } = messages;

function priceLabel(cents: number | null): string {
  if (cents === null) return common.priceOnRequest;
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

function totalLabel(total: PriceTotal): string {
  switch (total.kind) {
    case 'ALL_PRICED':
      return priceLabel(total.cents);
    case 'NONE_PRICED':
      return common.priceOnRequest;
    case 'PARTIALLY_PRICED':
      return `${priceLabel(total.knownCents)} ${common.partialPriceSuffix}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderConfirmationEmail(content: ConfirmationContent, links: ConfirmationLinks): RenderedEmail {
  const month = content.date.month - 1;
  const longDate = `${common.weekdayLong[content.weekday - 1] ?? ''} ${content.date.day} de ${common.monthLong[month] ?? ''}`;
  const shortDate = `${common.weekdayShort[content.weekday - 1] ?? ''} ${content.date.day} ${common.monthShort[month] ?? ''}`;
  const { salon } = content;

  const when = copy.when(longDate, content.startTime, content.endTime);
  const services = content.services.map((service) => `${service.name}: ${priceLabel(service.priceCents)}`);
  const total = `${copy.totalLabel}: ${totalLabel(content.total)}`;
  const deadline = copy.deadline(content.cancellationDeadlineHours);
  const subject = copy.subject(salon.name, shortDate, content.startTime);

  const text = [
    copy.greeting(content.customerName),
    '',
    copy.confirmed(salon.name),
    '',
    copy.whenTitle,
    when,
    '',
    copy.servicesTitle,
    ...services.map((line) => `- ${line}`),
    total,
    '',
    copy.whereTitle,
    salon.address,
    `${copy.salonPhoneLabel}: ${salon.phone}`,
    '',
    copy.appointmentTitle,
    `${copy.manageLink}: ${links.management}`,
    '',
    deadline,
    '',
    '--',
    copy.footer,
    `${copy.unsubscribeLink}: ${links.unsubscribePage}`,
    '',
  ].join('\n');

  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:24px 16px;background:#ffffff;color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<p>${e(copy.greeting(content.customerName))}</p>
<h1 style="font-size:22px;margin:0 0 16px">${e(copy.confirmed(salon.name))}</h1>
<h2 style="font-size:18px;margin:24px 0 4px">${e(copy.whenTitle)}</h2>
<p style="margin:0">${e(when)}</p>
<h2 style="font-size:18px;margin:24px 0 4px">${e(copy.servicesTitle)}</h2>
<ul style="margin:0;padding-left:20px">
${services.map((line) => `<li>${e(line)}</li>`).join('\n')}
</ul>
<p style="margin:8px 0 0"><strong>${e(total)}</strong></p>
<h2 style="font-size:18px;margin:24px 0 4px">${e(copy.whereTitle)}</h2>
<p style="margin:0">${e(salon.address)}<br>${e(copy.salonPhoneLabel)}: ${e(salon.phone)}</p>
<h2 style="font-size:18px;margin:24px 0 4px">${e(copy.appointmentTitle)}</h2>
<p style="margin:0"><a href="${e(links.management)}">${e(copy.manageLink)}</a></p>
<p style="margin:4px 0 0;word-break:break-all;color:#333333">${e(links.management)}</p>
<p style="margin:16px 0 0">${e(deadline)}</p>
<hr style="border:0;border-top:1px solid #cccccc;margin:32px 0 16px">
<p style="margin:0;font-size:14px;color:#333333">${e(copy.footer)} <a href="${e(links.unsubscribePage)}">${e(copy.unsubscribeLink)}</a></p>
</body>
</html>
`;

  return {
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${links.unsubscribeOneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/** The renderer the dispatch is given: the links are built from `PUBLIC_BASE_URL`. */
export const confirmationEmailRenderer: ConfirmationEmailRenderer = (content, tokens) =>
  renderConfirmationEmail(content, {
    management: managementLink(tokens.management),
    unsubscribePage: unsubscribeLink(tokens.unsubscribe),
    unsubscribeOneClick: oneClickUnsubscribeLink(tokens.unsubscribe),
  });
