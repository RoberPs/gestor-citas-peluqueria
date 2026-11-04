import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messages } from '@/messages/es-ES';

/**
 * 004, T016: every text of contracts/ui-and-email.md is the one the catalogue
 * holds. The contract is read, not copied, so a copy-edit on either side
 * without the other turns this red.
 */

const contract = readFileSync('specs/004-notifications/contracts/ui-and-email.md', 'utf8')
  // The contract marks the words that go in bold and wraps its lines; the
  // comparison is on the words.
  .replaceAll('**', '')
  .replace(/\s+/g, ' ');

const SALON = '{salón}';

const texts: ReadonlyArray<readonly [string, string]> = [
  ['the checkbox label', messages.booking.emailConsentLabel],
  ['the checkbox help', messages.booking.emailConsentHint],
  [
    'the confirmation screen with consent',
    `${messages.confirmation.emailSentLead} {email}. ${messages.confirmation.emailSentRest}`,
  ],
  ['the appointment section', messages.appointment.emailNotifications.active],
  ['its button', messages.appointment.emailNotifications.stop],
  ['what it says once done', messages.appointment.emailNotifications.stopped],
  ['the unsubscribe page title', messages.unsubscribe.initial.title],
  [
    'its text',
    `${messages.unsubscribe.initial.bodyLead} ${SALON} ${messages.unsubscribe.initial.bodyRest}`,
  ],
  ['its button', messages.unsubscribe.initial.submit],
  ['the title once done', messages.unsubscribe.done.title],
  ['the text once done', messages.unsubscribe.done.body],
  ['the title when already done', messages.unsubscribe.already.title],
  ['the text when already done', messages.unsubscribe.already.body],
  ["the owner's mark", messages.owner.confirmationEmailFailed.label],
  ["the owner's hint", messages.owner.confirmationEmailFailed.hint],
  ['the greeting', messages.email.greeting('{nombre}')],
  ['the confirmation line', messages.email.confirmed(SALON)],
  ['the management link', messages.email.manageLink],
  ['the deadline note', messages.email.deadline(Number.NaN).replace('NaN', '{N}')],
  ['the footer', messages.email.footer],
  ['the unsubscribe link', messages.email.unsubscribeLink],
  ['the subject', messages.email.subject(SALON, '{día corto}', '{hora}')],
];

describe('the texts of contracts/ui-and-email.md', () => {
  it.each(texts)('%s is the one in the contract', (_what, text) => {
    expect(contract).toContain(text);
  });

  it('writes the time of an email in words, as the contract does', () => {
    expect(contract).toContain(messages.email.when('viernes 14 de noviembre', '11:30', '12:30'));
  });

  it('marks a failed confirmation with an icon as well as words', () => {
    expect(contract).toContain(`Icono ${messages.owner.confirmationEmailFailed.icon}`);
  });
});
