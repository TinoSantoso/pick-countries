import type { Country } from '../types.js';

export class SnapshotStore {
  private countries: readonly Country[] = [];
  private byCode = new Map<string, Country>();
  private fetchedAt: number | null = null;

  /** Atomically replaces the snapshot and rebuilds the code index. */
  swap(countries: Country[], fetchedAt: number): void {
    const index = new Map<string, Country>();
    for (const country of countries) {
      const { alpha_2, alpha_3, cioc } = country.codes;
      // First-wins: alpha-2/alpha-3 never collide with each other; CIOC sometimes repeats an alpha-3.
      for (const code of [alpha_2, alpha_3, cioc]) {
        if (code === undefined) continue;
        const key = code.toUpperCase();
        if (!index.has(key)) index.set(key, country);
      }
    }
    this.countries = countries;
    this.byCode = index;
    this.fetchedAt = fetchedAt;
  }

  get all(): readonly Country[] {
    return this.countries;
  }

  get count(): number {
    return this.countries.length;
  }

  getByCode(code: string): Country | undefined {
    return this.byCode.get(code.toUpperCase());
  }

  get ready(): boolean {
    return this.fetchedAt !== null;
  }

  get fetchedAtMs(): number | null {
    return this.fetchedAt;
  }

  isStale(nowMs: number, ttlMs: number): boolean {
    if (this.fetchedAt === null) return true;
    return nowMs - this.fetchedAt > ttlMs;
  }
}
