# Implementation Plan — Countries REST API

Companion to `docs/PRD.md`. Stack: TypeScript (strict), Express, zod, pino, vitest. Node ≥ 20, ESM,
native `fetch`. Runtime deps: `express`, `helmet`, `pino`, `pino-http`, `zod`. Dev deps:
`typescript`, `tsx`, `vitest`, `supertest`, `@types/*`, `eslint`, `typescript-eslint`, `prettier`.

## Project layout

```
src/
  config.ts                  # zod-parsed env: PORT, RESTCOUNTRIES_API_KEY, REFRESH_TTL_MS, timeouts, log level
  types.ts                   # Country (loose zod), envelope, error contracts
  upstream/client.ts         # fetch wrapper: bearer auth, timeout, envelope parsing, error mapping, Retry-After
  upstream/refresh.ts        # multi-page fetch + dedupe; refresh loop with backoff
  cache/snapshot.ts          # in-memory store: atomic swap, alpha-2/alpha-3/cioc indexes, staleness
  query/filter.ts            # pure functions: free-text search, property filters, dot-path projection, pagination
  http/app.ts                # express factory: helmet, pino-http, routes, 404 + error handlers
  http/schemas.ts            # zod query-param schemas + validateQuery middleware
  http/routes/countries.ts   # FR1 (list), FR2 (read by code)
  http/routes/health.ts      # FR3
  http/middleware/errorHandler.ts
  server.ts                  # entrypoint: config → app → listen; refresh loop; graceful shutdown
test/
  fixtures.ts                # fake v5-shaped records (built from a live demo-key sample)
  config.test.ts  client.test.ts  refresh.test.ts  snapshot.test.ts  filter.test.ts  http.test.ts
```

## Conventions

- `type` over `interface`; string literal unions over enums; `unknown` + narrowing; no `any`.
- Errors handled explicitly; no swallowed rejections. Comments explain why.
- Dev server: `tsx watch` with `NODE_OPTIONS="--env-file=.env"`; prod: `tsc` → `node --env-file=.env dist/server.js`.
- Import paths use `.js` extensions (NodeNext ESM).

## Phases (each ends with a verifiable gate)

1. **Scaffold** — `package.json` (ESM, engines ≥ 20), strict `tsconfig` (NodeNext, `noUncheckedIndexedAccess`), flat eslint, vitest config, `.gitignore` (node_modules, dist, `.env`). Scripts: `dev`, `build`, `start`, `test`, `lint`, `format`, `check` (`tsc --noEmit`).
   Gate: `npm run check` passes on a stub module; `npm install` clean.
2. **Config + types** — `loadConfig(env)` via zod: fail-fast on missing `RESTCOUNTRIES_API_KEY`, defaults for `PORT` (3000), `REFRESH_TTL_MS` (24 h), `UPSTREAM_TIMEOUT_MS` (10 s), `LOG_LEVEL` (`info`). `types.ts` from the live sample: loose `countrySchema` (required `names.common`, `codes.alpha_2`, `codes.alpha_3`; optional `region`, `subregion`, `capitals`, `currencies`, `languages`, `flag`; passthrough for the rest), `listEnvelopeSchema` with loose `meta`, `upstreamErrorSchema`.
   Gate: config unit test (missing key → throw with field name; defaults applied).
3. **Upstream client + refresh** — `createUpstreamClient(config)`: GET `${base}?limit&offset`, bearer header, `AbortController` timeout, envelope parse, error mapping: 401/403/429/5xx → `UpstreamError` (status, upstream message, `retryAfterMs` from `Retry-After` on 429). `fetchAllCountries(client)`: pages of 100 until `meta.more === false` or short page, cap 3 pages, dedupe by alpha-2, per-record parse with skip-and-log, fail when > 50% invalid. `startRefreshLoop`: success → swap snapshot + schedule next at TTL; failure → log + backoff (5 s doubling, cap 5 min, cap 10 min on 429 `Retry-After`), all timers unref'd.
   Gate: vitest with stubbed `fetch` — success merge, 401, 429 with Retry-After, short-page early stop, page-cap guard.
4. **Snapshot cache** — `SnapshotStore.swap(countries, fetchedAt)` rebuilds a `Map` keyed by uppercase alpha-2, alpha-3, and CIOC (first-wins on collisions); `getByCode`, `all`, `ready`, `fetchedAt`, `isStale(now, ttlMs)`.
   Gate: unit tests incl. case-insensitivity and stale boundaries.
5. **Query engine** — pure `applyQuery(countries, params)`: `q` substring match over names (common/official/alternates), codes (alpha-2/3, fifa, cioc), capital names, region, subregion; `region`/`subregion` case-insensitive equality; `currency` matches `currencies[].code` (case-insensitive); `language` matches `languages[].name`/`native_name`/`iso639_*`/`bcp47` (case-insensitive); `projectFields` implements dot-path allowlist/blocklist on `structuredClone` (omit wins); `paginate` returns `meta` (total, count, limit, offset, more).
   Gate: unit tests for every param, the omit-wins rule, and pagination boundaries.
6. **HTTP layer** — `buildApp(deps)`: `helmet()`, `pino-http` (UUID request ids, redacted authorization), `validateQuery(listQuerySchema)` middleware (400 with details), routes per FR1–FR3, JSON 404 handler, central error handler (`HttpError` → status/code; `ZodError` → 400; unknown → 500 logged). `503 { code: "SNAPSHOT_UNAVAILABLE" }` until first successful refresh.
   Gate: supertest suite with an in-memory snapshot — happy paths and every error path.
7. **Entrypoint** — `server.ts`: load config (exit 1 with message on failure), build app, listen, start refresh loop, SIGTERM/SIGINT → close server + stop loop.
   Gate: manual boot with the demo key.
8. **Docs** — `README.md`: setup (`cp .env.example .env`, paste key manually), run scripts, full API reference with curl examples (`rc_live_demo`), error table, ops notes (TTL, staleness, quota math).
9. **Final verification** — `npm run check`, `npm run lint`, `npm test` green; boot server and curl every route including error paths (invalid `limit`, unknown/malformed code, health). This is a backend-only API: browser verification is replaced by curl against the running dev server.

## Risks

- Free plan caps `limit` at 100 → refresh hard-caps at 3 pages and errors loudly if the dataset grows past 300, so the loop never silently burns quota.
- Demo-key responses embed a `data._demo` block and a reduced `meta` → envelope schema is loose on unknown keys; `_demo` is stripped before snapshot swap.
- Upstream shape drift → per-record validation with skip-and-log; refresh fails only when a majority of records are invalid, surfacing the problem instead of serving a broken dataset.
