# Countries API

A TypeScript REST API for country data, backed by the
[REST Countries API v5](https://restcountries.com/docs/countries). The service prefetches the full
dataset (~250 countries, 3 upstream requests) into memory on startup and refreshes it on a TTL
(default 24 h), so client reads never hit upstream. Requirements and design live in
[`docs/PRD.md`](docs/PRD.md) and [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and paste your RESTCOUNTRIES_API_KEY manually (get one at https://restcountries.com/sign-up).
```

`rc_live_demo` works as a development key; it returns a shape-accurate sample instead of the full
dataset, so most list responses will be empty while using it.

## Run

```bash
npm run dev      # tsx watch with .env loaded
npm run build    # compile to dist/
npm start        # node dist/server.js
npm test         # vitest (no network access in tests)
npm run lint     # eslint
npm run check    # tsc --noEmit
```

Startup fails fast when `RESTCOUNTRIES_API_KEY` is missing. The server listens immediately and
serves `503` from the data routes until the first successful refresh; `/health` reports
`status: "degraded"` meanwhile.

## API

All responses are JSON. List responses use the envelope
`{ data: { objects: [...], meta: { total, count, limit, offset, more, cache: { fetchedAt, stale } } } }`.
Errors use `{ error: { code, message, details? } }`.

### `GET /health`

```bash
curl -s http://localhost:3000/health | jq
```

```json
{ "status": "ok", "countries": 249, "cache": { "fetchedAt": "2026-10-13T09:00:00.000Z", "stale": false } }
```

### `GET /api/v1/countries`

Query params (all filters AND together):

| Param | Meaning |
|-------|---------|
| `q` | Case-insensitive substring search across names, codes, capitals, region, subregion |
| `region` | Exact region match, case-insensitive (e.g. `Europe`) |
| `subregion` | Exact subregion match, case-insensitive (e.g. `Northern Europe`) |
| `currency` | Currency code, case-insensitive (e.g. `CAD`) |
| `language` | Language name, native name, or ISO 639 code (e.g. `English`, `fra`) |
| `limit` | Page size, 1–100 (default 25) |
| `offset` | Records to skip (default 0) |
| `fields` | Comma-separated dot-path allowlist (e.g. `names.common,codes.alpha_2,flag.emoji`) |
| `fields_omit` | Comma-separated dot-path blocklist; wins over `fields` (e.g. `names.translations`) |

```bash
curl -s 'http://localhost:3000/api/v1/countries?region=Europe&fields=names.common,codes.alpha_2,flag.emoji&limit=2' | jq
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

### `GET /api/v1/countries/:code`

Single country by ISO alpha-2, alpha-3, or CIOC code, case-insensitive:

```bash
curl -s http://localhost:3000/api/v1/countries/can | jq '.data.objects[0].names.common'
```

## Errors

| Status | `error.code` | When |
|--------|--------------|------|
| 400 | `VALIDATION_ERROR` | Query params failed validation (`details` names each field) |
| 400 | `INVALID_CODE` | `:code` is not 2–3 letters |
| 404 | `NOT_FOUND` | Unknown route or country code |
| 503 | `SNAPSHOT_UNAVAILABLE` | First refresh has not completed yet |
| 502 | `UPSTREAM_ERROR` | A refresh failed against restcountries.com (stale data may still be served) |
| 500 | `INTERNAL_ERROR` | Unexpected failure (logged with a request id) |

## Operations

- **Quota math**: one refresh costs 3 upstream requests. At the default 24 h TTL that is ~90
  requests/month against the Free plan's 1,000/month. The refresh loop hard-caps at 3 pages and
  errors loudly if the dataset outgrows it.
- **Failures**: on refresh failure the loop retries with exponential backoff (5 s doubling, capped
  at 5 min; a `Retry-After` on 429 raises the delay). Reads keep serving the last good snapshot
  with `meta.cache.stale: true`.
- **Data shape**: records are stored as upstream sends them (90+ fields: `names`, `codes`,
  `capitals`, `currencies`, `languages`, `flag`, `memberships`, …). The Free plan replaces the
  premium `leaders` field with an upgrade notice; it is passthrough data here.
- **Key safety**: the key is read from `.env` only, is redacted from request logs, and is never
  included in any response.
