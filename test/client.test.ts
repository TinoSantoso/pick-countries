import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUpstreamClient, UpstreamError } from '../src/upstream/client.js';
import { envelope, makeCountry } from './fixtures.js';

const client = createUpstreamClient({ RESTCOUNTRIES_API_KEY: 'test-key', UPSTREAM_TIMEOUT_MS: 5_000 });

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('upstream client', () => {
  it('sends the bearer token and parses a page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope([makeCountry()], { more: true })));
    vi.stubGlobal('fetch', fetchMock);

    const page = await client.fetchPage(100, 0);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.restcountries.com/countries/v5?limit=100&offset=0');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    expect(page.objects).toHaveLength(1);
    expect(page.more).toBe(true);
    expect(page.total).toBe(1);
  });

  it('maps a 401 to UpstreamError carrying the upstream message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'Invalid API key' }] }, 401)),
    );
    const err = await client.fetchPage(100, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).status).toBe(401);
    expect((err as UpstreamError).message).toContain('Invalid API key');
  });

  it('captures Retry-After on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'slow down' }] }, 429, { 'retry-after': '7' })),
    );
    const err = await client.fetchPage(100, 0).catch((e: unknown) => e);
    expect((err as UpstreamError).retryAfterMs).toBe(7000);
  });

  it('maps network failure to UpstreamError with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const err = await client.fetchPage(100, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).status).toBe(0);
  });

  it('maps an aborted request to a timeout error', async () => {
    const timeoutClient = createUpstreamClient({ RESTCOUNTRIES_API_KEY: 'k', UPSTREAM_TIMEOUT_MS: 10 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const err = await timeoutClient.fetchPage(100, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).message).toContain('timed out');
  });

  it('rejects a malformed envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ nope: true })));
    const err = await client.fetchPage(100, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).message).toContain('envelope');
  });

  it('rejects invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>not json</html>', { status: 200 })),
    );
    const err = await client.fetchPage(100, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).message).toContain('invalid JSON');
  });
});
