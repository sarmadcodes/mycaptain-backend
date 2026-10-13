import { createHash, randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '@/config/env';
import type { Role } from '@/models/user';

import { unauthorized } from './errors';
import { kv } from './kv';

export type AccessClaims = { sub: string; role: Role; company?: string; tv: number };

export function signAccess(claims: AccessClaims) {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'my-captain',
    audience: 'my-captain-api',
    algorithm: 'HS256',
  });
}

export function verifyAccess(token: string): AccessClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'my-captain',
      audience: 'my-captain-api',
      algorithms: ['HS256'],
    }) as AccessClaims;
  } catch {
    throw unauthorized('Your session has expired. Sign in again.');
  }
}

const hash = (t: string) => createHash('sha256').update(env.JWT_REFRESH_SECRET).update(t).digest('hex');
const refreshTtl = () => env.REFRESH_TOKEN_DAYS * 24 * 3600;

// Opaque refresh tokens, stored hashed. Each use rotates the token (old one is deleted).
export async function issueRefresh(userId: string) {
  const token = randomBytes(48).toString('base64url');
  await kv.set(`rt:${hash(token)}`, userId, refreshTtl());
  return token;
}

export async function consumeRefresh(token: string) {
  const key = `rt:${hash(token)}`;
  const userId = await kv.get(key);
  if (!userId) throw unauthorized('Your session has expired. Sign in again.');
  await kv.del(key);
  return userId;
}

export async function revokeRefresh(token: string) {
  await kv.del(`rt:${hash(token)}`);
}
