import type { NextFunction, Request, Response } from 'express';
import type { z, ZodType } from 'zod';

import { badRequest } from '@/lib/errors';

// Parses input with a zod schema, throwing a 400 with field details. Unknown keys are stripped.
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(fields[0]?.message ?? 'Invalid request.', { fields });
  }
  return result.data;
}

// Body validation as middleware; req.body is replaced with the parsed value.
export const body =
  (schema: ZodType) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = parse(schema, req.body);
      next();
    } catch (e) {
      next(e);
    }
  };
