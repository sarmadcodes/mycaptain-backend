import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { MulterError } from 'multer';

import { isProd } from '@/config/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found.' } });
}

// Single place that turns any thrown error into a safe JSON response.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status === 429 && (err.details as { retryAfter?: number })?.retryAfter) {
      res.setHeader('Retry-After', String((err.details as { retryAfter: number }).retryAfter));
    }
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large. The limit is 10 MB.' : 'Upload failed.';
    return res.status(400).json({ error: { code: 'upload_invalid', message } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const fields = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return res.status(400).json({ error: { code: 'bad_request', message: fields[0]?.message ?? 'Invalid data.', details: { fields } } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'bad_request', message: `Invalid ${err.path}.` } });
  }
  // Duplicate key (unique index).
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    const key = Object.keys((err as { keyValue?: object }).keyValue ?? {})[0] ?? 'value';
    return res.status(409).json({ error: { code: 'conflict', message: `This ${key} is already registered.` } });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body.' } });
  }

  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({
    error: { code: 'internal', message: 'Something went wrong. Please try again.', ...(isProd ? {} : { details: String(err) }) },
  });
}
