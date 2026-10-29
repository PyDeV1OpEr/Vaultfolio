/**
 * USD → LKR exchange rate — automatic, documented, keyless source.
 *
 * Provider: https://open.er-api.com/v6/latest/USD (Open Exchange Rates
 * aggregate published by exchangerate-api.com). Free, no key, includes LKR.
 * Verified live during development (e.g. returns `rates.LKR`).
 *
 * Honesty rules:
 *  - A cached rate is NEVER presented as live: every quote carries the
 *    provider timestamp (`asOf`) and our retrieval timestamp.
 *  - On fetch failure the last cached quote is returned with `isLive: false`
 *    and the caller renders the staleness.
 *  - A user override (Settings → Market & Valuations → FX) always wins and
 *    is labeled user-entered by market.ts — this module never applies it.
 */

export const FX_SOURCE_ID = 'open-er-api';
export const FX_SOURCE_LABEL = 'exchangerate-api.com (open.er-api.com)';
export const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

/** Refresh the cached rate at most this often (24h — provider updates daily). */
export const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const FX_CACHE_KEY = 'vaultfolio.fx.usdlkr.v1';

export interface UsdLkrQuote {
  /** LKR per 1 USD. */
  rate: number;
  sourceLabel: string;
  /** Provider's update timestamp (ISO). */
  asOf: string;
  /** When we retrieved it (ISO). */
  retrievedAt: string;
  isLive: boolean;
  /** True when this is a cached quote served after a failed refresh. */
  stale: boolean;
}

interface FxCacheShape {
  quote: UsdLkrQuote;
}

export interface FxFetchResult {
  quote: UsdLkrQuote | null;
  error: string | null;
}

/** Sanity bounds — a wildly out-of-range "rate" means a malformed response. */
function rateLooksSane(n: number): boolean {
  return Number.isFinite(n) && n > 50 && n < 10_000;
}

function parseQuote(json: Record<string, unknown>): UsdLkrQuote | null {
  const rates = json?.rates as Record<string, number> | undefined;
  const raw = typeof rates?.LKR === 'number' ? rates.LKR : Number(rates?.LKR);
  if (!rateLooksSane(raw)) return null;
  const now = new Date().toISOString();
  const asOf =
    typeof json.time_last_update_utc === 'string' ? new Date(json.time_last_update_utc).toISOString() : now;
  return {
    rate: raw,
    sourceLabel: FX_SOURCE_LABEL,
    asOf,
    retrievedAt: now,
    isLive: true,
    stale: false,
  };
}

/**
 * Fetch a fresh quote (with a timeout) — throws on network or HTTP failure.
 */
export async function fetchFxFresh(): Promise<UsdLkrQuote> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(FX_ENDPOINT, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`FX provider returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    const quote = parseQuote(body);
    if (!quote) {
      throw new Error('FX provider response did not include a valid USD/LKR rate');
    }
    return quote;
  } finally {
    clearTimeout(timer);
  }
}

function readCache(): UsdLkrQuote | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as FxCacheShape;
    return c?.quote && typeof c.quote.rate === 'number' ? c.quote : null;
  } catch {
    return null;
  }
}

function writeCache(q: UsdLkrQuote): void {
  try {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ quote: q } satisfies FxCacheShape));
  } catch {
    /* best-effort cache */
  }
}

/**
 * Cache-friendly resolver.
 *  - fresh cache (within TTL) → returned with `stale:false`
 *  - expired cache + fetch ok → new quote
 *  - fetch fails + any cache  → cached quote with `stale:true, isLive:false`
 *  - no cache                 → (null, error)
 */
export async function getUsdLkr(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): Promise<FxFetchResult> {
  const cached = readCacheFrom(storage);
  if (cached && Date.now() - new Date(cached.retrievedAt).getTime() < FX_CACHE_TTL_MS) {
    return { quote: cached, error: null };
  }
  try {
    const fresh = await fetchFxFresh();
    writeQuoteTo(storage, fresh);
    return { quote: fresh, error: null };
  } catch (e) {
    if (cached) {
      return {
        quote: { ...cached, isLive: false, stale: true },
        error: `FX refresh failed, showing last known rate (${(e as Error).message}).`,
      };
    }
    return { quote: null, error: (e as Error).message };
  }
}

function readCacheFrom(storage: Pick<Storage, 'getItem'>): UsdLkrQuote | null {
  try {
    const raw = storage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as FxCacheShape;
    return c?.quote && typeof c.quote.rate === 'number' ? c.quote : null;
  } catch {
    return null;
  }
}

function writeQuoteTo(storage: Pick<Storage, 'getItem' | 'setItem'>, q: UsdLkrQuote): void {
  try {
    storage.setItem(FX_CACHE_KEY, JSON.stringify({ quote: q } satisfies FxCacheShape));
  } catch {
    /* best-effort */
  }
}

/** True when the module currently has a usable quote (with or without refresh). */
export function hasCachedFx(): boolean {
  return readCache() !== null;
}
