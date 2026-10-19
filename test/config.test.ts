import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('accepts a minimal env and applies defaults', () => {
    const config = loadConfig({ RESTCOUNTRIES_API_KEY: 'k' });
    expect(config.PORT).toBe(3000);
    expect(config.REFRESH_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(config.UPSTREAM_TIMEOUT_MS).toBe(10_000);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('throws and names the missing field', () => {
    expect(() => loadConfig({})).toThrowError(/RESTCOUNTRIES_API_KEY/);
  });

  it('coerces numeric env vars', () => {
    const config = loadConfig({ RESTCOUNTRIES_API_KEY: 'k', PORT: '8080', REFRESH_TTL_MS: '500' });
    expect(config.PORT).toBe(8080);
    expect(config.REFRESH_TTL_MS).toBe(500);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ RESTCOUNTRIES_API_KEY: 'k', PORT: 'abc' })).toThrowError(/PORT/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ RESTCOUNTRIES_API_KEY: 'k', LOG_LEVEL: 'verbose' })).toThrowError(/LOG_LEVEL/);
  });
});
