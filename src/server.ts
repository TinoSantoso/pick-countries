import { pino } from 'pino';
import { SnapshotStore } from './cache/snapshot.js';
import { loadConfig, type Config } from './config.js';
import { buildApp } from './http/app.js';
import { createUpstreamClient } from './upstream/client.js';
import { startRefreshLoop } from './upstream/refresh.js';

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.error('Create a .env file (see .env.example) and set RESTCOUNTRIES_API_KEY.');
    process.exit(1);
  }
}

function main(): void {
  const config = loadConfigOrExit();
  const log = pino({ level: config.LOG_LEVEL });
  const snapshot = new SnapshotStore();
  const client = createUpstreamClient(config);
  const app = buildApp({ snapshot, config, log });

  const server = app.listen(config.PORT, () => {
    log.info({ port: config.PORT }, 'Countries API listening');
  });

  const loop = startRefreshLoop({
    client,
    log,
    ttlMs: config.REFRESH_TTL_MS,
    onRefresh: (countries) => snapshot.swap(countries, Date.now()),
  });

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Shutting down');
    loop.stop();
    server.close(() => process.exit(0));
    // Fallback in case open sockets keep the handle busy.
    setTimeout(() => process.exit(0), 5_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
