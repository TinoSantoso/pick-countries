import { pino } from 'pino';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { UpstreamClient } from '../src/upstream/client.js';
import type { UpstreamPage } from '../src/types.js';
import { fetchAllCountries, MAX_PAGES, PAGE_SIZE, startRefreshLoop } from '../src/upstream/refresh.js';
import { makeCountry } from './fixtures.js';

const log = pino({ level: 'silent' });

function page(objects: unknown[], more = false, total: number | null = objects.length): UpstreamPage {
  return { objects, more, total };
}

function mockClient(): { client: UpstreamClient; fetchPage: Mock } {
  const fetchPage = vi.fn<() => Promise<UpstreamPage>>();
  return { client: { fetchPage }, fetchPage };
}

describe('fetchAllCountries', () => {
  it('merges pages until more=false', async () => {
    const { client, fetchPage } = mockClient();
    fetchPage
      .mockResolvedValueOnce(page([makeCountry({ alpha2: 'AA' })], true, 3))
      .mockResolvedValueOnce(page([makeCountry({ alpha2: 'BB' })], true, 3))
      .mockResolvedValueOnce(page([makeCountry({ alpha2: 'CC' })], false, 3));

    const result = await fetchAllCountries(client, log);

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls.map((c) => c)).toEqual([
      [PAGE_SIZE, 0],
      [PAGE_SIZE, PAGE_SIZE],
      [PAGE_SIZE, 2 * PAGE_SIZE],
    ]);
    expect(result.countries.map((c) => c.codes.alpha_2)).toEqual(['AA', 'BB', 'CC']);
    expect(result.skipped).toBe(0);
  });

  it('dedupes by alpha-2', async () => {
    const { client } = mockClient();
    vi.spyOn(client, 'fetchPage')
      .mockResolvedValueOnce(page([makeCountry({ alpha2: 'AA' })], true, 2))
      .mockResolvedValueOnce(page([makeCountry({ alpha2: 'AA', alpha3: 'AAB' })], false, 2));

    const result = await fetchAllCountries(client, log);
    expect(result.countries).toHaveLength(1);
  });

  it('skips malformed records and reports the count', async () => {
    const { client } = mockClient();
    vi.spyOn(client, 'fetchPage').mockResolvedValue(
      page([makeCountry({ alpha2: 'AA' }), { names: { common: 'Broken' } }], false, 2),
    );

    const result = await fetchAllCountries(client, log);
    expect(result.countries).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('throws when more=true persists past the page cap', async () => {
    const { client } = mockClient();
    vi.spyOn(client, 'fetchPage').mockResolvedValue(page([makeCountry({ alpha2: 'AA' })], true, 999));

    await expect(fetchAllCountries(client, log)).rejects.toThrowError(/exceeds/);
    expect(client.fetchPage).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it('throws when a majority of records fail to parse', async () => {
    const { client } = mockClient();
    vi.spyOn(client, 'fetchPage').mockResolvedValue(
      page([makeCountry({ alpha2: 'AA' }), { garbage: true }, { garbage: 2 }, { garbage: 3 }], false, 4),
    );

    await expect(fetchAllCountries(client, log)).rejects.toThrowError(/shape may have changed/);
  });

  it('throws when zero records are valid', async () => {
    const { client } = mockClient();
    vi.spyOn(client, 'fetchPage').mockResolvedValue(page([{ garbage: true }], false, 1));

    await expect(fetchAllCountries(client, log)).rejects.toThrowError(/zero valid/);
  });
});

describe('startRefreshLoop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes immediately, then on the TTL, and backs off after a failure', async () => {
    vi.useFakeTimers();
    const { client, fetchPage } = mockClient();
    const onRefresh = vi.fn();
    fetchPage
      .mockResolvedValueOnce(page([makeCountry()], false, 1))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(page([makeCountry()], false, 1));

    const loop = startRefreshLoop({ client, onRefresh, ttlMs: 1_000, log });

    await vi.advanceTimersByTimeAsync(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000); // TTL fires, fetch fails
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000); // backoff retry succeeds
    expect(onRefresh).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it('stop() prevents further refreshes', async () => {
    vi.useFakeTimers();
    const { client, fetchPage } = mockClient();
    fetchPage.mockResolvedValue(page([makeCountry()], false, 1));
    const onRefresh = vi.fn();

    const loop = startRefreshLoop({ client, onRefresh, ttlMs: 1_000, log });
    await vi.advanceTimersByTimeAsync(1);
    loop.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
