import type { ManualPriceOverride, MarketSnapshot } from './types';
import { getUsdLkr, FX_SOURCE_LABEL } from './fx';

/**
 * Provider-independent market-data service for gold and silver plus FX.
 *
 * Design:
 *  - A provider only reports a price if it actually fetched one; the app
 *    NEVER manufactures a "live" figure.
 *  - Providers are pluggable: a real HTTP provider can be registered when
 *    credentials exist (env-configured, server-held where possible).
 *  - Manual overrides always win, and are labeled as user-entered.
 *  - Cache is timestamped; stale data is labeled, not silently reused.
 */

export interface MetalProvider {
  id: string;
  label: string;
  isDemo: boolean;
  /** Returns a snapshot only when data was really obtained. */
  fetch(): Promise<MarketSnapshot | null>;
}

/* ---------------- Demo provider (clearly labeled, not live) ---------------- */

export const DEFAULT_MARKET: MarketSnapshot = {
  goldPerGramLkr: null,
  silverPerGramLkr: null,
  usdLkr: null,
  sourceLabel: 'Manual valuation only',
  asOf: new Date().toISOString(),
  isDemo: false,
  isLive: false,
};

export const DEMO_MARKET: MarketSnapshot = {
  goldPerGramLkr: 26_450.0,
  silverPerGramLkr: 108.5,
  usdLkr: 297.5,
  sourceLabel: 'Test dataset',
  asOf: '2026-09-30T09:00:00+05:30',
  isDemo: true,
  isLive: false,
};

/* ------------- Configured HTTP provider (opt-in via env) ------------- */
/**
 * A generic HTTP provider. Define VITE_METALS_API_URL returning
 * { goldPerGramLkr, silverPerGramLkr, usdLkr, asOf } and it becomes
 * the primary source. Kept disabled unless the endpoint is configured;
 * failures degrade to manual/demo without breaking the dashboard.
 */
const httpProvider: MetalProvider = {
  id: 'http',
  label: 'Configured market API',
  isDemo: false,
  async fetch() {
    const url = import.meta.env.VITE_METALS_API_URL as string | undefined;
    if (!url) return null;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const j = (await res.json()) as Partial<MarketSnapshot>;
      if (!j.goldPerGramLkr && !j.silverPerGramLkr) return null;
      return {
        goldPerGramLkr: j.goldPerGramLkr ?? null,
        silverPerGramLkr: j.silverPerGramLkr ?? null,
        usdLkr: j.usdLkr ?? null,
        sourceLabel: (import.meta.env.VITE_METALS_API_LABEL as string) ?? 'Configured market API',
        asOf: j.asOf ?? new Date().toISOString(),
        isDemo: false,
        isLive: true,
      };
    } catch {
      return null; // Network failure must not break the dashboard.
    }
  },
};

const PROVIDERS: MetalProvider[] = [httpProvider];

/* ---------------- Cache & service ---------------- */

const CACHE_KEY = 'vaultfolio.market.cache.v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

interface CacheShape {
  snapshot: MarketSnapshot;
}

function readCache(): MarketSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CacheShape;
    if (!c?.snapshot?.asOf) return null;
    return c.snapshot;
  } catch {
    return null;
  }
}

function writeCache(s: MarketSnapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ snapshot: s } satisfies CacheShape));
  } catch {
    /* storage full/private: cache is best-effort */
  }
}

/**
 * Fill in an automatic USD/LKR rate when neither the configured provider nor
 * a manual override supplies one. The quote carries its provider timestamp;
 * stale caches keep `fxStale` so callers can warn instead of pretending.
 */
async function withAutoFx(s: MarketSnapshot): Promise<MarketSnapshot> {
  if (s.usdLkr != null && Number.isFinite(s.usdLkr)) return s;
  const fx = await getUsdLkr();
  if (!fx.quote) return s; // no verified rate — stay null, never invent one
  return {
    ...s,
    usdLkr: fx.quote.rate,
    fxSourceLabel: fx.quote.stale ? `${FX_SOURCE_LABEL} (stale cache)` : FX_SOURCE_LABEL,
    fxAsOf: fx.quote.asOf,
    fxStale: fx.quote.stale,
    sourceLabel: s.sourceLabel.includes('FX') ? s.sourceLabel : `${s.sourceLabel}; FX: exchangerate-api.com`,
  };
}

/** Resolve market data with caching + manual overrides. */
export async function loadMarketData(
  overrides: Partial<Record<ManualPriceOverride['kind'], number>>,
): Promise<MarketSnapshot> {
  for (const p of PROVIDERS) {
    const cached = readCache();
    const cacheFresh = cached && Date.now() - new Date(cached.asOf).getTime() < CACHE_TTL_MS;
    if (cacheFresh && cached && !cached.isDemo) {
      return applyOverrides(await withAutoFx(cached), overrides);
    }
    let snap = await p.fetch();
    if (snap) {
      if (!cacheFresh || !cached || cached.isDemo) writeCache(snap);
      return applyOverrides(await withAutoFx(snap), overrides);
    }
  }
  const cached = readCache();
  return applyOverrides(await withAutoFx(cached ?? DEFAULT_MARKET), overrides);
}

export function applyOverrides(s: MarketSnapshot, o: Partial<Record<ManualPriceOverride['kind'], number>>): MarketSnapshot {
  const userGold = o.gold_per_gram;
  const userSilver = o.silver_per_gram;
  const userFx = o.usd_lkr;
  const anyOverride = userGold != null || userSilver != null || userFx != null;
  if (!anyOverride) return s;
  const parts: string[] = [];
  if (userGold != null) parts.push('gold (manual)');
  if (userSilver != null) parts.push('silver (manual)');
  if (userFx != null) parts.push('FX (manual)');
  return {
    ...s,
    goldPerGramLkr: userGold != null ? userGold : s.goldPerGramLkr,
    silverPerGramLkr: userSilver != null ? userSilver : s.silverPerGramLkr,
    usdLkr: userFx != null ? userFx : s.usdLkr,
    sourceLabel: anyOverride ? `${s.sourceLabel} + manual override` : s.sourceLabel,
  };
}
