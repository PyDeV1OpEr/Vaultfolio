/**
 * AI Insights — schema validation and portfolio context tests.
 * Model output is untrusted: these tests pin the zod contract and the
 * verified-snapshot builder so fabricated numbers cannot render.
 */
import { describe, it, expect } from 'vitest';
import { insightsSchema, DEFAULT_GEMINI_MODEL, isGeminiModel } from './insights';
import { buildPortfolioSnapshot } from './insightsContext';
import type { InsightsAnalysis } from './insights';
import type { Asset } from './types';

const validAnalysis: InsightsAnalysis = {
  market_overview: 'Metals were broadly flat over the window.',
  metals: [
    { symbol: 'XAU', headline: 'Gold steady', comment: 'Observations show minor drift.', direction: 'neutral', confidence: 'medium' },
  ],
  portfolio: { summary: 'Two valued assets.', allocation_comment: 'Metals dominate.', concentration_note: 'XAU concentrates 80%.' },
  risks: ['FX staleness may distort LKR figures.'],
  opportunities: ['None evidenced by the data.'],
  tips: ['Refresh observations before acting.'],
  limitations: ['Interpretation only.'],
};

describe('insightsSchema', () => {
  it('accepts a well-formed analysis', () => {
    expect(insightsSchema.safeParse(validAnalysis).success).toBe(true);
  });

  it('rejects unknown metal symbols / bad enums', () => {
    const bad = { ...validAnalysis, metals: [{ ...validAnalysis.metals[0], symbol: 'XXX' }] };
    expect(insightsSchema.safeParse(bad).success).toBe(false);
    const badDir = { ...validAnalysis, metals: [{ ...validAnalysis.metals[0], direction: 'moon' }] };
    expect(insightsSchema.safeParse(badDir).success).toBe(false);
  });

  it('rejects a missing section', () => {
    const { limitations, ...withoutLimitations } = validAnalysis;
    void limitations;
    expect(insightsSchema.safeParse(withoutLimitations).success).toBe(false);
  });
});

function makeAsset(over: Partial<Asset['attributes']> & Record<string, unknown>, status: 'active' | 'sold' = 'active'): Asset {
  const base: Asset = {
    id: 'a1',
    userId: 'u1',
    category: 'gold_silver',
    name: 'Gold coin',
    status,
    attributes: {
      metal: 'gold',
      form: 'bullion',
      weight: 10,
      weightUnit: 'g',
      purity: '999.9',
    } as Asset['attributes'],
    purchase: { priceLkr: 200_000, date: null, extraCostsLkr: null },
    valuation: { valueLkr: 260_000, method: 'user', sourceLabel: 'user', confidence: 'high', updatedAt: new Date().toISOString() },
    sold: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (over) {
    base.attributes = { ...(base.attributes as object), ...over } as Asset['attributes'];
  }
  return base;
}

describe('buildPortfolioSnapshot', () => {
  it('groups active gold+silver assets and excludes sold ones', () => {
    const snap = buildPortfolioSnapshot(
      [makeAsset({ metal: 'gold' }), makeAsset({ metal: 'gold', name: 'Gold 2' }), makeAsset({ metal: 'silver' }), makeAsset({ metal: 'gold' }, 'sold')],
      null,
    );
    expect(snap.activeAssets).toBe(3);
    expect(snap.soldAssets).toBe(1);
    const xau = snap.metalHoldings.find((h) => h.symbol === 'XAU');
    expect(xau).toBeDefined();
    expect(xau!.count).toBe(2);
    expect(xau!.totalGrams).toBe(20);
    expect(snap.metalHoldings.find((h) => h.symbol === 'XAG')!.totalGrams).toBe(10);
  });

  it('reports no observations note and null FX when market empty', () => {
    const snap = buildPortfolioSnapshot([makeAsset({ metal: 'gold' })], null);
    expect(snap.usdLkr).toBeNull();
    expect(snap.totalValueUsd).toBeNull();
    expect(snap.notes.some((n) => n.includes('No stored market observations'))).toBe(true);
  });

  it('derives USD mirror only when an FX rate exists', () => {
    const snap = buildPortfolioSnapshot(
      [makeAsset({ metal: 'gold' })],
      { usdLkr: 320, fxAsOf: new Date().toISOString(), fxStale: false } as Parameters<typeof buildPortfolioSnapshot>[1],
    );
    expect(snap.usdLkr).toBe(320);
    expect(snap.totalValueUsd).toBeCloseTo(snap.totalValueLkr! / 320, 6);
  });
});

describe('selection', () => {
  it('exposes a controlled model list', () => {
    expect(isGeminiModel('gemini-2.5-flash')).toBe(true);
    expect(isGeminiModel('gemini-1.5-pro')).toBe(false);
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-2.5-flash');
  });
});
