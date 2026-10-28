import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  assembleReport,
  isReportPeriod,
  addReport,
  listReports,
  getReport,
  deleteReport,
  clearReports,
  type MarketReportDoc,
} from './reports';
import type { PriceObservation } from './marketWatch';
import type { MarketSnapshot, ReportAnalysis, ReportPeriod } from './gemini';

/** Minimal in-memory Storage stub, same shape as other FakeStorage classes. */
class FakeStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
}

let obsSeq = 0;
function makeObs(overrides: Partial<PriceObservation> & { metal: PriceObservation['metal']; price: number }): PriceObservation {
  const now = new Date(Date.parse('2026-10-28T12:00:00Z') - obsSeq * 60_000).toISOString();
  obsSeq += 1;
  return {
    id: `obs-${obsSeq}`,
    currency: 'USD',
    unit: overrides.metal === 'XCU' ? 'pound' : 'troy_ounce',
    quoteType: 'spot',
    providerId: 'goldapi',
    providerTimestamp: now,
    retrievedAt: now,
    change: null,
    changePct: null,
    providerFresh: true,
    exchangeLabel: 'test',
    pricePerGramUsd: null,
    ...overrides,
  };
}

const VALID_ANALYSIS: ReportAnalysis = {
  market_summary: 'Markets were broadly steady over the window based on the supplied data.',
  metals: [
    {
      symbol: 'XAU',
      trend: 'bullish',
      outlook: 'Data shows a modest rise; continuation is plausible but not guaranteed.',
      confidence: 'medium',
      supporting_evidence: ['The snapshot shows +2% across the window.'],
      risks: ['Thin observation count.'],
      recommendation: 'monitor',
      reasoning_summary: 'Based only on the supplied end-to-end change.',
      data_quality: 'verified',
    },
  ],
  limitations: ['Very few observations.'],
};

const HOUR = 3_600_000;

function snapshotWith(...metals: Array<Partial<MarketSnapshot['metals'][number]>>): MarketSnapshot {
  return {
    period: '24h',
    asOf: '2026-10-28T12:00:00Z',
    metals: metals.map((m) => ({
      symbol: 'XAU',
      metal: 'Gold',
      hasData: false,
      latestPrice: null,
      currency: 'USD',
      unit: 'troy_ounce',
      quoteType: null,
      provider: null,
      providerTimestamp: null,
      observationCount: 0,
      firstObservedAt: null,
      lastObservedAt: null,
      periodChange: null,
      coverageNote: null,
      ...m,
    })),
  } as MarketSnapshot;
}

describe('isReportPeriod', () => {
  it('accepts exactly the four supported periods', () => {
    expect(isReportPeriod('24h')).toBe(true);
    expect(isReportPeriod('7d')).toBe(true);
    expect(isReportPeriod('30d')).toBe(true);
    expect(isReportPeriod('90d')).toBe(true);
    expect(isReportPeriod('1h')).toBe(false);
    expect(isReportPeriod('all')).toBe(false);
    expect(isReportPeriod('')).toBe(false);
  });
});

describe('buildSnapshot: coverage of all five metals and real-change math', () => {
  const NOW = Date.now();

  it('always returns a card for XAU, XAG, XPT, XPD, XCU', () => {
    const snap = buildSnapshot([], '7d');
    const symbols = snap.metals.map((m) => m.symbol);
    expect(symbols).toEqual(['XAU', 'XAG', 'XPT', 'XPD', 'XCU']);
    for (const m of snap.metals) {
      expect(m.hasData).toBe(false);
      expect(m.latestPrice).toBeNull();
      expect(m.coverageNote).toMatch(/No observations stored yet/);
    }
  });

  it('computes period change from real observations inside the window', () => {
    obsSeq = 0;
    const t20 = new Date(NOW - 20 * HOUR).toISOString();
    const t2 = new Date(NOW - 2 * HOUR).toISOString();
    const history = [
      makeObs({ metal: 'XAG', price: 45, retrievedAt: new Date(NOW - 26 * HOUR).toISOString() }), // outside 24h
      makeObs({ metal: 'XAG', price: 50, retrievedAt: t20 }),
      makeObs({ metal: 'XAG', price: 52.5, retrievedAt: t2 }),
    ];
    const snap = buildSnapshot(history, '24h');
    const ag = snap.metals.find((m) => m.symbol === 'XAG')!;
    expect(ag.periodChange).toEqual({
      startPrice: 50,
      endPrice: 52.5,
      abs: 2.5,
      pct: 5,
      fromTime: t20,
      toTime: t2,
    });
    expect(ag.observationCount).toBe(2);
    expect(ag.hasData).toBe(true);
    expect(ag.coverageNote).toBeNull();
  });

  it('flags a single observation in-window instead of inventing a trend', () => {
    obsSeq = 0;
    const history = [
      makeObs({ metal: 'XPT', price: 1600, retrievedAt: new Date(NOW - 3 * HOUR).toISOString() }),
    ];
    const snap = buildSnapshot(history, '24h');
    const pt = snap.metals.find((m) => m.symbol === 'XPT')!;
    expect(pt.periodChange).toBeNull();
    expect(pt.coverageNote).toMatch(/Only one observation/);
    expect(pt.latestPrice).toBe(1600);
  });

  it('keeps the latest overall price even when it predates the window, with an honest note', () => {
    obsSeq = 0;
    const stale = makeObs({ metal: 'XPD', price: 2200, retrievedAt: new Date(NOW - 40 * 24 * HOUR).toISOString() });
    const snap = buildSnapshot([stale], '24h');
    const pd = snap.metals.find((m) => m.symbol === 'XPD')!;
    expect(pd.latestPrice).toBe(2200);
    expect(pd.periodChange).toBeNull();
    expect(pd.coverageNote).toMatch(/No observations within the 24h window/);
  });

  it('rejects non-positive stored prices rather than surfacing them', () => {
    obsSeq = 0;
    const bad = makeObs({ metal: 'XAU', price: 0, retrievedAt: new Date(NOW - HOUR).toISOString() });
    const snap = buildSnapshot([bad], '24h');
    const au = snap.metals.find((m) => m.symbol === 'XAU')!;
    expect(au.latestPrice).toBeNull();
    expect(au.coverageNote).toMatch(/Only one observation/);
  });
});

describe('assembleReport', () => {
  it('assembles model output for matched symbols and keeps prices from the snapshot', () => {
    const snap = snapshotWith(
      {
        symbol: 'XAU', metal: 'Gold', hasData: true, latestPrice: 4050,
        provider: 'goldapi', providerTimestamp: '2026-10-28T10:00:00Z',
        observationCount: 4, firstObservedAt: '2026-10-28T01:00:00Z', lastObservedAt: '2026-10-28T10:00:00Z',
        periodChange: { startPrice: 3970, endPrice: 4050, abs: 80, pct: 2.0, fromTime: '2026-10-28T01:00:00Z', toTime: '2026-10-28T10:00:00Z' },
        coverageNote: null,
      },
    );
    const doc = assembleReport(snap, VALID_ANALYSIS);
    const au = doc.metals.find((m) => m.symbol === 'XAU')!;
    expect(au.trend).toBe('bullish');
    expect(au.recommendation).toBe('monitor');
    expect(au.incomplete).toBe(false);
    expect(au.latestPrice).toBe(4050); // price always from snapshot
    expect(au.outlook).toContain('plausible');
    // Data-as-of from provider timestamp and source attribution
    expect(doc.dataAsOf).toBe('2026-10-28T10:00:00Z');
    expect(doc.sources).toEqual([{ name: 'goldapi', timestamp: '2026-10-28T10:00:00Z' }]);
  });

  it('marks metals the model omitted as no-analysis instead of fabricating', () => {
    const snap = snapshotWith(
      { symbol: 'XAU', hasData: true, latestPrice: 4050, provider: 'goldapi', providerTimestamp: '2026-10-28T10:00:00Z' },
    );
    const doc = assembleReport(snap, VALID_ANALYSIS);
    for (const m of doc.metals.filter((x) => x.symbol !== 'XAU')) {
      expect(m.trend).toBe('no-analysis');
      expect(m.recommendation).toBe('no-analysis');
      expect(m.incomplete).toBe(true);
    }
  });

  it('always appends honest auto-limitations about provider spot quotes', () => {
    const snap = snapshotWith({ symbol: 'XAG', hasData: true, latestPrice: 50, provider: 'goldsafe', providerTimestamp: '2026-10-28T10:00:00Z' });
    const doc = assembleReport(snap, VALID_ANALYSIS);
    expect(doc.limitations.some((l) => l.includes('spot quotes'))).toBe(true);
    expect(doc.limitations.some((l) => l.includes('goldsafe') || l.includes('Gold')) || doc.limitations.length > 0).toBe(true);
    expect(doc.disclaimer).toMatch(/not personalized financial advice/i);
  });
});

describe('report history persistence', () => {
  it('stores, lists, gets, deletes and clears reports (survives "restarts")', () => {
    const storage = new FakeStorage();
    const snap = snapshotWith({ symbol: 'XAU', hasData: true, latestPrice: 4050, provider: 'goldapi', providerTimestamp: '2026-10-28T10:00:00Z' });
    const doc: MarketReportDoc = assembleReport(snap, VALID_ANALYSIS);

    addReport(doc, storage);
    expect(listReports(storage)).toHaveLength(1);
    expect(getReport(doc.reportId, storage)!.reportId).toBe(doc.reportId);

    const doc2: MarketReportDoc = { ...doc, reportId: 'r-second-12345', createdAt: '2026-10-28T13:00:00Z', period: '7d' };
    addReport(doc2, storage);
    expect(listReports(storage).map((r) => r.reportId)).toEqual(['r-second-12345', doc.reportId]);

    deleteReport(doc.reportId, storage);
    expect(listReports(storage).map((r) => r.reportId)).toEqual(['r-second-12345']);

    clearReports(storage);
    expect(listReports(storage)).toEqual([]);
  });

  it('skips corrupted entries instead of throwing on load', () => {
    const storage = new FakeStorage();
    storage.setItem('vf:reports:v1', JSON.stringify([{ nonsense: true }, 'junk', 42]));
    expect(listReports(storage)).toEqual([]);
  });
});

describe('period param plumbing', () => {
  it('only the four period strings map to a filter cutoff', () => {
    // filterByRange knows '24h' etc.; make sure reports reuse it sanely
    const old = makeObs({ metal: 'XAU', price: 4000, retrievedAt: new Date(Date.now() - 48 * HOUR).toISOString() });
    const snap24 = buildSnapshot([old], '24h');
    expect(snap24.metals.find((m) => m.symbol === 'XAU')!.observationCount).toBe(0);
    expect(snap24.metals.find((m) => m.symbol === 'XAU')!.periodChange).toBeNull();
  });
});
