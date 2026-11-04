import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env, resetEnvCache, unsubscribeLink } from '@/infrastructure/config/env';
import { createChannelSettings } from '@/infrastructure/notifications/channel-settings';

/**
 * 004, D-005: the channels are switched on by environment. With the email on,
 * a missing piece stops the process naming it, instead of leaving the channel
 * quietly off.
 */

const BASE = {
  DATABASE_URL: 'postgres://localhost/test',
  RATE_LIMIT_SECRET: 'secret',
  PUBLIC_BASE_URL: 'https://salon.example',
};

const EMAIL_ON = {
  NOTIFICATIONS_EMAIL: 'on',
  EMAIL_API_KEY: 'key',
  EMAIL_FROM: 'citas@salon.example',
  NOTIFICATION_SEAL_KEY: randomBytes(32).toString('base64'),
};

const NAMES = [
  ...Object.keys(BASE),
  'NOTIFICATIONS_EMAIL',
  'NOTIFICATIONS_SMS',
  'EMAIL_API_KEY',
  'EMAIL_API_BASE_URL',
  'EMAIL_FROM',
  'EMAIL_REPLY_TO',
  'NOTIFICATION_SEAL_KEY',
];

let saved: Map<string, string | undefined>;

function setEnv(values: Record<string, string>): void {
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, values);
  resetEnvCache();
}

beforeEach(() => {
  saved = new Map(NAMES.map((name) => [name, process.env[name]]));
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvCache();
});

describe('the email channel', () => {
  it('needs nothing when it is off, and is off by default', () => {
    setEnv(BASE);
    expect(env().notifications.email).toBeNull();
    expect([...createChannelSettings().enabledChannels()]).toEqual([]);
  });

  it('reads its configuration when it is on', () => {
    setEnv({ ...BASE, ...EMAIL_ON, EMAIL_REPLY_TO: 'salon@salon.example' });
    expect(env().notifications.email).toEqual({
      apiKey: 'key',
      apiBaseUrl: 'https://api.resend.com',
      from: 'citas@salon.example',
      replyTo: 'salon@salon.example',
      sealKey: EMAIL_ON.NOTIFICATION_SEAL_KEY,
    });
    expect([...createChannelSettings().enabledChannels()]).toEqual(['EMAIL']);
  });

  it('takes another API base, without its trailing slash', () => {
    setEnv({ ...BASE, ...EMAIL_ON, EMAIL_API_BASE_URL: 'http://127.0.0.1:4010/' });
    expect(env().notifications.email?.apiBaseUrl).toBe('http://127.0.0.1:4010');
  });

  it('treats an empty reply-to as none', () => {
    setEnv({ ...BASE, ...EMAIL_ON, EMAIL_REPLY_TO: '' });
    expect(env().notifications.email?.replyTo).toBeNull();
  });

  it.each([['EMAIL_API_KEY'], ['EMAIL_FROM'], ['NOTIFICATION_SEAL_KEY']])(
    'refuses to start without %s, naming it',
    (missing) => {
      const values: Record<string, string> = { ...BASE, ...EMAIL_ON };
      delete values[missing];
      setEnv(values);
      expect(() => env()).toThrow(missing);
    },
  );

  it('refuses a seal key that is not 32 bytes of base64', () => {
    setEnv({ ...BASE, ...EMAIL_ON, NOTIFICATION_SEAL_KEY: randomBytes(16).toString('base64') });
    expect(() => env()).toThrow('NOTIFICATION_SEAL_KEY');
  });

  it('refuses a switch that is neither on nor off', () => {
    setEnv({ ...BASE, ...EMAIL_ON, NOTIFICATIONS_EMAIL: 'yes' });
    expect(() => env()).toThrow('NOTIFICATIONS_EMAIL');
  });
});

describe('the SMS channel', () => {
  it('only takes off in this feature: it has no adapter', () => {
    setEnv({ ...BASE, NOTIFICATIONS_SMS: 'on' });
    expect(() => env()).toThrow('NOTIFICATIONS_SMS');
  });

  it('accepts off', () => {
    setEnv({ ...BASE, NOTIFICATIONS_SMS: 'off' });
    expect([...createChannelSettings().enabledChannels()]).toEqual([]);
  });
});

describe('unsubscribeLink', () => {
  it('builds the absolute link of the unsubscribe page', () => {
    setEnv(BASE);
    expect(unsubscribeLink('abc')).toBe('https://salon.example/baja/abc');
  });
});
