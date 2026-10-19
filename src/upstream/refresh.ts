import type { Logger } from 'pino';
import { countrySchema, type Country } from '../types.js';
import { UpstreamError, type UpstreamClient } from './client.js';

/** Free-plan maximum page size: the whole dataset loads in exactly 3 requests. */
export const PAGE_SIZE = 100;
/** Quota guard: the dataset is ~250 records; refuse to fetch beyond 3 pages. */
export const MAX_PAGES = 3;

const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

export type FetchAllResult = { countries: Country[]; skipped: number };

export async function fetchAllCountries(client: UpstreamClient, log?: Logger): Promise<FetchAllResult> {
  const countries: Country[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let more = true;
  let total: number | null = null;

  for (let page = 0; page < MAX_PAGES && more; page++) {
    const res = await client.fetchPage(PAGE_SIZE, page * PAGE_SIZE);
    more = res.more;
    if (res.total !== null) total = res.total;
    for (const raw of res.objects) {
      const parsed = countrySchema.safeParse(raw);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      const key = parsed.data.codes.alpha_2.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      countries.push(parsed.data);
    }
  }

  if (more) {
    throw new UpstreamError({
      status: 0,
      message: `Upstream dataset exceeds ${MAX_PAGES * PAGE_SIZE} records; refusing to fetch more pages`,
    });
  }
  if (countries.length === 0) {
    throw new UpstreamError({ status: 0, message: 'Upstream returned zero valid country records' });
  }
  if (total !== null && countries.length < total / 2) {
    throw new UpstreamError({
      status: 0,
      message: `Only ${countries.length} of ${total} upstream records parsed; upstream shape may have changed`,
    });
  }
  if (skipped > 0 && log) {
    log.warn({ skipped }, 'Skipped malformed upstream records');
  }
  return { countries, skipped };
}

export type RefreshLoop = { stop(): void };

/**
 * Fetches the full dataset immediately, then re-fetches every ttlMs. On failure it retries
 * with exponential backoff (5 s doubling, capped at 5 min, raised to Retry-After on 429).
 * All timers are unref'd so they never keep the process alive.
 */
export function startRefreshLoop(opts: {
  client: UpstreamClient;
  onRefresh: (countries: Country[]) => void;
  ttlMs: number;
  log: Logger;
}): RefreshLoop {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let attempt = 0;

  function schedule(fn: () => void, delayMs: number): void {
    if (stopped) return;
    timer = setTimeout(fn, delayMs);
    timer.unref();
  }

  async function runOnce(): Promise<void> {
    const result = await fetchAllCountries(opts.client, opts.log);
    attempt = 0;
    opts.onRefresh(result.countries);
    opts.log.info({ count: result.countries.length }, 'Snapshot refreshed');
    schedule(run, opts.ttlMs);
  }

  function run(): void {
    runOnce().catch((err: unknown) => {
      attempt += 1;
      let delay = Math.min(BASE_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
      if (err instanceof UpstreamError && err.retryAfterMs !== undefined) {
        delay = Math.max(delay, err.retryAfterMs);
      }
      opts.log.warn(
        { err: err instanceof Error ? err.message : String(err), attempt, retryInMs: delay },
        'Snapshot refresh failed',
      );
      schedule(run, delay);
    });
  }

  schedule(run, 0);

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
