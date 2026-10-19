import type { Country } from '../types.js';

export type ListQuery = {
  q?: string;
  region?: string;
  subregion?: string;
  currency?: string;
  language?: string;
  limit: number;
  offset: number;
  fields?: string[];
  fields_omit?: string[];
};

export type Page = {
  objects: Country[];
  meta: {
    total: number;
    count: number;
    limit: number;
    offset: number;
    more: boolean;
  };
};

function eq(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}

function matchesQuery(country: Country, q: string): boolean {
  const needle = q.toLowerCase();
  const haystack = [
    country.names.common,
    country.names.official ?? '',
    ...(country.names.alternates ?? []),
    country.codes.alpha_2,
    country.codes.alpha_3,
    country.codes.fifa ?? '',
    country.codes.cioc ?? '',
    ...(country.capitals ?? []).map((c) => c.name ?? ''),
    country.region ?? '',
    country.subregion ?? '',
  ];
  return haystack.some((s) => s.toLowerCase().includes(needle));
}

function matchesLanguage(country: Country, language: string): boolean {
  const needle = language.toLowerCase();
  return (country.languages ?? []).some((l) =>
    [l.name, l.native_name, l.bcp47, l.iso639_1, l.iso639_3].some((v) => v?.toLowerCase() === needle),
  );
}

function applyFilters(countries: readonly Country[], query: ListQuery): Country[] {
  // Narrowed filter values are captured in consts: TS loses property narrowing inside closures.
  const { q, region, subregion, currency, language } = query;
  return countries.filter((c) => {
    if (q !== undefined && !matchesQuery(c, q)) return false;
    if (region !== undefined && !eq(c.region, region)) return false;
    if (subregion !== undefined && !eq(c.subregion, subregion)) return false;
    if (currency !== undefined && !(c.currencies ?? []).some((cur) => eq(cur.code, currency))) return false;
    if (language !== undefined && !matchesLanguage(c, language)) return false;
    return true;
  });
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    // Path segments inside arrays are out of scope; projection targets object branches only.
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (const key of keys.slice(0, -1)) {
    const next = cur[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cur[key] = fresh;
      cur = fresh;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  const last = keys[keys.length - 1];
  if (last !== undefined) cur[last] = value;
}

function deleteAtPath(obj: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const key of keys.slice(0, -1)) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return;
    cur = (cur as Record<string, unknown>)[key];
  }
  const last = keys[keys.length - 1];
  if (last !== undefined && cur !== null && typeof cur === 'object' && !Array.isArray(cur)) {
    delete (cur as Record<string, unknown>)[last];
  }
}

/**
 * Dot-path allowlist/blocklist projection. When both are set, omit wins (matches
 * upstream response_fields / response_fields_omit semantics). Projected values are
 * deep-cloned so omit pruning never mutates the shared snapshot record.
 */
export function projectFields(
  country: Country,
  fields: string[] | undefined,
  fieldsOmit: string[] | undefined,
): Country {
  if ((fields === undefined || fields.length === 0) && (fieldsOmit === undefined || fieldsOmit.length === 0)) {
    return country;
  }

  let out: Record<string, unknown>;
  if (fields !== undefined && fields.length > 0) {
    const projected: Record<string, unknown> = {};
    for (const path of fields) {
      const value = getPath(country, path);
      if (value !== undefined) setPath(projected, path, structuredClone(value));
    }
    out = projected;
  } else {
    out = structuredClone(country) as Record<string, unknown>;
  }

  if (fieldsOmit !== undefined) {
    for (const path of fieldsOmit) deleteAtPath(out, path);
  }
  return out as Country;
}

export function paginate(countries: readonly Country[], limit: number, offset: number): Page {
  const total = countries.length;
  const objects = countries.slice(offset, offset + limit);
  return {
    objects,
    meta: {
      total,
      count: objects.length,
      limit,
      offset,
      more: offset + objects.length < total,
    },
  };
}

export function applyQuery(countries: readonly Country[], query: ListQuery): Page {
  const page = paginate(applyFilters(countries, query), query.limit, query.offset);
  return {
    objects: page.objects.map((c) => projectFields(c, query.fields, query.fields_omit)),
    meta: page.meta,
  };
}
