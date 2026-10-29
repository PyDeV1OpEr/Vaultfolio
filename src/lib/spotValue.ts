/**
 * Spot-metal valuation bridge.
 *
 * Turns the Market Watch observation store (real provider-verified spot
 * prices, USD) into a fine-metal value for a gold/silver asset:
 *
 *   value = spot_per_gram_usd × grams × purity  →  × usdLkr  →  LKR
 *
 * Honesty contract:
 *  - The numeric inputs (spot price, timestamps) come from stored provider
 *    observations only. Nothing is interpolated or invented.
 *  - Freshness decides the method: live → 'live_market', recent →
 *    'recent_market', stale/offline → 'calculated' with an explicit stale
 *    warning embedded in the explanation. A stale price is never shown as
 *    live.
 *  - Spot ≠ dealer buyback: the result is the fine-metal content value; the
 *    caller applies the user's dealer-spread model for resale proceeds and
 *    the UI states that real selling prices are typically lower.
 */

import {
  type MetalCode,
  type PriceObservation,
  observationsForMetal,
  freshnessStatus,
  METAL_META,
} from './marketWatch';
import { GRAMS_PER_OZT } from './types';

/** USD per pound → USD per gram (1 lb = 453.59237 g exactly). */
export const GRAMS_PER_LB = 453.59237;

/** Map a GoldSilverAttrs.metal name to the Market Watch instrument code. */
export function metalNameToCode(metal: string): MetalCode | null {
  switch (metal) {
    case 'gold': return 'XAU';
    case 'silver': return 'XAG';
    case 'platinum': return 'XPT';
    case 'palladium': return 'XPD';
    case 'copper': return 'XCU';
    default: return null;
  }
}

/** USD spot per gram for an observation (unit-aware). */
export function spotPerGramUsd(obs: PriceObservation): number | null {
  if (!Number.isFinite(obs.price) || obs.price <= 0) return null;
  if (obs.unit === 'pound') return obs.price / GRAMS_PER_LB;
  if (obs.unit === 'troy_ounce') return obs.price / GRAMS_PER_OZT;
  // gram-priced observations are pass-through; unknown units are rejected
  if (obs.unit === 'gram') return obs.price;
  return null;
}

export interface SpotValuation {
  valueLkr: number;
  valueUsd: number;
  /** USD spot per gram used for the calculation. */
  spotPerGramUsd: number;
  /** The observation the price came from. */
  basis: PriceObservation;
  /** Basis observation time and provider timestamp for auditing. */
  observedAt: string;
  providerTimestamp: string;
  providerLabel: string;
  instrument: MetalCode;
  instrumentLabel: string;
  /** LKR per USD in effect, with its own timestamp when available. */
  usdLkr: number;
  fxAsOf: string | null;
  method: 'live_market' | 'recent_market' | 'calculated';
  confidence: 'high' | 'medium' | 'low';
  stale: boolean;
  explanation: string;
}

export type ValuationFreshness = 'live' | 'recent' | 'stale' | 'offline';

/**
 * Fine-metal value from stored observations, or null when no usable
 * observation exists. `usdLkr` must be a verified number (never a placeholder).
 */
export function computeSpotValue(opts: {
  metalCode: MetalCode;
  weightGrams: number;
  purity: number;
  observations: PriceObservation[];
  usdLkr: number;
  usdLkrAsOf?: string | null;
}): SpotValuation | null {
  const { metalCode, weightGrams, purity, observations, usdLkr } = opts;
  if (!(weightGrams > 0) || !(purity > 0 && purity <= 1) || !(usdLkr > 0)) return null;

  const store = observations.length ? observations : [];
  const latest = store.length > 0 ? store[store.length - 1] : null;
  if (!latest) return null;

  const perGram = spotPerGramUsd(latest);
  if (perGram === null) return null;

  const freshness = freshnessStatus(latest) as ValuationFreshness;
  const stale = freshness === 'stale' || freshness === 'offline';

  const valueUsd = perGram * weightGrams * purity;
  const valueLkr = valueUsd * usdLkr;

  const meta = METAL_META[metalCode];
  const basisPerGramRule =
    latest.unit === 'pound' ? `${latest.price.toFixed(4)} USD/lb` : `${latest.price.toFixed(2)} USD/t oz`;

  const parts = [
    `${weightGrams.toFixed(2)} g × ${(purity * 100).toFixed(2)}% fine`,
    `${basisPerGramRule}`,
    `${METAL_META[metalCode].label} (${metalCode}) spot × ${usdLkr.toFixed(2)} LKR/USD`,
    `= LKR ${valueLkr.toFixed(2)} (USD ${valueUsd.toFixed(2)})`,
  ];

  let explanation = `Fine-metal content value from ${meta.label} market data: ${parts.join(' · ')}.`;
  if (stale) {
    explanation += ` WARNING: the latest ${meta.label} price is ${freshness === 'stale' ? 'stale' : 'dated offline'} (observed ${latest.retrievedAt}); this is NOT a live price.`;
  }
  explanation += ' This is the fine-metal content value at international spot — a real sale typically nets less after dealer spreads, taxes, and test deductions.';

  const method: SpotValuation['method'] =
    freshness === 'live' ? 'live_market' : freshness === 'recent' ? 'recent_market' : 'calculated';
  const confidence: SpotValuation['confidence'] = freshness === 'live' ? 'high' : freshness === 'recent' ? 'medium' : 'low';

  return {
    valueLkr,
    valueUsd,
    spotPerGramUsd: perGram,
    basis: latest,
    observedAt: latest.retrievedAt,
    providerTimestamp: latest.providerTimestamp,
    providerLabel: providerLabelOf(latest.providerId),
    instrument: metalCode,
    instrumentLabel: meta.label,
    usdLkr,
    fxAsOf: opts.usdLkrAsOf ?? null,
    method,
    confidence,
    stale,
    explanation,
  };
}

function providerLabelOf(providerId: string): string {
  switch (providerId) {
    case 'goldapi': return 'GoldAPI.io';
    case 'goldapicom': return 'gold-api.com';
    case 'manual': return 'Manual entry';
    case 'goldsafe': return 'Goldsafe.io (retired)';
    default: return providerId;
  }
}

/**
 * Convenience for a full asset: resolves observations for the asset's metal
 * from the shared watch history and returns the fine-metal valuation.
 */
export function spotValueForAsset(
  metalName: string,
  weightGrams: number,
  purity: number,
  history: PriceObservation[],
  usdLkr: number,
  usdLkrAsOf?: string | null,
): SpotValuation | null {
  const code = metalNameToCode(metalName);
  if (!code) return null;
  return computeSpotValue({
    metalCode: code,
    weightGrams,
    purity,
    observations: observationsForMetal(history, code),
    usdLkr,
    usdLkrAsOf,
  });
}
