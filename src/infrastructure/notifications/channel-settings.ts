import type { ChannelSettings } from '@/application/ports';
import type { Channel } from '@/domain/notifications/consent';
import { env } from '../config/env';

/**
 * Which channels are on, from the environment (004, D-005). Read on every call,
 * so a test that switches the email on for one file sees it at once.
 */
export function createChannelSettings(): ChannelSettings {
  return {
    enabledChannels() {
      const channels = new Set<Channel>();
      if (env().notifications.email !== null) channels.add('EMAIL');
      return channels;
    },
  };
}
