import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../../types.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorHandler(
  log: Logger,
): (err: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      const body: ApiErrorBody = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: err.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
        },
      };
      res.status(400).json(body);
      return;
    }
    if (err instanceof HttpError) {
      const body: ApiErrorBody = {
        error: { code: err.code, message: err.message, details: err.details as ApiErrorBody['error']['details'] },
      };
      res.status(err.status).json(body);
      return;
    }
    log.error({ err, reqId: (req as { id?: unknown }).id }, 'Unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } satisfies ApiErrorBody);
  };
}
