import type { Notifier, TokenSealer } from '@/application/ports';
import { env, type EmailChannelConfig } from '../config/env';
import { createTokenSealer } from '../security/token-sealer';
import { createResendNotifier } from './resend-notifier';

/**
 * The sealer and the notifier of the email channel, configured from the
 * environment at the moment they are used (004, D-005). The use cases only
 * reach them with the channel on; reaching them with it off is a wiring error.
 */

function emailChannel(): EmailChannelConfig {
  const email = env().notifications.email;
  if (email === null) throw new Error('The email channel is off: NOTIFICATIONS_EMAIL=off');
  return email;
}

export const emailTokenSealer: TokenSealer = {
  seal: (tokens) => createTokenSealer(emailChannel().sealKey).seal(tokens),
  open: (sealed) => createTokenSealer(emailChannel().sealKey).open(sealed),
};

export const emailNotifier: Notifier = {
  send: (message, idempotencyKey) => createResendNotifier(emailChannel()).send(message, idempotencyKey),
};
