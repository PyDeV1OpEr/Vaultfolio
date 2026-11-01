import { describe, expect, it } from 'vitest';
import {
  assetValuationDelta,
  computePortfolioPerformance,
  countStaleValuations,
  localInsightCards,
  metalMoves,
  portfolioMovers,
  valuationFreshness,
} from './insightsExtras';
import type { Asset, GoldSilverAttrs, ValuationRecord } from './types';
import type { PriceObservation } from './marketWatch';

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

function goldAsset(id: string, over: Partial<Asset> = {}): Asset {
  const attrs: GoldSilverAttrs = {
    metal: 'gold',
    form: 'coin',
    weight: 10,
    weightUnit: 'g',
    purity: '24k',
  };
  return {
    id,
    userId: 'u1',
    category: 'gold_silver',
    name: `Asset ${id}`,
    status: 'active',
    attributes: attrs,
    purchase: { priceLkr: 100_000, currency: 'LKR', priceOriginal: 100_000, date: iso(100).slice(0, 10) },
    valuation: { valueLkr: 100_000, method: 'user', sourceLabel: 'test', confidence: 'medium', updatedAt: iso(5) },
    createdAt: iso(100),
    updatedAt: iso(5),
    ...over,
  } as Asset;
}

function rec(assetId: string, daysAgo: number, valueLkr: number, method: ValuationRecord['method'] = 'user'): ValuationRecord {
  return {
    id: `r-${assetId}-${daysAgo}-${valueLkr}`,
    assetId,
    userId: 'u1',
    valueLkr,
    method,
    sourceLabel: 'test',
    confidence: 'medium',
    recordedAt: iso(daysAgo),
  };
}

describe('computePortfolioPerformance', () => {
  it('computes 30-day percent delta purely from recorded valuation history', () => {
    const assets = [goldAsset('a', { status: 'active' })];
    const records = [rec('a', 40, 100_000), rec('a', 2, 110_000)];
    const perf = computePortfolioPerformance(assets, records, '30d');
    expect(perf.status).toBe('ok');
    expect(perf.deltaPct).not.toBeNull();
    expect(perf.deltaPct!).toBeCloseTo(0.1, 5);
    expect(perf.baselineValue).toBe(100_000);
    expect(perf.currentValue).toBe(110_000);
  });

  it('excludes assets purchased inside the window from the comparison honestly', () => {
    const assets = [goldAsset('a'), goldAsset('b')];
    const records = [rec('a', 40, 100_000), rec('a', 2, 110_000), rec('b', 2, 50_000)];
    const perf = computePortfolioPerformance(assets, records, '30d');
    expect(perf.status).toBe('ok');
    expect(perf.comparedCount).toBe(1);
    expect(perf.excludedCount).toBe(1);
    expect(perf.baselineValue).toBe(100_000); // only asset a was priced at the cutoff
    expect(perf.currentValue).toBe(110_000);
  });

  it('returns no_baseline when nothing was recorded before the cutoff', () => {
    const assets = [goldAsset('a')];
    const records = [rec('a', 2, 110_000)];
    const perf = computePortfolioPerformance(assets, records, '30d');
    expect(perf.status).toBe('no_baseline');
    expect(perf.deltaPct).toBeNull();
    expect(perf.excludedCount).toBe(1);
  });

  it('never invents data when the vault has no records at all', () => {
    const perf = computePortfolioPerformance([goldAsset('a')], [], 'all');
    expect(perf.status).toBe('no_records');
    expect(perf.deltaPct).toBeNull();
    expect(perf.currentValue).toBeNull();
  });

  it('uses the full history window for "all"', () => {
    const assets = [goldAsset('a')];
    const records = [rec('a', 400, 50_000), rec('a', 100, 80_000), rec('a', 1, 90_000)];
    const perf = computePortfolioPerformance(assets, records, 'all');
    expect(perf.status).toBe('ok');
    expect(perf.baselineValue).toBe(50_000);
    expect(perf.currentValue).toBe(90_000);
  });
});

describe('assetValuationDelta / portfolioMovers', () => {
  it('returns null when fewer than 2 recorded valuations exist', () => {
    expect(assetValuationDelta([rec('a', 1, 100)])).toBeNull();
  });

  it('identifies the most recent pair, newest first', () => {
    const delta = assetValuationDelta([rec('a', 30, 100), rec('a', 20, 120), rec('a', 10, 90)]);
    expect(delta?.last.valueLkr).toBe(90);
    expect(delta?.prev.valueLkr).toBe(120);
  });

  it('movers list both gainers and decliners, skipping single-record assets', () => {
    const assets = [goldAsset('a'), goldAsset('b'), goldAsset('c')];
    const records = [
      rec('a', 40, 100_000), rec('a', 2, 120_000),
      rec('b', 40, 100_000), rec('b', 3, 80_000),
      rec('c', 10, 50_000),
    ];
    const movers = portfolioMovers(assets, records);
    expect(movers.map((m) => m.id)).toEqual(['a', 'b']);
    expect(movers[0].pct).not.toBeNull();
    expect(movers[0].pct! > 0).toBe(true);
    expect(movers[1].pct! < 0).toBe(true);
  });
});

describe('metalMoves', () => {
  function obs(metal: PriceObservation['metal'], daysAgo: number, price: number): PriceObservation {
    return {
      id: `obs-${metal}-${daysAgo}`,
      metal,
      price,
      currency: 'USD',
      unit: 'troy_ounce',
      quoteType: 'spot',
      providerId: 'goldapicom',
      providerTimestamp: iso(daysAgo),
      retrievedAt: iso(daysAgo),
      change: null,
      changePct: null,
      providerFresh: true,
      exchangeLabel: 'test',
      pricePerGramUsd: null,
    };
  }

  it('computes percent change from the first and last real observation', () => {
    const moves = metalMoves([obs('XAU', 10, 2000), obs('XAU', 2, 2200), obs('XAG', 10, 30)]);
    expect(moves).toHaveLength(1); // XAG has a single point → excluded honestly
    expect(moves[0].code).toBe('XAU');
    expect(moves[0].pct).toBeCloseTo(0.1, 5);
    expect(moves[0].observationCount).toBe(2);
  });
});

describe('freshness + local insight cards', () => {
  it('buckets valuation ages into fresh/aged/stale without inventing dates', () => {
    const assets = [goldAsset('a'), goldAsset('b'), goldAsset('c')];
    const withAges = assets.map((a, i) => ({
      ...a,
      valuation: { ...a.valuation, updatedAt: iso(i === 0 ? 3 : i === 1 ? 20 : 90) },
    }));
    const rows = valuationFreshness(withAges);
    expect(rows.map((r) => r.bucket)).toEqual(['stale', 'aged', 'fresh']);
    expect(rows[0].daysAgo).toBe(90);
    expect(countStaleValuations(withAges)).toBe(1);
  });

  it('cards stay honest when history is empty', () => {
    const cards = localInsightCards({
      perf: computePortfolioPerformance([], [], '30d'),
      movers: [],
      totals: { totalValuedLkr: 0, valuedCount: 0, activeCount: 1, unvaluedCount: 1 },
      staleCount: 0,
      metalMoves: [],
    });
    expect(cards.some((c) => c.id === 'perf' && /no recorded valuation/i.test(c.body))).toBe(true);
    expect(cards.some((c) => c.id === 'unvalued')).toBe(true);
  });

  it('cards report direction movers and metal drivers when data exists', () => {
    const assets = [goldAsset('a')];
    const records = [rec('a', 40, 100_000, 'user'), rec('a', 2, 130_000, 'recent_market')];
    const perf = computePortfolioPerformance(assets, records, '30d');
    const movers = portfolioMovers(assets, records);
    const cards = localInsightCards({
      perf,
      movers,
      totals: { totalValuedLkr: 130_000, valuedCount: 1, activeCount: 1, unvaluedCount: 0 },
      staleCount: 0,
      metalMoves: [],
    });
    const topMover = cards.find((c) => c.id === 'top-mover');
    expect(topMover).toBeDefined();
    expect(topMover!.tone).toBe('positive');
    expect(topMover!.body).toContain('+30.0%');
  });
});
