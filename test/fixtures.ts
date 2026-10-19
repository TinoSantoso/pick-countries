import { countrySchema, type Country } from '../src/types.js';

export type CountryOverrides = {
  common?: string;
  alpha2?: string;
  alpha3?: string;
  cioc?: string;
  fifa?: string;
  region?: string;
  subregion?: string;
  currencies?: Country['currencies'];
  languages?: Country['languages'];
  capitals?: Country['capitals'];
};

/** Builds a v5-shaped record (validated through the real schema, so fixtures stay honest). */
export function makeCountry(over: CountryOverrides = {}, extra: Record<string, unknown> = {}): Country {
  const common = over.common ?? 'Testland';
  return countrySchema.parse({
    names: { common, official: `${common} Republic`, alternates: [`${common} Isles`] },
    codes: {
      alpha_2: over.alpha2 ?? 'TS',
      alpha_3: over.alpha3 ?? 'TST',
      ...(over.cioc !== undefined ? { cioc: over.cioc } : {}),
      ...(over.fifa !== undefined ? { fifa: over.fifa } : {}),
    },
    region: over.region,
    subregion: over.subregion,
    capitals: over.capitals ?? [{ name: 'Testville' }],
    currencies: over.currencies ?? [{ code: 'TSD', name: 'Test dollar', symbol: 'T$' }],
    languages:
      over.languages ??
      [{ name: 'Testish', native_name: 'Testisch', bcp47: 'ts', iso639_1: 'ts', iso639_3: 'tst' }],
    flag: { emoji: '🏳️' },
    ...extra,
  });
}

/** Builds an upstream list envelope in the shape the demo key returns. */
export function envelope(objects: unknown[], meta: Record<string, unknown> = {}): unknown {
  return {
    data: {
      objects,
      meta: { total: objects.length, count: objects.length, limit: 100, offset: 0, more: false, ...meta },
    },
  };
}
