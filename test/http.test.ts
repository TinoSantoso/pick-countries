import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SnapshotStore } from '../src/cache/snapshot.js';
import { loadConfig, type Config } from '../src/config.js';
import { buildApp } from '../src/http/app.js';
import { makeCountry } from './fixtures.js';

const config: Config = { ...loadConfig({ RESTCOUNTRIES_API_KEY: 'k' }), REFRESH_TTL_MS: 60_000 };
const log = pino({ level: 'silent' });

const canada = makeCountry({ ...{ common: 'Canada', alpha2: 'CA', alpha3: 'CAN', cioc: 'CAN' }, region: 'Americas' });
const germany = makeCountry({ common: 'Germany', alpha2: 'DE', alpha3: 'DEU', region: 'Europe' });

function appWith(snapshot: SnapshotStore) {
  return buildApp({ snapshot, config, log });
}

function loadedSnapshot(): SnapshotStore {
  const snapshot = new SnapshotStore();
  snapshot.swap([canada, germany], Date.now());
  return snapshot;
}

describe('GET /api/v1/countries', () => {
  it('returns 503 until the first snapshot is loaded', async () => {
    const res = await request(appWith(new SnapshotStore())).get('/api/v1/countries');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SNAPSHOT_UNAVAILABLE');
  });

  it('lists countries with cache meta once loaded', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/api/v1/countries');
    expect(res.status).toBe(200);
    expect(res.body.data.objects).toHaveLength(2);
    expect(res.body.data.meta.total).toBe(2);
    expect(res.body.data.meta.count).toBe(2);
    expect(res.body.data.meta.more).toBe(false);
    expect(typeof res.body.data.meta.cache.fetchedAt).toBe('string');
    expect(res.body.data.meta.cache.stale).toBe(false);
  });

  it('applies the q filter', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/api/v1/countries?q=germ');
    expect(res.status).toBe(200);
    expect(res.body.data.objects).toHaveLength(1);
    expect(res.body.data.objects[0].names.common).toBe('Germany');
  });

  it('applies the fields projection', async () => {
    const res = await request(appWith(loadedSnapshot())).get(
      '/api/v1/countries?fields=names.common,codes.alpha_2',
    );
    expect(res.body.data.objects[0]).toEqual({ names: { common: 'Canada' }, codes: { alpha_2: 'CA' } });
  });

  it('rejects an out-of-range limit with validation details', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/api/v1/countries?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('limit');
  });

  it('rejects a non-numeric limit', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/api/v1/countries?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an explicitly empty q', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/api/v1/countries?q=');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/countries/:code', () => {
  it('returns 503 before the snapshot is loaded', async () => {
    const res = await request(appWith(new SnapshotStore())).get('/api/v1/countries/CAN');
    expect(res.status).toBe(503);
  });

  it('finds a country by alpha-2, alpha-3 and CIOC regardless of case', async () => {
    const app = appWith(loadedSnapshot());
    for (const code of ['CA', 'ca', 'CAN', 'can']) {
      const res = await request(app).get(`/api/v1/countries/${code}`);
      expect(res.status).toBe(200);
      expect(res.body.data.objects[0].names.common).toBe('Canada');
    }
  });

  it('returns 404 for an unknown code', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/api/v1/countries/XX');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed code', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/api/v1/countries/ABCD');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });
});

describe('GET /health', () => {
  it('reports degraded before the snapshot is loaded', async () => {
    const res = await request(appWith(new SnapshotStore())).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'degraded', countries: 0, cache: { fetchedAt: null, stale: true } });
  });

  it('reports ok after the snapshot is loaded', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', countries: 2, cache: { stale: false } });
  });
});

describe('unknown routes', () => {
  it('returns the JSON error contract', async () => {
    const res = await request(appWith(loadedSnapshot())).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
