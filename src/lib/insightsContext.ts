/**
 * Portfolio context builder for AI Insights.
 *
 * Computes everything the model is told about the portfolio locally, via the
 * valuation engine — the model never supplies these numbers.
 */

import type { Asset, GoldSilverAttrs, MarketSnapshot } from './types';
import { allocationByCategory, resolveAssetValuation, statsFor } from './valuation';
import { loadPriceHistory } from './marketWatch';
import { metalNameToCode } from './spotValue';
import { METAL_META, type MetalCode } from './marketWatch';

export interface PortfolioMetalHolding {
  symbol: MetalCode;
  label: string;
  /** Total gross weight across matching active assets, in grams. */
  totalGrams: number;
  count: number;
  estimatedValueLkr: number;
  estimatedValueUsd: number | null;
  valuatedCount: number;
}

export interface PortfolioSnapshot {
  asOf: string;
  activeAssets: number;
  soldAssets: number;
  totalValueLkr: number | null;
  totalCostLkr: number | null;
  /** Optional US-dollar mirror of the total, only when a current FX rate exists. */
  totalValueUsd: number | null;
  usdLkr: number | null;
  usdLkrAsOf: string | null;
  usdLkrStale: boolean;
  metalHoldings: PortfolioMetalHolding[];
  allocationPct: Array<{ category: string; label: string; percent: number; valueLkr: number }>;
  topCategory: { category: string; label: string; percent: number } | null;
  /** Total fine-metal market exposure vs the whole valued portfolio, %. */
  metalsSharePct: number | null;
  notes: string[];
}

/** Build the verified portfolio snapshot used in the Insights prompt. */
export function buildPortfolioSnapshot(assets: Asset[], market: MarketSnapshot | null): PortfolioSnapshot {
  const active = assets.filter((a) => a.status === 'active');
  const sold = assets.filter((a) => a.status === 'sold');
  const stats = statsFor(assets, market);

  const notes: string[] = [];
  if (market?.isDemo) notes.push('Market data is the demo dataset — values are illustrative, not live quotes.');

  const usdLkr = market?.usdLkr ?? null;

  const holdings = new Map<MetalCode, PortfolioMetalHolding>();
  for (const code of Object.keys(METAL_META) as MetalCode[]) {
    const meta = METAL_META[code];
    holdings.set(code, { symbol: code, label: meta.label, totalGrams: 0, count: 0, estimatedValueLkr: 0, estimatedValueUsd: null, valuatedCount: 0 });
  }
  for (const a of active) {
    if (a.category !== 'gold_silver') continue;
    const attrs = a.attributes as GoldSilverAttrs;
    const code = metalNameToCode(attrs.metal);
    if (!code) continue;
    const h = holdings.get(code)!;
    h.count += 1;
    // Gross weight in grams (jewellery weight may include non-metal parts).
    const w = attrs.weight;
    h.totalGrams += w;
    const resolved = resolveAssetValuation(a, market);
    if (resolved.valueLkr != null) {
      h.estimatedValueLkr += resolved.valueLkr;
      h.valuatedCount += 1;
    }
  }
  for (const h of holdings.values()) {
    h.estimatedValueUsd = usdLkr && h.estimatedValueLkr > 0 ? h.estimatedValueLkr / usdLkr : null;
  }

  const allocation = allocationByCategory(assets, market);
  const totalAllocated = allocation.reduce((n, a) => n + a.valueLkr, 0);
  const allocationPct = allocation.map((a) => ({
    category: a.category,
    label: categoryLabel(a.category),
    percent: totalAllocated > 0 ? (a.valueLkr / totalAllocated) * 100 : 0,
    valueLkr: a.valueLkr,
  }));
  const top = allocationPct[0] && allocationPct[0].percent > 0 ? { category: allocationPct[0].category, label: allocationPct[0].label, percent: allocationPct[0].percent } : null;

  const metalsValueLkr = Array.from(holdings.values()).reduce((n, h) => n + h.estimatedValueLkr, 0);
  const metalsSharePct = totalAllocated > 0 && metalsValueLkr > 0 ? (metalsValueLkr / totalAllocated) * 100 : null;

  if (stats.unvaluedCount > 0) {
    notes.push(`${stats.unvaluedCount} active asset(s) have no valuation yet; they are excluded from percentages.`);
  }
  if (loadPriceHistory().length === 0) notes.push('No stored market observations on this device yet — market sections may be empty.');
  return {
    asOf: new Date().toISOString(),
    activeAssets: active.length,
    soldAssets: sold.length,
    totalValueLkr: stats.totalValueLkr > 0 ? stats.totalValueLkr : null,
    totalCostLkr: stats.totalCostLkr > 0 ? stats.totalCostLkr : null,
    totalValueUsd: stats.totalValueLkr > 0 && usdLkr ? stats.totalValueLkr / usdLkr : null,
    usdLkr,
    usdLkrAsOf: market?.fxAsOf ?? null,
    usdLkrStale: market?.fxStale ?? false,
    metalHoldings: Array.from(holdings.values()).filter((h) => h.count > 0),
    allocationPct,
    topCategory: top,
    metalsSharePct,
    notes,
  };
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'gold_silver': return 'Gold & Silver (metals)';
    case 'gems_jewelry': return 'Gems & Jewelry';
    case 'watches': return 'Watches';
    case 'land_property': return 'Land & Property';
    case 'cars': return 'Cars';
    case 'motorcycles': return 'Motorcycles';
    case 'other': return 'Other';
    default: return category;
  }
}
