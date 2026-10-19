import { Router } from 'express';
import type { RouteDeps } from './countries.js';

export function healthRouter(deps: RouteDeps): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    const now = Date.now();
    res.json({
      status: deps.snapshot.ready ? 'ok' : 'degraded',
      countries: deps.snapshot.count,
      cache: {
        fetchedAt:
          deps.snapshot.fetchedAtMs === null ? null : new Date(deps.snapshot.fetchedAtMs).toISOString(),
        stale: deps.snapshot.isStale(now, deps.config.REFRESH_TTL_MS),
      },
    });
  });
  return router;
}
