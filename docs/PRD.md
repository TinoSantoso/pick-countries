# PRD — Countries REST API

Status: approved · Version: 1.1 · Date: 2026-10-19

## 1. Overview

A TypeScript REST API (Express) that exposes normalized country data, backed by the
[REST Countries Countries API v5](https://restcountries.com/docs/countries) as its upstream data source.

The service keeps a full in-memory snapshot of the dataset (~250 countries) that is prefetched on
startup and refreshed on a configurable TTL. All client reads are served from the snapshot; upstream
is contacted only by the refresh loop (~3 requests per refresh cycle). This protects the account's
monthly request quota (1,000/month on the Free plan) and stays far below the 20 req/10 s throughput
ceiling.

## 2. Upstream facts (verified against restcountries.com/docs and a live demo-key request)

- Base URL: `https://api.restcountries.com/countries/v5`. All endpoints are `GET`, responses are JSON.
- Auth: `Authorization: Bearer <API_KEY>`. The key is added manually to `.env` (never committed).
  The `rc_live_demo` demo key serves a shape-accurate sample with a `data._demo` notice block.
- Pagination: `limit` (default 25, max 100 on Free plan, 500 on paid), `offset`.
- Field shaping: `response_fields` / `response_fields_omit` accept comma-separated dot-paths
  (e.g. `names.common,codes.alpha_2`); when both are present, omit wins.
- Error shape: `{ "errors": [{ "message": "..." }] }` with HTTP 400 (validation), 401 (bad key),
  403 (frozen account / premium field on Free plan), 404, 405, 410, 429 (edge rate limit, honors
  `Retry-After`), 5xx.
- Quota: Free plan 1,000 requests/month (soft limit, email alerts at 50/80/100%). Throughput:
  sustained >20 req/10 s is rejected at the Cloudflare edge with 429.
- Record shape (top-level keys observed in a live record): `names, codes, capitals, flag, region,
  subregion, area, assets, borders, calling_codes, cars, classification, continents, coordinates,
  currencies, date, demonyms, descriptions, economy, government_type, landlocked, languages, leaders,
  links, memberships, number_format, parent, population, postal_code, timezones, tlds, units, uuid, _meta`.
  Notable sub-shapes: `languages[] = {bcp47, iso639_1, iso639_2b, iso639_2t, iso639_3, name, native_name}`,
  `currencies[] = {code, name, symbol}`, `capitals[] = {name, coordinates, attributes}`.
- Premium fields (`leaders`) are replaced by an upgrade-notice placeholder on Free plans and reject
  direct search/filter with 403. Typed as optional/passthrough.

## 3. Goals

- G1: Provide a stable, versioned API surface (`/api/v1`) for country data.
- G2: Protect the upstream quota via a prefetched in-memory snapshot with TTL refresh (default 24 h).
- G3: Keep the API key server-side only — in `.env`, never logged, never returned to clients.
- G4: Degrade gracefully: serve a stale snapshot during upstream outages; return structured errors
  when no snapshot exists.
- G5: End-to-end type safety: strict TypeScript, zod schemas for env config, query params, and the
  upstream envelope.

## 4. Out of scope (v1)

Persistence (database/Redis), client authentication on our API, webhooks, sort controls, membership
filters (`memberships.*`), and the other REST Countries products (User Agent, IP, Email Intelligence,
Currencies). Server-side only; no CORS configuration is needed for v1.

## 5. Functional requirements

| ID | Requirement |
|----|-------------|
| FR1 | `GET /api/v1/countries` — paginated list over the snapshot. Query params: `q` (case-insensitive free text across names, codes, capitals, region, subregion), `region`, `subregion`, `currency` (code, e.g. `CAD`), `language` (name or ISO code, e.g. `English`, `fra`), `limit` (1–100, default 25), `offset` (≥ 0, default 0), `fields` (dot-path allowlist), `fields_omit` (dot-path blocklist, omit wins). All filters AND together. |
| FR2 | `GET /api/v1/countries/:code` — single country by alpha-2, alpha-3, or CIOC code, case-insensitive. `404` on unknown code; `400` on malformed code. |
| FR3 | `GET /health` — service status, country count, snapshot `fetchedAt`, staleness. Always responds 200 (`status: "ok"` or `"degraded"`). |
| FR4 | Refresh loop: fetch pages of 100 (`offset 0/100/200`, stop per `meta.more` / short page, hard cap 3 pages), dedupe by alpha-2, swap the snapshot atomically. On failure: exponential backoff (5 s doubling, cap 5 min), `Retry-After` honored on 429. |
| FR5 | Query-param validation via zod → `400` with the structured error body and per-field details. |
| FR6 | Response envelope: `{ data: { objects: [...], meta: { total, count, limit, offset, more, cache: { fetchedAt, stale } } } }`. |
| FR7 | Error contract: `{ error: { code, message, details? } }`. `503` when no snapshot is available. Refresh failures never fail reads: the stale snapshot is served with `meta.cache.stale: true`; upstream `401`/`403` are logged by the refresh loop (reads make no upstream calls). |
| FR8 | `.env.example` ships with `RESTCOUNTRIES_API_KEY=` placeholder; the user fills it manually. Startup fails fast with a clear message when the key is missing. |

### 5.1 Example: list

```
GET /api/v1/countries?region=Europe&fields=names.common,codes.alpha_2,flag.emoji&limit=2
```

```json
{
  "data": {
    "objects": [
      { "names": { "common": "Albania" }, "codes": { "alpha_2": "AL" }, "flag": { "emoji": "🇦🇱" } },
      { "names": { "common": "Andorra" }, "codes": { "alpha_2": "AD" }, "flag": { "emoji": "🇦🇩" } }
    ],
    "meta": { "total": 44, "count": 2, "limit": 2, "offset": 0, "more": true,
              "cache": { "fetchedAt": "2026-10-13T09:00:00.000Z", "stale": false } }
  }
}
```

### 5.2 Example errors

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid query parameters",
             "details": [{ "path": "limit", "message": "Number must be between 1 and 100" }] } }
```

```json
{ "error": { "code": "NOT_FOUND", "message": "No country with code XX" } }
```

## 6. Non-functional requirements

- NFR1: Hot-path reads make zero upstream calls; a full local query over 250 records.
- NFR2: Upstream consumption ≈ 3 requests per refresh (≈ 90/month at a 24 h TTL).
- NFR3: Structured logging (pino) with request IDs; `authorization` header value redacted.
- NFR4: Tests: vitest unit tests (config, client, refresh, snapshot, query engine) and supertest
  integration tests over the HTTP layer with a mocked upstream. No network in tests.
- NFR5: Gates: `tsc --noEmit`, eslint, and vitest all green before done.
- NFR6: Node ≥ 20 (project targets Node 24), ESM, native `fetch`, no cache library (plain `Map`).

## 7. Data & type strategy

The snapshot stores upstream records as-is. The `Country` type is a zod loose object: required core
indexing fields (`names.common`, `codes.alpha_2`, `codes.alpha_3`), optional well-known fields typed
where code depends on them, everything else passed through untouched. `fields`/`fields_omit`
projection operates directly on dot-paths, so no transformation layer exists and no data is lost.

## 8. Acceptance criteria

- All FRs implemented and covered by tests; `npm run check`, `npm run lint`, `npm test` green.
- Server boots with the demo key, serves live-shaped data from the snapshot on every route.
- Error paths verified by curl: invalid `limit`, unknown code, malformed code, 503 before first
  successful refresh.
- README documents setup (manual key entry), the API surface, and ops notes (TTL, staleness).
