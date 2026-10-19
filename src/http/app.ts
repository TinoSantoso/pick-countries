import express, { type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { SnapshotStore } from '../cache/snapshot.js';
import type { Config } from '../config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { countriesRouter } from './routes/countries.js';
import { healthRouter } from './routes/health.js';

export type AppDeps = { snapshot: SnapshotStore; config: Config; log: Logger };

export function buildApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    pinoHttp({
      logger: deps.log,
      genReqId: () => randomUUID(),
      redact: { paths: ['req.headers.authorization'] },
    }),
  );  app.use('/health', healthRouter(deps));
  app.use('/api/v1/countries', countriesRouter(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown route' } });
  });

  app.use(errorHandler(deps.log));
  return app;
}
