import { describe, expect, it } from 'vitest';
import { assetMetrics, metalResaleValueLkr, metalValueLkr, purityFraction, resolveAssetValuation, statsFor } from './valuation';
import { buildDemoData } from './demo';
import { DEMO_MARKET, applyOverrides } from './market';
import { GoldSilverAttrs, MarketSnapshot } from './types';

const market: MarketSnapshot = {
  goldPerGramLkr: 24000,
  silverPerGramLkr: 100,
  usdLkr: 300,
  sourceLabel: 'Test source',
  asOf: new Date().toISOString(),
  isDemo: false,
  isLive: true,
};

describe('purityFraction', () => {
  it('parses karats', () => {
    expect(purityFraction('24k')).toBe(1);
    expect(purityFraction('22K')).toBeCloseTo(22 / 24);
    expect(purityFraction('18k')).toBeCloseTo(0.75);
    expect(purityFraction('9k')).toBeCloseTo(0.375);
  });
  it('parses decimals and millesimals', () => {
    expect(purityFraction('0.999')).toBe(0.999);
    expect(purityFraction('.925')).toBe(0.925);
    expect(purityFraction('999.9')).toBe(0.999);
    expect(purityFraction('925')).toBe(0.925);
    expect(purityFraction('916')).toBe(0.916);
    expect(purityFraction('958/1000')).toBe(0.958);
  });
  it('rejects garbage', () => {
    expect(purityFraction('pure')).toBeNull();
    expect(purityFraction('')).toBeNull();
  });
});

describe('metal valuation', () => {
  const attrs: GoldSilverAttrs = {
    metal: 'gold',
    form: 'jewelry',
    weight: 10,
    weightUnit: 'g',
    purity: '22k',
    dealerSpreadPct: 10,
    craftsmanshipNote: null,
  };
  it('computes fine metal value: 10g × (22/24) × 24000', () => {
    const { valueLkr } = metalValueLkr(attrs, market)!;
    expect(valueLkr).toBeCloseTo(220000, 0);
  });
  it('applies spread to resale only', () => {
    expect(metalResaleValueLkr(attrs, market)).toBeCloseTo(198000, 0);
  });
  it('converts units: 1 tola = 11.6638g', () => {
    const tol: GoldSilverAttrs = { ...attrs, weight: 1, weightUnit: 'tola', purity: '24k', dealerSpreadPct: 0 };
    const { valueLkr } = metalValueLkr(tol, market)!;
    expect(valueLkr).toBeCloseTo(11.6638 * 24000, 0);
  });
});

describe('user valuation precedence', () => {
  const base = buildDemoData().assets[0];
  it('owner valuation is authoritative, engine does not overwrite', () => {
    const r = resolveAssetValuation(base, market);
    expect(r.method).toBe('user');
    expect(r.valueLkr).toBe(base.valuation.valueLkr);
  });
  it('calculated path applies when no user value is set', () => {
    const noVal = { ...base, valuation: { ...base.valuation, valueLkr: null, method: 'unavailable' } } as typeof base;
    const r = resolveAssetValuation(noVal, market);
    expect(r.method).toBe('calculated');
    expect(r.valueLkr).not.toBeNull();
    expect(r.explanation).toContain('LKR');
  });
});

describe('stats conventions', () => {
  it('unvalued assets are excluded, not zeroed', () => {
    const { assets } = buildDemoData();
    // pick a non-gold asset so no market fallback can rescue it
    const gems = assets.find((a) => a.category === 'gems_jewelry')!;
    const unvalued = { ...gems, valuation: { ...gems.valuation, valueLkr: null, method: 'unavailable' as const } };
    const stats = statsFor([unvalued], market);
    expect(stats.unvaluedCount).toBe(1);
    expect(stats.totalValueLkr).toBe(0);
  });
});

describe('assetMetrics', () => {
  it('unrealized and resale gain are distinct metrics', () => {
    const demo = buildDemoData().assets[0];
    const withResale = { ...demo, resaleValueLkr: demo.valuation.valueLkr! - 50000 };
    const m = assetMetrics(withResale, market);
    expect(m.unrealizedGainLkr).not.toBeNull();
    expect(m.resaleGainLkr!).toBeCloseTo((m.unrealizedGainLkr ?? 0) - 50000, 0);
    expect(m.purchaseCostLkr).toBe(withResale.purchase.priceLkr);
  });
  it('extra purchase costs count into cost basis', () => {
    const demo = buildDemoData().assets[0];
    const withFees = { ...demo, purchase: { ...demo.purchase, extraCostsLkr: 5000 } };
    const m = assetMetrics(withFees, market);
    expect(m.purchaseCostLkr).toBe((demo.purchase.priceLkr ?? 0) + 5000);
  });
});

describe('demo integrity', () => {
  it('covers all seven categories with realistic variety', () => {
    const { assets } = buildDemoData();
    const cats = new Set(assets.map((a) => a.category));
    expect(cats.size).toBeGreaterThanOrEqual(7);
    for (const a of assets) {
      expect(a.valuation.sourceLabel).toContain('demo');
      expect(a.valuation.valueLkr ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('demo market & overrides', () => {
  it('overrides win over provider values and are labeled', () => {
    const s = applyOverrides(DEMO_MARKET, { gold_per_gram: 30000 });
    expect(s.goldPerGramLkr).toBe(30000);
    expect(s.sourceLabel).toContain('manual override');
  });
  it('override-independent fields untouched', () => {
    const s = applyOverrides(DEMO_MARKET, { usd_lkr: 310 });
    expect(s.goldPerGramLkr).toBe(DEMO_MARKET.goldPerGramLkr);
    expect(s.usdLkr).toBe(310);
  });
});
