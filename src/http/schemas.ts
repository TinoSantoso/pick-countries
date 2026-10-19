import { z } from 'zod';
import type { RequestHandler } from 'express';

const commaList = z
  .string()
  .transform((s) => s.split(',').map((p) => p.trim()).filter((p) => p.length > 0));

export const listQuerySchema = z.object({
  q: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  subregion: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  fields: commaList.optional(),
  fields_omit: commaList.optional(),
});

/** Parses req.query with the given schema; on failure forwards the ZodError to the error handler. */
export function validateQuery<T extends z.ZodType>(schema: T): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.locals.query = result.data;
    next();
  };
}
