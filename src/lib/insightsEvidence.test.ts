/**
 * AI Insights evidence-pack tests.
 * Pins the deterministic contract: everything the AI may cite is computed
 * on-device from real records; unresolvable evidence citations are dropped;
 * fallback cards derive only from entries that carry numbers.
 */
import { describe, it, expect } from 'vitest';
import { buildEvidencePack, windowPerf } from './insightsEvidence';
import { deterministicFallbackCards } from './insights';
import type { Asset, ValuationRecord } from './types';

const NOW = new Date('2026-11-01T12:00:00Z');

function makeAsset(over: Partial<Asset> & { id?: string; value?: number; valuationUpdatedAt?: string | null } = {}): Asset {
  const id = over.id ?? 'a1';
  return {
    id,
    userId: 'u1',
    category: over.category ?? 'gold_silver',
    name: over.name ?? 'Gold coin',
    status: over.status ?? 'active',
    attributes: {
      metal: 'gold',
      form: 'bullion',
      weight: 10,
      weightUnit: 'g',
      purity: '999.9',
    } as Asset['attributes'],
    purchase: over.purchase ?? { priceLkr: 200_000, date: null, extraCostsLkr: null },
    valuation: {
      valueLkr: over.value ?? 260_000,
      method: 'user',
      sourceLabel: 'user',
      confidence: 'high',
      updatedAt: over.valuationUpdatedAt ?? NOW.toISOString(),
    },
    sold: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  } as Asset;
}

function rec(assetId: string, valueLkr: number, recordedAt: string): ValuationRecord {
  return {
    id: `${assetId}-${recordedAt}`,
    assetId,
    userId: 'u1',
    valueLkr,
    method: 'user',
    sourceLabel: 'user',
    confidence: 'high',
    note: null,
    recordedAt,
  };
}

describe('windowPerf', () => {
  it('reports no_records with zero holdings when there is no history', () => {
    const p = windowPerf([makeAsset()], [], NOW.toISOString(), false);
    expect(p.status).toBe('no_records');
    expect(p.comparedCount).toBe(0);
  });

  it('compares latest vs in-window baseline and excludes holdings whose baseline predates the cutoff', () => {
    const a1 = makeAsset({ id: 'a1' });
    const a2 = makeAsset({ id: 'a2', value: 100_000, name: 'Silver bar', attributes: { metal: 'silver' } as Asset['attributes'] });
    const assets = [a1, a2];
    const cutoff = '2026-10-26T00:00:00Z'; // float: Oct 26 before Nov 1
    const records = [
      rec('a1', 250_000, '2026-10-25T00:00:00Z'), // ≤ cutoff → valid baseline
      rec('a1', 260_000, NOW.toISOString()), // latest
      rec('a2', 95_000, '2026-10-31T00:00:00Z'), // after cutoff → excluded holding
      rec('a2', 100_000, '2026-11-01T00:00:00Z'),
    ];
    const p = windowPerf(assets, records, cutoff, false);
    expect(p.status).toBe('ok');
    expect(p.comparedCount).toBe(1); // only a1 has a baseline at/before cutoff
    expect(p.excludedCount).toBe(1); // a2's baseline is after the cutoff
    expect(p.baselineValue).toBe(250_000);
    expect(p.currentValue).toBe(260_000);
    expect(p.deltaPct).toBeCloseTo(10_000 / 250_000, 10);
  });
});

describe('buildEvidencePack', () => {
  const assets = [makeAsset({ id: 'a1' }), makeAsset({ id: 'a2', value: 150_000, name: 'Land', category: 'land_property', attributes: { sizePerches: 20 } as Asset['attributes'] })];

  it('computes totals strictly from the supplied assets', () => {
    const pack = buildEvidencePack({ assets, records: [], market: null, history: [], period: '30d' });
    const totals = pack.entries.find((e) => e.id === 'ev_portfolio_totals')!;
    expect(totals).toBeDefined();
    expect(totals.numbers).toContainEqual({ label: 'Active assets', value: '2' });
    expect(totals.numbers).toContainEqual({ label: 'Valued', value: '2' });
    expect(totals.numbers).toContainEqual({ label: 'Total estimated value', value: 'LKR 410,000' });
  });

  it('adds an unrealised (not realised) cost comparison when cost exists', () => {
    const pack = buildEvidencePack({ assets, records: [], market: null, history: [], period: '30d' });
    const gain = pack.entries.find((e) => e.id === 'ev_net_gain')!;
    expect(gain).toBeDefined();
    expect(gain.title).toMatch(/unrealised valuation change, not realised profit/);
    expect(gain.coverage).toMatch(/Unrealised/);
  });

  it('reports no in-window baseline honestly when nothing is recorded at/before the cutoff', () => {
    // Mid-window stamp (3.5 days back) so the record always lies just AFTER the
    // 7-day cutoff regardless of when vitest runs — a fixed calendar date made
    // this test time-dependent.
    const records = [rec('a1', 240_000, new Date(Date.now() - 3.5 * 24 * 60 * 60 * 1000).toISOString())];
    const pack = buildEvidencePack({ assets, records, market: null, history: [], period: '7d' });
    const perf = pack.entries.find((e) => e.id === 'ev_period_perf')!;
    expect(perf.title).toMatch(/No recorded valuation baseline inside the 7 days window/);
  });

  it('emits metal entries for user holdings and concentration for categories', () => {
    const pack = buildEvidencePack({ assets, records: [], market: null, history: [], period: '30d' });
    const xau = pack.entries.find((e) => e.id === 'ev_metal_XAU');
    expect(xau).toBeDefined();
    expect(xau!.coverage).toMatch(/not reliably computable/); // thin observation caveat
    const conc = pack.entries.find((e) => e.id === 'ev_concentration');
    expect(conc).toBeDefined();
    // gold 260k / total 410k ≈ 63.4% → gold is the largest allocation
    expect(conc!.numbers.map((n) => n.label)).toContainEqual('Largest allocation (Gold & Silver (metals))');
    const alloc = pack.entries.find((e) => e.id === 'ev_alloc_gold_silver');
    expect(alloc).toBeDefined();
    expect(alloc!.numbers.map((n) => n.value)).toContainEqual('63.4%');
  });

  it('reports stale valuations only after the 30-day threshold', () => {
    // fresh-only portfolio → no staleness entry
    const freshOnly = buildEvidencePack({ assets, records: [], market: null, history: [], period: '30d' });
    expect(freshOnly.entries.find((e) => e.id === 'ev_stale_valuations')).toBeUndefined();

    // stale (61-day-old) valuation → staleness entry with the count
    const staleAsset = makeAsset({ id: 'stale', valuationUpdatedAt: '2026-09-01T00:00:00Z' });
    const pack = buildEvidencePack({ assets: [staleAsset], records: [], market: null, history: [], period: '30d' });
    const staleEntry = pack.entries.find((e) => e.id === 'ev_stale_valuations');
    expect(staleEntry).toBeDefined();
    expect(staleEntry!.numbers.map((n) => n.value)).toContainEqual('1');
  });
});

describe('deterministicFallbackCards', () => {
  it('derives cards only from entries with numbers and includes the overview header', () => {
    const pack = buildEvidencePack({ assets: [makeAsset()], records: [], market: null, history: [], period: '30d' });
    const cards = deterministicFallbackCards(pack);
    expect(cards[0].category).toBe('portfolio_overview');
    for (const c of cards.slice(1)) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.indicator).toMatch(/positive|negative|neutral/);
    }
  });
});
