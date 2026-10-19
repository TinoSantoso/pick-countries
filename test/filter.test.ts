import { describe, expect, it } from 'vitest';
import { applyQuery, projectFields } from '../src/query/filter.js';
import { makeCountry, type CountryOverrides } from './fixtures.js';

const canada: CountryOverrides = {
  common: 'Canada',
  alpha2: 'CA',
  alpha3: 'CAN',
  cioc: 'CAN',
  fifa: 'CAN',
  region: 'Americas',
  subregion: 'North America',
  currencies: [{ code: 'CAD', name: 'Canadian dollar', symbol: '$' }],
  languages: [
    { name: 'English', native_name: 'English', bcp47: 'en', iso639_1: 'en', iso639_3: 'eng' },
    { name: 'French', native_name: 'français', bcp47: 'fr', iso639_1: 'fr', iso639_3: 'fra' },
  ],
  capitals: [{ name: 'Ottawa' }],
};

const germany: CountryOverrides = {
  common: 'Germany',
  alpha2: 'DE',
  alpha3: 'DEU',
  region: 'Europe',
  subregion: 'Western Europe',
  currencies: [{ code: 'EUR', name: 'Euro', symbol: '€' }],
  languages: [{ name: 'German', native_name: 'Deutsch', bcp47: 'de', iso639_1: 'de', iso639_3: 'deu' }],
  capitals: [{ name: 'Berlin' }],
};

const baseQuery = { limit: 25, offset: 0 };

describe('applyQuery', () => {
  const countries = [makeCountry(canada), makeCountry(germany)];

  it('returns everything with pagination meta when no filters are set', () => {
    const result = applyQuery(countries, baseQuery);
    expect(result.objects).toHaveLength(2);
    expect(result.meta).toEqual({ total: 2, count: 2, limit: 25, offset: 0, more: false });
  });

  it('matches q against common name, alpha-3, and capital, case-insensitively', () => {
    expect(applyQuery(countries, { ...baseQuery, q: 'germ' }).objects.map((c) => c.names.common)).toEqual(['Germany']);
    expect(applyQuery(countries, { ...baseQuery, q: 'can' }).objects.map((c) => c.names.common)).toEqual(['Canada']);
    expect(applyQuery(countries, { ...baseQuery, q: 'ott' }).objects.map((c) => c.names.common)).toEqual(['Canada']);
    expect(applyQuery(countries, { ...baseQuery, q: 'NADA' }).objects).toHaveLength(1);
    expect(applyQuery(countries, { ...baseQuery, q: 'zzz' }).objects).toHaveLength(0);
  });

  it('filters by region and subregion case-insensitively', () => {
    expect(applyQuery(countries, { ...baseQuery, region: 'europe' }).objects).toHaveLength(1);
    expect(applyQuery(countries, { ...baseQuery, subregion: 'north america' }).objects).toHaveLength(1);
    expect(applyQuery(countries, { ...baseQuery, region: 'Asia' }).objects).toHaveLength(0);
  });

  it('filters by currency code and by language name, native name, and ISO code', () => {
    expect(applyQuery(countries, { ...baseQuery, currency: 'cad' }).objects).toHaveLength(1);
    expect(applyQuery(countries, { ...baseQuery, language: 'fra' }).objects.map((c) => c.names.common)).toEqual([
      'Canada',
    ]);
    expect(applyQuery(countries, { ...baseQuery, language: 'deutsch' }).objects.map((c) => c.names.common)).toEqual([
      'Germany',
    ]);
    expect(applyQuery(countries, { ...baseQuery, language: 'german' }).objects).toHaveLength(1);
  });

  it('ANDs multiple filters together', () => {
    expect(applyQuery(countries, { ...baseQuery, q: 'ger', region: 'Europe' }).objects).toHaveLength(1);
    expect(applyQuery(countries, { ...baseQuery, q: 'ger', region: 'Americas' }).objects).toHaveLength(0);
  });

  it('paginates with the more flag', () => {
    const page1 = applyQuery(countries, { limit: 1, offset: 0 });
    expect(page1.meta).toEqual({ total: 2, count: 1, limit: 1, offset: 0, more: true });
    const page2 = applyQuery(countries, { limit: 1, offset: 1 });
    expect(page2.meta).toEqual({ total: 2, count: 1, limit: 1, offset: 1, more: false });
    const beyond = applyQuery(countries, { limit: 25, offset: 99 });
    expect(beyond.objects).toHaveLength(0);
    expect(beyond.meta.more).toBe(false);
  });

  it('projects with a fields allowlist', () => {
    const result = applyQuery(countries, { ...baseQuery, fields: ['names.common', 'codes.alpha_2'] });
    expect(result.objects[0]).toEqual({ names: { common: 'Canada' }, codes: { alpha_2: 'CA' } });
  });

  it('projects with a fields_omit blocklist', () => {
    const result = applyQuery(countries, { ...baseQuery, fields_omit: ['names'] });
    const first = result.objects[0] as unknown as Record<string, unknown>;
    expect(first).not.toHaveProperty('names');
    expect(first).toHaveProperty('codes');
  });

  it('lets fields_omit win over fields', () => {
    const result = applyQuery(countries, {
      ...baseQuery,
      fields: ['names', 'codes.alpha_2'],
      fields_omit: ['names.official', 'names.alternates'],
    });
    expect(result.objects[0]).toEqual({ names: { common: 'Canada' }, codes: { alpha_2: 'CA' } });
  });
});

describe('projectFields', () => {
  const country = makeCountry(canada);

  it('returns the same object when no projection is requested', () => {
    expect(projectFields(country, undefined, undefined)).toBe(country);
    expect(projectFields(country, [], [])).toBe(country);
  });

  it('never mutates the input record', () => {
    const clone = structuredClone(country);
    projectFields(country, ['names'], ['names.official']);
    expect(country).toEqual(clone);
  });

  it('ignores paths that traverse arrays', () => {
    const result = projectFields(country, ['capitals.0.name', 'names.common'], undefined);
    expect(result).toEqual({ names: { common: 'Canada' } });
  });
});
