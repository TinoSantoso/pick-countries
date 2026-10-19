import type { Config } from '../config.js';
import { listEnvelopeSchema, upstreamErrorSchema, type UpstreamPage } from '../types.js';

const BASE_URL = 'https://api.restcountries.com/countries/v5';

const STATUS_HINTS: Record<number, string> = {
  400: 'Upstream rejected the request parameters',
  401: 'Upstream rejected the API key',
  403: 'Upstream refused the request (quota exhausted, or a premium field was requested on the Free plan)',
  404: 'Upstream endpoint not found',
  410: 'Upstream API version retired',
  429: 'Upstream rate limit hit',
  500: 'Upstream internal error',
};

export class UpstreamError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(details: { status: number; message: string; retryAfterMs?: number }) {
    super(details.message);
    this.name = 'UpstreamError';
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export type UpstreamClient = {
  fetchPage(limit: number, offset: number): Promise<UpstreamPage>;
};

export function createUpstreamClient(
  config: Pick<Config, 'RESTCOUNTRIES_API_KEY' | 'UPSTREAM_TIMEOUT_MS'>,
): UpstreamClient {
  async function fetchPage(limit: number, offset: number): Promise<UpstreamPage> {
    const url = `${BASE_URL}?limit=${limit}&offset=${offset}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.UPSTREAM_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.RESTCOUNTRIES_API_KEY}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? `Upstream timed out after ${config.UPSTREAM_TIMEOUT_MS}ms`
          : `Upstream request failed: ${err instanceof Error ? err.message : String(err)}`;
      throw new UpstreamError({ status: 0, message });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new UpstreamError({
        status: res.status,
        message: await describeError(res),
        retryAfterMs: retryAfterMs(res),
      });
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new UpstreamError({ status: res.status, message: 'Upstream returned invalid JSON' });
    }

    const envelope = listEnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      throw new UpstreamError({ status: res.status, message: 'Upstream response envelope did not match the expected shape' });
    }
    return {
      objects: envelope.data.data.objects,
      more: envelope.data.data.meta?.more ?? false,
      total: envelope.data.data.meta?.total ?? null,
    };
  }

  async function describeError(res: Response): Promise<string> {
    const hint = STATUS_HINTS[res.status] ?? `Upstream responded with status ${res.status}`;
    let upstreamMessage = '';
    try {
      const parsed = upstreamErrorSchema.safeParse(await res.json());
      if (parsed.success) {
        upstreamMessage = parsed.data.errors
          .map((e) => e.message)
          .filter((m) => m !== undefined)
          .join('; ');
      }
    } catch {
      // Body was not JSON; the status hint alone is enough.
    }
    return upstreamMessage ? `${hint}: ${upstreamMessage}` : hint;
  }

  function retryAfterMs(res: Response): number | undefined {
    const raw = res.headers.get('retry-after');
    if (raw === null) return undefined;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
  }

  return { fetchPage };
}
