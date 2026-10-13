import type { NextFunction, Request, Response } from 'express';

import { forbidden, unauthorized } from '@/lib/errors';
import { verifyAccess } from '@/lib/tokens';
import { UserModel, type Role } from '@/models/user';

export type AuthUser = { id: string; role: Role; company?: string };

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

// Verifies the bearer token and that the account is still active and the token not revoked.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  const claims = verifyAccess(header.slice(7));
  const user = await UserModel.findById(claims.sub).select('role status tokenVersion company').lean();
  if (!user || user.status !== 'active' || user.tokenVersion !== claims.tv) {
    return next(unauthorized('Your session has ended. Sign in again.'));
  }
  req.user = { id: String(user._id), role: user.role, company: user.company ? String(user.company) : undefined };
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export function me(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
