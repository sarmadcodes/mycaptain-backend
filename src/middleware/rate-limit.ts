import { rateLimit, type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';

import { isTest } from '@/config/env';
import { redis } from '@/lib/kv';

function store(prefix: string): Options['store'] | undefined {
  if (!redis) return undefined; // in-memory store (single instance)
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis!.call(command, ...args) as Promise<RedisReply>,
  });
}

const base = {
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Slow down and try again shortly.' } }),
};

// Whole API, per IP.
export const apiLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 300, store: store('api') });

// Sign-in, OTP and applications, per IP.
export const authLimiter = rateLimit({ ...base, windowMs: 10 * 60_000, limit: 30, store: store('auth') });
