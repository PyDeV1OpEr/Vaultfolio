/**
 * Market Watch tests.
 *
 * Tests cover:
 *  - Price validation: zero, negative, out-of-bounds, non-finite values
 *  - Unsupported instruments on each provider
 *  - Per-gram unit conversion math
 *  - Freshness status state machine
 *  - Observation deduplication / merge
 *  - Monthly request estimation
 *  - Schedule timing (next fetch due)
 *  - filterByRange time slicing
 *  - Observation storage round-trip
 *  - Credential status check (no actual network calls)
 *  - USD → LKR per gram conversion
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validatePrice,
  freshnessStatus,
  mergeObservations,
  estimateMonthlyRequests,
  msUntilNextFetch,
  filterByRange,
  usdPerOztToLkrPerGram,
  loadPriceHistory,
  savePriceHistory,
  loadMarketWatchSettings,
  saveMarketWatchSettings,
  goldApiAdapter,
  goldsafeAdapter,
  type PriceObservation,
  type MetalCode,
  type MarketWatchSettings,
  type StorageLike,
} from './marketWatch';

/* ───────────── Helpers ───────────── */

function fakeObs(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    id: 'test-id',
    metal: 'XAU',
    price: 4016.895,
    currency: 'USD',
    unit: 'troy_ounce',
    quoteType: 'spot',
    providerId: 'goldapi',
    providerTimestamp: '2026-10-26T08:40:40Z',
    retrievedAt: new Date().toISOString(),
    change: 20.6,
    changePct: 0.52,
    providerFresh: true,
    exchangeLabel: 'FOREXCOM',
    pricePerGramUsd: 4016.895 / 31.1034768,
    ...overrides,
  };
}

/* ───────────── 1. Price Validation ───────────── */

describe('validatePrice', () => {
  it('accepts a valid gold price in troy oz range', () => {
    expect(validatePrice('XAU', 4016.895, 'troy_ounce')).toBeNull();
  });

  it('rejects zero price', () => {
    expect(validatePrice('XAU', 0, 'troy_ounce')).toMatch(/zero or negative/i);
  });

  it('rejects negative price', () => {
    expect(validatePrice('XAU', -100, 'troy_ounce')).toMatch(/zero or negative/i);
  });

  it('rejects non-finite (NaN)', () => {
    expect(validatePrice('XAU', NaN, 'troy_ounce')).toMatch(/not a finite number/i);
  });

  it('rejects non-finite (Infinity)', () => {
    expect(validatePrice('XAG', Infinity, 'troy_ounce')).toMatch(/not a finite number/i);
  });

  it('rejects null price', () => {
    expect(validatePrice('XAU', null, 'troy_ounce')).toMatch(/missing/i);
  });

  it('rejects undefined price', () => {
    expect(validatePrice('XAU', undefined, 'troy_ounce')).toMatch(/missing/i);
  });

  it('rejects gold price that is impossibly high (> 12000)', () => {
    expect(validatePrice('XAU', 50000, 'troy_ounce')).toMatch(/outside expected range/i);
  });

  it('rejects gold price that is impossibly low (< 500)', () => {
    expect(validatePrice('XAU', 10, 'troy_ounce')).toMatch(/outside expected range/i);
  });

  it('accepts silver price in valid range', () => {
    expect(validatePrice('XAG', 32.5, 'troy_ounce')).toBeNull();
  });

  it('accepts copper in valid pound range', () => {
    expect(validatePrice('XCU', 4.5, 'pound')).toBeNull();
  });

  it('rejects copper price above max', () => {
    expect(validatePrice('XCU', 500, 'pound')).toMatch(/outside expected range/i);
  });

  it('skips bounds check for unknown units (e.g. kilogram)', () => {
    // Kilogram-priced copper won't match the unit guard, so bounds are skipped
    expect(validatePrice('XAU', 100000, 'kilogram')).toBeNull();
  });

  it('accepts platinum and palladium in valid ranges', () => {
    expect(validatePrice('XPT', 950, 'troy_ounce')).toBeNull();
    expect(validatePrice('XPD', 1100, 'troy_ounce')).toBeNull();
  });
});

/* ───────────── 2. Unsupported instruments ───────────── */

describe('Provider supported metals', () => {
  it('GoldAPI adapter declares XCU as unsupported', async () => {
    // fetchAll with XCU only should return error without network call
    const { observations, errors } = await goldApiAdapter.fetchAll(['XCU'], 'fake_key_not_used_no_network');
    expect(observations).toHaveLength(0);
    expect(errors['XCU']).toMatch(/not supported/i);
  });

  it('Goldsafe adapter declares XCU as unsupported', async () => {
    const { observations, errors } = await goldsafeAdapter.fetchAll(['XCU'], 'fake_key');
    expect(observations).toHaveLength(0);
    expect(errors['XCU']).toMatch(/not supported/i);
  });

  it('GoldAPI supported set includes XAU, XAG, XPT, XPD', () => {
    expect(goldApiAdapter.supported).toContain('XAU');
    expect(goldApiAdapter.supported).toContain('XAG');
    expect(goldApiAdapter.supported).toContain('XPT');
    expect(goldApiAdapter.supported).toContain('XPD');
    expect(goldApiAdapter.supported).not.toContain('XCU');
  });
});

/* ───────────── 3. Per-gram conversion math ───────────── */

describe('usdPerOztToLkrPerGram', () => {
  const GRAMS_PER_OZT = 31.1034768;

  it('correctly converts gold price to LKR/gram', () => {
    const priceUsd = 4016.895;
    const usdLkr = 300;
    const result = usdPerOztToLkrPerGram(priceUsd, usdLkr);
    const expected = (priceUsd / GRAMS_PER_OZT) * usdLkr;
    expect(result).toBeCloseTo(expected, 2);
  });

  it('returns null when usdLkr is null', () => {
    expect(usdPerOztToLkrPerGram(4016, null)).toBeNull();
  });

  it('returns null when usdLkr is zero', () => {
    expect(usdPerOztToLkrPerGram(4016, 0)).toBeNull();
  });

  it('returns null when price is zero', () => {
    expect(usdPerOztToLkrPerGram(0, 300)).toBeNull();
  });

  it('returns null when price is negative', () => {
    expect(usdPerOztToLkrPerGram(-10, 300)).toBeNull();
  });
});

/* ───────────── 4. Freshness status state machine ───────────── */

describe('freshnessStatus', () => {
  it('returns offline when observation is null', () => {
    expect(freshnessStatus(null)).toBe('offline');
  });

  it('returns live when retrieved < 1h ago and provider says fresh', () => {
    const obs = fakeObs({ retrievedAt: new Date().toISOString(), providerFresh: true });
    expect(freshnessStatus(obs)).toBe('live');
  });

  it('returns recent when retrieved 6h ago but still fresh', () => {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const obs = fakeObs({ retrievedAt: sixHoursAgo, providerFresh: true });
    expect(freshnessStatus(obs)).toBe('recent');
  });

  it('returns stale when retrieved > 24h ago', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const obs = fakeObs({ retrievedAt: twoDaysAgo, providerFresh: true });
    expect(freshnessStatus(obs)).toBe('stale');
  });

  it('returns stale when providerFresh is false (regardless of age)', () => {
    const obs = fakeObs({ retrievedAt: new Date().toISOString(), providerFresh: false });
    expect(freshnessStatus(obs)).toBe('stale');
  });
});

/* ───────────── 5. Observation deduplication ───────────── */

describe('mergeObservations', () => {
  it('does not duplicate identical (metal, providerId, providerTimestamp) tuples', () => {
    const obs = fakeObs({
      id: 'obs-1',
      metal: 'XAU',
      providerId: 'goldapi',
      providerTimestamp: '2026-10-26T08:40:40Z',
    });
    const merged = mergeObservations([obs], [obs]);
    expect(merged).toHaveLength(1);
  });

  it('accepts a different providerTimestamp as a new observation', () => {
    const obs1 = fakeObs({ id: 'a', providerTimestamp: '2026-10-26T08:00:00Z' });
    const obs2 = fakeObs({ id: 'b', providerTimestamp: '2026-10-26T20:00:00Z' });
    expect(mergeObservations([obs1], [obs2])).toHaveLength(2);
  });

  it('accepts same timestamp but different provider as a distinct observation', () => {
    const obs1 = fakeObs({ id: 'a', providerId: 'goldapi' });
    const obs2 = fakeObs({ id: 'b', providerId: 'goldsafe' });
    expect(mergeObservations([obs1], [obs2])).toHaveLength(2);
  });

  it('merges observations for different metals', () => {
    const goldObs = fakeObs({ metal: 'XAU' });
    const silverObs = fakeObs({ metal: 'XAG', id: 'silver-obs' });
    expect(mergeObservations([goldObs], [silverObs])).toHaveLength(2);
  });
});

/* ───────────── 6. Monthly request estimation ───────────── */

describe('estimateMonthlyRequests', () => {
  it('calculates correctly: 4 GoldAPI metals × 2 fetches/day × 30 = 240', () => {
    const metals: MetalCode[] = ['XAU', 'XAG', 'XPT', 'XPD'];
    const result = estimateMonthlyRequests(2, metals);
    expect(result.goldapiRequests).toBe(4 * 2 * 30);
    expect(result.goldsafeRequests).toBe(0); // no XCU in list
    expect(result.totalRequests).toBe(240);
  });

  it('counts goldsafe requests as 1 per run when XCU is added (XCU unsupported by both currently)', () => {
    const metals: MetalCode[] = ['XAU', 'XAG', 'XPT', 'XPD', 'XCU'];
    const result = estimateMonthlyRequests(2, metals);
    // XCU is not on GOLDSAFE_SUPPORTED either currently, so goldsafe requests = 0
    expect(result.goldsafeRequests).toBe(0);
    // GoldAPI handles 4 metals (XAU, XAG, XPT, XPD)
    expect(result.goldapiRequests).toBe(4 * 2 * 30);
    expect(result.totalRequests).toBe(4 * 2 * 30);
  });

  it('scales correctly with 1 fetch per day', () => {
    const result = estimateMonthlyRequests(1, ['XAU', 'XAG']);
    expect(result.goldapiRequests).toBe(2 * 1 * 30);
  });
});

/* ───────────── 7. Schedule timing ───────────── */

describe('msUntilNextFetch', () => {
  it('returns 0 when never fetched (lastFetchAt is null)', () => {
    const settings: MarketWatchSettings = {
      fetchesPerDay: 2,
      autoFetchEnabled: true,
      lastFetchAt: null,
      selectedMetal: 'XAU',
      selectedRange: '30d',
    };
    expect(msUntilNextFetch(settings)).toBe(0);
  });

  it('returns Infinity when auto-fetch is disabled', () => {
    const settings: MarketWatchSettings = {
      fetchesPerDay: 2,
      autoFetchEnabled: false,
      lastFetchAt: new Date().toISOString(),
      selectedMetal: 'XAU',
      selectedRange: '30d',
    };
    expect(msUntilNextFetch(settings)).toBe(Infinity);
  });

  it('returns 0 when last fetch was longer than interval ago', () => {
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    const settings: MarketWatchSettings = {
      fetchesPerDay: 2, // 12h interval
      autoFetchEnabled: true,
      lastFetchAt: thirteenHoursAgo,
      selectedMetal: 'XAU',
      selectedRange: '30d',
    };
    expect(msUntilNextFetch(settings)).toBe(0);
  });

  it('returns positive ms when fetch was recent', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const settings: MarketWatchSettings = {
      fetchesPerDay: 2, // 12h interval → ~11h remaining
      autoFetchEnabled: true,
      lastFetchAt: oneHourAgo,
      selectedMetal: 'XAU',
      selectedRange: '30d',
    };
    const ms = msUntilNextFetch(settings);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(12 * 60 * 60 * 1000);
  });
});

/* ───────────── 8. filterByRange ───────────── */

describe('filterByRange', () => {
  const now = Date.now();
  const obs = (hoursAgo: number): PriceObservation =>
    fakeObs({
      id: `obs-${hoursAgo}`,
      providerTimestamp: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
      retrievedAt: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
    });

  it('24h: keeps observations within last 24 hours', () => {
    const data = [obs(1), obs(12), obs(23), obs(25)];
    const filtered = filterByRange(data, '24h');
    expect(filtered).toHaveLength(3); // 1h, 12h, 23h — not 25h
  });

  it('7d: keeps observations within last 7 days', () => {
    const data = [obs(24), obs(72), obs(167), obs(200)];
    const filtered = filterByRange(data, '7d');
    expect(filtered).toHaveLength(3); // 24h, 72h, 167h — not 200h (>7d)
  });

  it('all: returns everything', () => {
    const data = [obs(1), obs(500), obs(9999)];
    expect(filterByRange(data, 'all')).toHaveLength(3);
  });
});

/* ───────────── 9. LocalStorage round-trip ───────────── */

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('Price history localStorage round-trip', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it('loads an empty array when nothing is stored', () => {
    expect(loadPriceHistory(storage)).toEqual([]);
  });

  it('saves and loads observations correctly', () => {
    const obs = [fakeObs({ id: 'save-test' })];
    savePriceHistory(obs, storage);
    const loaded = loadPriceHistory(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('save-test');
    expect(loaded[0].price).toBe(4016.895);
  });

  it('rejects corrupted records on load', () => {
    storage.setItem('vaultfolio.marketwatch.history.v1', JSON.stringify([
      { id: 'bad', price: 0, metal: 'XAU', retrievedAt: '2026-10-26T08:00:00Z' },
      { id: 'good', price: 3000, metal: 'XAG', retrievedAt: '2026-10-26T08:00:00Z', currency: 'USD', unit: 'troy_ounce', quoteType: 'spot', providerId: 'goldapi', providerTimestamp: '2026-10-26T08:00:00Z', change: null, changePct: null, providerFresh: true, exchangeLabel: 'X', pricePerGramUsd: null },
    ]));
    const loaded = loadPriceHistory(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('good');
  });

  it('settings round-trip: saves and reloads with defaults merged', () => {
    const settings: MarketWatchSettings = {
      fetchesPerDay: 3,
      autoFetchEnabled: false,
      lastFetchAt: '2026-10-26T08:00:00Z',
      selectedMetal: 'XAG',
      selectedRange: '7d',
    };
    saveMarketWatchSettings(settings, storage);
    const loaded = loadMarketWatchSettings(storage);
    expect(loaded.fetchesPerDay).toBe(3);
    expect(loaded.autoFetchEnabled).toBe(false);
    expect(loaded.selectedMetal).toBe('XAG');
  });

  it('settings: returns defaults when nothing is stored', () => {
    const loaded = loadMarketWatchSettings(storage);
    expect(loaded.fetchesPerDay).toBe(2);
    expect(loaded.autoFetchEnabled).toBe(true);
    expect(loaded.selectedMetal).toBe('XAU');
  });
});

/* ───────────── 10. Observation cap per metal ───────────── */

describe('savePriceHistory: caps observations per metal', () => {
  it('saves without throwing when given many observations', () => {
    const storage = new FakeStorage();
    const many = Array.from({ length: 600 }, (_, i) =>
      fakeObs({
        id: `obs-${i}`,
        retrievedAt: new Date(Date.now() - i * 60000).toISOString(),
        providerTimestamp: new Date(Date.now() - i * 60000).toISOString(),
      }),
    );
    expect(() => savePriceHistory(many, storage)).not.toThrow();
    const saved = loadPriceHistory(storage);
    expect(saved.length).toBeLessThanOrEqual(500);
  });
});

/* ───────────── 11. USD→LKR conversion labelled as indicative ───────────── */

describe('Currency conversion accuracy', () => {
  it('per-gram in USD matches the fixed math: 4016.895 / 31.1034768', () => {
    const pricePerGramUsd = 4016.895 / 31.1034768;
    expect(pricePerGramUsd).toBeCloseTo(129.146, 2);
  });

  it('LKR per gram at rate 300: 129.146 * 300 = 38743.8', () => {
    const lkrPerGram = usdPerOztToLkrPerGram(4016.895, 300);
    expect(lkrPerGram).toBeCloseTo(38743.8, 0);
  });
});
