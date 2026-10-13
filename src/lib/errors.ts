// Errors thrown anywhere in a request become a consistent JSON response:
// { error: { code, message, details? } }
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this.') => new AppError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found.`);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const tooMany = (message: string, retryAfterSec?: number) =>
  new AppError(429, 'rate_limited', message, retryAfterSec ? { retryAfter: retryAfterSec } : undefined);
