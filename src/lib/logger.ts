import { pino } from 'pino';

import { env, isProd, isTest } from '@/config/env';

export const logger = pino({
  level: isTest ? 'silent' : isProd ? 'info' : 'debug',
  // Never log credentials or tokens.
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.code', '*.refreshToken', '*.token'],
    censor: '[redacted]',
  },
  transport: !isProd && !isTest ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined,
  base: { env: env.NODE_ENV },
});
