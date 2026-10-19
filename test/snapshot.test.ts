import { describe, expect, it } from 'vitest';
import { SnapshotStore } from '../src/cache/snapshot.js';
import { makeCountry } from './fixtures.js';

describe('SnapshotStore', () => {
  it('is empty and not ready before the first swap', () => {
    const store = new SnapshotStore();
    expect(store.ready).toBe(false);
    expect(store.count).toBe(0);
    expect(store.getByCode('AA')).toBeUndefined();
    expect(store.fetchedAtMs).toBeNull();
  });

  it('indexes by alpha-2, alpha-3 and CIOC, case-insensitively', () => {
    const store = new SnapshotStore();
    const country = makeCountry({ alpha2: 'ca', alpha3: 'CAN', cioc: 'CAN' });
    store.swap([country], 1000);

    expect(store.ready).toBe(true);
    expect(store.count).toBe(1);
    expect(store.getByCode('ca')).toBe(country);
    expect(store.getByCode('Ca')).toBe(country);
    expect(store.getByCode('can')).toBe(country);
    expect(store.getByCode('CAN')).toBe(country);
    expect(store.getByCode('ZZ')).toBeUndefined();
  });

  it('keeps the first country on code collisions', () => {
    const store = new SnapshotStore();
    const first = makeCountry({ alpha2: 'AA', alpha3: 'XYZ' });
    const second = makeCountry({ alpha2: 'BB', alpha3: 'BBB', cioc: 'XYZ' });
    store.swap([first, second], 1000);

    expect(store.getByCode('xyz')).toBe(first);
    expect(store.getByCode('bbb')).toBe(second);
  });

  it('reports staleness against the TTL', () => {
    const store = new SnapshotStore();
    const ttlMs = 1_000;
    expect(store.isStale(2_000, ttlMs)).toBe(true); // nothing loaded yet

    store.swap([makeCountry()], 5_000);
    expect(store.isStale(5_999, ttlMs)).toBe(false);
    expect(store.isStale(6_000, ttlMs)).toBe(false); // exactly at TTL
    expect(store.isStale(6_001, ttlMs)).toBe(true);
  });
});
