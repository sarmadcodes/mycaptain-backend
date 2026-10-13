import { env, isProd } from '@/config/env';

import { logger } from './logger';

export interface SmsProvider {
  send(to: string, text: string): Promise<void>;
}

// Development provider: prints the message. Blocked in production by env validation.
const consoleProvider: SmsProvider = {
  async send(to, text) {
    if (isProd) throw new Error('Console SMS used in production');
    logger.info({ to }, `[sms] ${text}`);
  },
};

// TODO(phase 3): real provider (e.g. local SMS gateway) selected by SMS_PROVIDER.
export const sms: SmsProvider = env.SMS_PROVIDER === 'console' ? consoleProvider : consoleProvider;
