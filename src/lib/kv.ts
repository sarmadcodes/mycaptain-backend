import { Redis } from 'ioredis';

import { env } from '@/config/env';

import { logger } from './logger';

// Small key-value interface used for OTPs, refresh tokens and throttles.
// Redis in production; an in-process store when REDIS_URL is not set (development and tests).
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  // Increments and returns the new value; sets the TTL when the key is created.
  incr(key: string, ttlSec: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

class RedisKv implements Kv {
  constructor(private r: Redis) {}
  async get(key: string) {
    return this.r.get(key);
  }
  async set(key: string, value: string, ttlSec: number) {
    await this.r.set(key, value, 'EX', ttlSec);
  }
  async del(key: string) {
    await this.r.del(key);
  }
  async incr(key: string, ttlSec: number) {
    const [[, n]] = (await this.r.multi().incr(key).expire(key, ttlSec, 'NX').exec()) as [[Error | null, number]];
    return n;
  }
  async ttl(key: string) {
    return this.r.ttl(key);
  }
}

export class MemoryKv implements Kv {
  private m = new Map<string, { v: string; exp: number }>();
  private live(key: string) {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp <= Date.now()) {
      this.m.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key: string) {
    return this.live(key)?.v ?? null;
  }
  async set(key: string, value: string, ttlSec: number) {
    this.m.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
  }
  async del(key: string) {
    this.m.delete(key);
  }
  async incr(key: string, ttlSec: number) {
    const e = this.live(key);
    const n = (e ? Number(e.v) : 0) + 1;
    this.m.set(key, { v: String(n), exp: e?.exp ?? Date.now() + ttlSec * 1000 });
    return n;
  }
  async ttl(key: string) {
    const e = this.live(key);
    return e ? Math.ceil((e.exp - Date.now()) / 1000) : -2;
  }
  clear() {
    this.m.clear();
  }
}

export const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true }) : undefined;

if (redis) {
  redis.on('error', (err) => logger.error({ err }, 'redis error'));
} else {
  logger.warn('REDIS_URL not set: using in-memory store (single instance only)');
}

export const kv: Kv = redis ? new RedisKv(redis) : new MemoryKv();
