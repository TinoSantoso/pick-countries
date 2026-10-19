import { Router, type RequestHandler } from 'express';
import type { SnapshotStore } from '../../cache/snapshot.js';
import type { Config } from '../../config.js';
import { applyQuery, type ListQuery } from '../../query/filter.js';
import { HttpError } from '../middleware/errorHandler.js';
import { listQuerySchema, validateQuery } from '../schemas.js';

export type RouteDeps = { snapshot: SnapshotStore; config: Config };

export function countriesRouter(deps: RouteDeps): Router {
  const router = Router();

  const requireSnapshot: RequestHandler = (_req, _res, next) => {
    if (!deps.snapshot.ready) {
      next(new HttpError(503, 'SNAPSHOT_UNAVAILABLE', 'Country data is still loading; try again shortly'));
      return;
    }
    next();
  };

  router.get('/', requireSnapshot, validateQuery(listQuerySchema), (req, res) => {
    const query = res.locals.query as ListQuery;
    const page = applyQuery(deps.snapshot.all, query);
    const now = Date.now();
    res.json({
      data: {
        objects: page.objects,
        meta: {
          ...page.meta,
          cache: {
            fetchedAt: new Date(deps.snapshot.fetchedAtMs ?? now).toISOString(),
            stale: deps.snapshot.isStale(now, deps.config.REFRESH_TTL_MS),
          },
        },
      },
    });
  });

  router.get('/:code', requireSnapshot, (req, res) => {
    const code = String(req.params['code'] ?? '');
    if (!/^[a-zA-Z]{2,3}$/.test(code)) {
      throw new HttpError(400, 'INVALID_CODE', 'Country code must be 2-3 letters (alpha-2, alpha-3, or CIOC)');
    }
    const country = deps.snapshot.getByCode(code);
    if (country === undefined) {
      throw new HttpError(404, 'NOT_FOUND', `No country with code ${code.toUpperCase()}`);
    }
    res.json({ data: { objects: [country] } });
  });

  return router;
}
