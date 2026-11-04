import { resetEnvCache } from '@/infrastructure/config/env';
import {
  FAKE_EMAIL_API_KEY,
  startFakeEmailProvider,
  type FakeEmailProvider,
} from '../../support/fake-email-provider';

/**
 * The fake email provider for one integration or contract file (004, D-013).
 *
 * It listens on a free port and switches the email channel on for that file
 * only, by setting the variables before `env()` is read again. The seal key is
 * a fixed test value; it is no secret.
 */

export const TEST_SEAL_KEY = 'aW50ZWdyYXRpb24tc2VhbC1rZXktMzItYnl0ZXMhISE=';
export const TEST_EMAIL_FROM = 'citas@example.test';

const VARIABLES = [
  'NOTIFICATIONS_EMAIL',
  'EMAIL_API_BASE_URL',
  'EMAIL_API_KEY',
  'EMAIL_FROM',
  'EMAIL_REPLY_TO',
  'NOTIFICATION_SEAL_KEY',
] as const;

export async function useFakeEmailProvider(
  options: { readonly replyTo?: string } = {},
): Promise<FakeEmailProvider & { readonly restore: () => Promise<void> }> {
  const provider = await startFakeEmailProvider();
  const previous = new Map(VARIABLES.map((name) => [name, process.env[name]]));

  process.env['NOTIFICATIONS_EMAIL'] = 'on';
  process.env['EMAIL_API_BASE_URL'] = provider.url;
  process.env['EMAIL_API_KEY'] = FAKE_EMAIL_API_KEY;
  process.env['EMAIL_FROM'] = TEST_EMAIL_FROM;
  process.env['NOTIFICATION_SEAL_KEY'] = TEST_SEAL_KEY;
  if (options.replyTo === undefined) delete process.env['EMAIL_REPLY_TO'];
  else process.env['EMAIL_REPLY_TO'] = options.replyTo;
  resetEnvCache();

  return {
    ...provider,
    restore: async () => {
      await provider.close();
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      resetEnvCache();
    },
  };
}
