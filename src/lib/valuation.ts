import type {
  Asset,
  AssetCategory,
  GoldSilverAttrs,
  MarketSnapshot,
  PortfolioStats,
  ValuationMethod,
} from './types';
import { purityFraction, toGrams } from './units';

export { purityFraction };

/**
 * Transparent valuation engine.
 *
 * Priority (per product spec):
 *  1. Live / recent market data                 → 'live_market' | 'recent_market'
 *  2. Transparent calculation from market data  → 'calculated'
 *  3. User-entered valuation                    → 'user' (NEVER auto-overwritten)
 *  4. Indicative model estimate                 → 'indicative'
 *  5. Valuation unavailable                     → null value + status 'unavailable'
 *
 * All results carry the method, source and confidence so the UI can state
 * exactly where a number came from. No silent substitution.
 */

export interface ResolvedValuation {
  valueLkr: number | null;
  method: ValuationMethod;
  sourceLabel: string;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  /** Fine-metal value if a market price supports the calculation. */
  calculatedValueLkr?: number | null;
}

const METHOD_LABEL: Record<ValuationMethod, string> = {
  live_market: 'Live market data',
  recent_market: 'Recent market data',
  calculated: 'Calculated estimate',
  user: 'User-entered value',
  indicative: 'Indicative model estimate',
  unavailable: 'Valuation unavailable',
};

export const valuationMethodLabel = (m: ValuationMethod): string => METHOD_LABEL[m];

/** Fine metal value for a gold/silver asset at given market prices. */
export function metalValueLkr(
  attrs: GoldSilverAttrs,
  market: MarketSnapshot,
): { valueLkr: number; grams: number; purity: number } | null {
  const purity = purityFraction(attrs.purity);
  if (purity === null || attrs.weight <= 0) return null;
  const grams = toGrams(attrs.weight, attrs.weightUnit);
  const pricePerGram = attrs.metal === 'gold' ? market.goldPerGramLkr : market.silverPerGramLkr;
  if (!pricePerGram || pricePerGram <= 0) return null;
  return {
    valueLkr: grams * purity * pricePerGram,
    grams,
    purity,
  };
}

/** Estimated resale proceeds after dealer spread (fine-metal assets). */
export function metalResaleValueLkr(attrs: GoldSilverAttrs, market: MarketSnapshot): number | null {
  const mv = metalValueLkr(attrs, market);
  if (!mv) return null;
  const spread = attrs.dealerSpreadPct ?? 0;
  return mv.valueLkr * (1 - Math.min(50, Math.max(0, spread)) / 100);
}

/**
 * Resolve the asset's present value using the priority ladder.
 * A user-set valuation (method 'user') is authoritative and is never
 * replaced by a computed figure; the computed figure is surfaced
 * separately so the two can be compared honestly.
 */
export function resolveAssetValuation(asset: Asset, market: MarketSnapshot | null): ResolvedValuation {
  const userValue = asset.valuation?.valueLkr;

  // 1) User-entered value wins for every category.
  if (userValue !== null && userValue !== undefined && Number.isFinite(userValue)) {
    return {
      valueLkr: userValue,
      method: 'user',
      sourceLabel: asset.valuation?.sourceLabel || 'Owner estimate',
      confidence: asset.valuation?.confidence && asset.valuation.confidence !== 'high' ? asset.valuation.confidence : asset.valuation?.confidence ?? 'medium',
      explanation:
        'Value entered by the owner. Automated systems do not overwrite it.',
    };
  }

  // 2) Transparent calculation for gold & silver when market prices exist.
  if (asset.category === 'gold_silver' && market) {
    const mv = metalValueLkr(asset.attributes as GoldSilverAttrs, market);
    if (mv) {
      const isDemo = market.isDemo;
      return {
        valueLkr: mv.valueLkr,
        method: isDemo ? 'indicative' : 'calculated',
        sourceLabel: market.sourceLabel,
        confidence: isDemo ? 'low' : 'medium',
        explanation:
          `Fine-metal content: ${mv.grams.toFixed(2)} g × ${mv.purity} purity × ${market.goldPerGramLkr && (asset.attributes as GoldSilverAttrs).metal === 'gold' ? 'gold' : 'silver'} price of ${
            (asset.attributes as GoldSilverAttrs).metal === 'gold'
              ? `LKR ${market.goldPerGramLkr?.toLocaleString('en-US')}/g`
              : `LKR ${market.silverPerGramLkr?.toLocaleString('en-US')}/g`
          } from ${market.sourceLabel}${market.isDemo ? ' (demo price — not a live market quote)' : ''}.`,
        calculatedValueLkr: mv.valueLkr,
      };
    }
  }

  // 3) An original recorded valuation (e.g. migrated record tagged with a method).
  if (
    asset.valuation?.method &&
    asset.valuation.method !== 'user' &&
    asset.valuation.method !== 'unavailable' &&
    Number.isFinite(userValue)
  ) {
    return {
      valueLkr: userValue ?? null,
      method: asset.valuation.method,
      sourceLabel: asset.valuation.sourceLabel || 'Recorded valuation',
      confidence: asset.valuation.confidence,
      explanation: `Recorded valuation (${METHOD_LABEL[asset.valuation.method]}) recorded on ${asset.valuation.updatedAt}.`,
    };
  }

  // 4) Unavailable.
  return {
    valueLkr: null,
    method: 'unavailable',
    sourceLabel: 'None',
    confidence: 'low',
    explanation:
      'No valuation available. Add a market price or enter the asset\u2019s estimated value manually.',
  };
}

/** Resale proceeds preference: explicit resale entry beats derived metal resale. */
export function resolveResaleValue(asset: Asset, market: MarketSnapshot | null): number | null {
  if (asset.resaleValueLkr !== null && asset.resaleValueLkr !== undefined) return asset.resaleValueLkr;
  if (asset.category === 'gold_silver' && market) return metalResaleValueLkr(asset.attributes as GoldSilverAttrs, market);
  return null;
}

export interface AssetMoneyetics {
  purchaseCostLkr: number | null;
  currentValueLkr: number | null;
  resaleValueLkr: number | null;
  /** current estimated value − purchase cost (mark-to-estimate gain) */
  unrealizedGainLkr: number | null;
  /** estimated resale proceeds − purchase cost (what you might net) */
  resaleGainLkr: number | null;
}

/**
 * Gain metrics. Two distinct definitions per spec:
 *  - unrealizedGain = current estimated value − purchase cost (excludes selling costs)
 *  - resaleGain     = est. resale proceeds − purchase cost (nets removal of spread)
 */
export function assetMetrics(asset: Asset, market: MarketSnapshot | null): AssetMoneyetics {
  const purchaseCostLkr =
    asset.purchase.priceLkr != null && Number.isFinite(asset.purchase.priceLkr)
      ? asset.purchase.priceLkr + (asset.purchase.extraCostsLkr ?? 0)
      : null;
  const resolved = resolveAssetValuation(asset, market);
  const resaleValueLkr = resolveResaleValue(asset, market);
  const currentValueLkr = resolved.valueLkr;
  return {
    purchaseCostLkr,
    currentValueLkr,
    resaleValueLkr,
    unrealizedGainLkr:
      purchaseCostLkr != null && currentValueLkr != null ? currentValueLkr - purchaseCostLkr : null,
    resaleGainLkr: purchaseCostLkr != null && resaleValueLkr != null ? resaleValueLkr - purchaseCostLkr : null,
  };
}

export function statsFor(assets: Asset[], market: MarketSnapshot | null): PortfolioStats {
  const active = assets.filter((a) => a.status === 'active');
  const sold = assets.filter((a) => a.status === 'sold');
  let totalValueLkr = 0;
  let totalCostLkr = 0;
  let valuedCount = 0;
  let unvaluedCount = 0;
  for (const a of active) {
    const m = assetMetrics(a, market);
    if (m.currentValueLkr !== null) {
      totalValueLkr += m.currentValueLkr;
      valuedCount++;
      if (m.purchaseCostLkr !== null) totalCostLkr += m.purchaseCostLkr;
    } else {
      unvaluedCount++;
    }
  }
  return {
    totalValueLkr,
    totalCostLkr,
    valuedCount,
    unvaluedCount,
    activeCount: active.length,
    soldCount: sold.length,
    gainLkr: totalCostLkr > 0 ? totalValueLkr - totalCostLkr : 0,
  };
}

/** Category allocation for the valued subset of active assets. */
export function allocationByCategory(
  assets: Asset[],
  market: MarketSnapshot | null,
): { category: AssetCategory; valueLkr: number; count: number }[] {
  const map = new Map<AssetCategory, { valueLkr: number; count: number }>();
  for (const a of assets.filter((x) => x.status === 'active')) {
    const v = resolveAssetValuation(a, market).valueLkr;
    if (v === null) continue;
    const rec = map.get(a.category) ?? { valueLkr: 0, count: 0 };
    rec.valueLkr += v;
    rec.count += 1;
    map.set(a.category, rec);
  }
  return [...map.entries()]
    .map(([category, rec]) => ({ category, ...rec }))
    .sort((a, b) => b.valueLkr - a.valueLkr);
}

export function portfolioTimeline(
  assets: Asset[],
  records: import('./types').ValuationRecord[],
): { date: string; valueLkr: number }[] {
  if (records.length === 0) return [];
  const assetIds = new Set(assets.filter((a) => a.status === 'active').map((a) => a.id));
  const perAsset = new Map<string, Map<number, number>>(); // assetId -> ts -> valueLkr
  const eventDates = new Set<string>();
  for (const r of records) {
    if (!assetIds.has(r.assetId)) continue;
    if (r.valueLkr === null || r.valueLkr === undefined || !Number.isFinite(r.valueLkr)) continue;
    const ts = new Date(r.recordedAt).getTime();
    if (Number.isNaN(ts)) continue;
    const byTs = perAsset.get(r.assetId) ?? new Map();
    const prev = byTs.get(ts);
    if (prev === undefined) byTs.set(ts, r.valueLkr);
    else byTs.set(ts, Math.max(prev, r.valueLkr));
    perAsset.set(r.assetId, byTs);
    eventDates.add(r.recordedAt);
  }
  return [...eventDates].sort().map((date) => {
    const ts = new Date(date).getTime();
    let sum = 0;
    for (const byTs of perAsset.values()) {
      let bestTs = -1;
      let best: number | undefined;
      for (const [t, v] of byTs) {
        if (t <= ts && t > bestTs) {
          bestTs = t;
          best = v;
        }
      }
      if (best !== undefined) sum += best;
    }
    return { date, valueLkr: sum };
  });
}
