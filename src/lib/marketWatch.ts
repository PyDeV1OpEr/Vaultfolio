/**
 * Market Watch — on-device price observation store, provider adapters, and scheduler.
 *
 * Design principles:
 *  - Two real API providers: GoldAPI.io (primary, key-optional) and
 *    gold-api.com (keyless fallback, covers all five metals incl. copper).
 *    Goldsafe.io was removed in 1.0.4: its API domain is defunct (domain
 *    parked for sale; TLS handshake fails on api.goldsafe.io).
 *  - All credentials read from import.meta.env at runtime; never hardcoded.
 *  - Price history persists in localStorage under the user's device only.
 *  - Scheduling targets ~2 fetches/day (configurable); no tight polling loops.
 *  - Validation gates every incoming value: zero, negative, impossible values are rejected.
 *  - Spot-price observations are strictly separate from user asset valuations.
 *  - No record is labelled "live" merely because it is the latest saved record.
 *  - Provider coverage is declared honestly: missing metals are "unsupported", not fabricated.
 */

/* ─────────────────────────── Types ─────────────────────────── */

export type MetalCode = 'XAU' | 'XAG' | 'XPT' | 'XPD' | 'XCU';

export const METAL_META: Record<
  MetalCode,
  { label: string; unit: string; displayUnit: string; altUnit?: string; category: string }
> = {
  XAU: { label: 'Gold', unit: 'troy_ounce', displayUnit: 'troy oz', altUnit: 'gram', category: 'precious' },
  XAG: { label: 'Silver', unit: 'troy_ounce', displayUnit: 'troy oz', altUnit: 'gram', category: 'precious' },
  XPT: { label: 'Platinum', unit: 'troy_ounce', displayUnit: 'troy oz', altUnit: 'gram', category: 'precious' },
  XPD: { label: 'Palladium', unit: 'troy_ounce', displayUnit: 'troy oz', altUnit: 'gram', category: 'precious' },
  XCU: { label: 'Copper', unit: 'pound', displayUnit: 'lb', altUnit: 'metric tonne', category: 'industrial' },
};

export type ProviderId = 'goldapi' | 'goldapicom' | 'manual';
// NOTE: locally stored history may still contain observations from the
// retired 'goldsafe' provider (ProviderId has since dropped it). loadPriceHistory
// accepts stored records structurally, so old rows keep rendering.

export interface PriceObservation {
  /** Internal unique id */
  id: string;
  /** Metal instrument code */
  metal: MetalCode;
  /** Numeric price; precision preserved to 4 decimal places */
  price: number;
  /** ISO 4217 currency code (always USD from API; LKR only when manually converted) */
  currency: 'USD' | 'LKR';
  /** Price unit as stated by the provider */
  unit: string;
  /** Contract type reported by provider */
  quoteType: 'spot' | 'futures' | 'retail' | 'indicative';
  /** Provider that generated this record */
  providerId: ProviderId;
  /** Provider's own timestamp for the quote (ISO string) */
  providerTimestamp: string;
  /** Local ISO timestamp when we actually saved this record */
  retrievedAt: string;
  /** Absolute change from previous session close, if provider supplied it */
  change: number | null;
  /** Percentage change from previous session close, if provider supplied it */
  changePct: number | null;
  /** Whether the observation was current at retrieval time (provider's is_stale flag) */
  providerFresh: boolean;
  /** Exchange / data source label from provider */
  exchangeLabel: string;
  /** Per-gram price in USD, only when mathematically valid */
  pricePerGramUsd: number | null;
}

export interface MarketWatchSettings {
  /** Number of automatic fetch runs per day. Default 2. */
  fetchesPerDay: number;
  /** Whether auto-fetch is enabled */
  autoFetchEnabled: boolean;
  /** ISO timestamp of the last successfully completed fetch run */
  lastFetchAt: string | null;
  /** The currently selected metal on the market watch page */
  selectedMetal: MetalCode;
  /** The selected time range on the chart */
  selectedRange: '1h' | '12h' | '24h' | '7d' | '30d' | '90d' | 'all';
}

export interface ProviderResult {
  observations: PriceObservation[];
  errors: Record<MetalCode, string | null>;
  providerUsed: ProviderId;
  fallbackUsed: boolean;
  fetchedAt: string;
  /** Server-advertised backoff (Retry-After, ms) from a 429 rate-limit response, if any. */
  retryAfterMs: number | null;
}/**
 * Thrown by a provider adapter when the upstream API responds 429.
 * Carries the server's Retry-After so callers can back off correctly
 * instead of hammering the endpoint.
 */
export class RateLimitedError extends Error {
  retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}/**
 * Parse the HTTP Retry-After header (seconds-delay form; dates are ignored
 * as providers in this domain use the numeric form). Returns null when absent
 * or unparsable.
 */
export function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (raw === null) return null;
  const secs = Number(raw.trim());
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.min(Math.round(secs * 1000), 24 * 60 * 60 * 1000); // cap at 24h
}

/* ─────────────────────────── Constants ─────────────────────────── */

// Grams per troy ounce (exact)
const GRAMS_PER_OZT = 31.1034768;

// Price sanity thresholds (USD per troy oz, based on historical ranges × 5 safety margin)
const PRICE_BOUNDS: Record<MetalCode, { min: number; max: number }> = {
  XAU: { min: 500, max: 12000 },   // gold
  XAG: { min: 5, max: 500 },       // silver
  XPT: { min: 200, max: 6000 },    // platinum
  XPD: { min: 200, max: 10000 },   // palladium
  XCU: { min: 0.5, max: 30 },      // copper (per pound)
};

// GoldAPI.io supported metals in their API (XCU is NOT supported by GoldAPI)
const GOLDAPI_SUPPORTED: MetalCode[] = ['XAU', 'XAG', 'XPT', 'XPD'];

// gold-api.com (https://gold-api.com) — keyless public API, no authentication
// and no published rate limit. Copper is quoted under the COMEX HG continuous
// contract code (USD per pound), presented in Vaultfolio as XCU.
const GOLDAPICOM_SUPPORTED: MetalCode[] = ['XAU', 'XAG', 'XPT', 'XPD', 'XCU'];
const GOLDAPICOM_SYMBOL: Record<MetalCode, string> = {
  XAU: 'XAU',
  XAG: 'XAG',
  XPT: 'XPT',
  XPD: 'XPD',
  XCU: 'HG',
};

/** Unit basis for a gold-api.com price: USD/troy oz for precious metals, USD/lb for copper. */
function goldApiComUnit(metal: MetalCode): string {
  return metal === 'XCU' ? 'pound' : 'troy_ounce';
}

/** Human-readable provider label for a stored observation's providerId. */
export function providerLabel(providerId: string): string {
  switch (providerId) {
    case 'goldapi':
      return 'GoldAPI.io';
    case 'goldapicom':
      return 'gold-api.com';
    case 'manual':
      return 'Manual entry';
    case 'goldsafe':
      return 'Goldsafe.io (retired)';
    default:
      return providerId;
  }
}

/* ─────────────────────────── Storage ─────────────────────────── */

const HISTORY_KEY = 'vaultfolio.marketwatch.history.v1';
/** In-memory mirror of the stored history; invalidated on every save. */
let HISTORY_MEMO: PriceObservation[] | null = null;
const SETTINGS_KEY = 'vaultfolio.marketwatch.settings.v1';

/** Max observations to retain per metal (avoids unbounded storage growth) */
const MAX_OBSERVATIONS_PER_METAL = 500;

const DEFAULT_SETTINGS: MarketWatchSettings = {
  fetchesPerDay: 2,
  autoFetchEnabled: true,
  lastFetchAt: null,
  selectedMetal: 'XAU',
  selectedRange: '30d',
};

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem?(k: string): void;
}

function getStorage(custom?: StorageLike): StorageLike | null {
  if (custom) return custom;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export function loadMarketWatchSettings(storage?: StorageLike): MarketWatchSettings {
  try {
    const s = getStorage(storage);
    const raw = s?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<MarketWatchSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveMarketWatchSettings(s: MarketWatchSettings, storage?: StorageLike): void {
  try {
    const store = getStorage(storage);
    store?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage full: best-effort */
  }
}

export function loadPriceHistory(storage?: StorageLike): PriceObservation[] {
  // Memoized for synchronous valuation loops (explicit storage args bypass it).
  if (!storage && HISTORY_MEMO) return HISTORY_MEMO;
  try {
    const s = getStorage(storage);
    const raw = s?.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Validate each record minimally
    const list = parsed.filter(
      (r): r is PriceObservation =>
        r &&
        typeof r === 'object' &&
        typeof r.id === 'string' &&
        typeof r.price === 'number' &&
        r.price > 0 &&
        typeof r.metal === 'string' &&
        typeof r.retrievedAt === 'string',
    );
    if (!storage) HISTORY_MEMO = list;
    return list;
  } catch {
    return [];
  }
}

export function savePriceHistory(observations: PriceObservation[], storage?: StorageLike): void {
  try {
    const store = getStorage(storage);
    if (!store) return;
    // Cap per metal
    const byMetal = new Map<MetalCode, PriceObservation[]>();
    for (const obs of observations) {
      const list = byMetal.get(obs.metal) ?? [];
      list.push(obs);
      byMetal.set(obs.metal, list);
    }
    const capped: PriceObservation[] = [];
    for (const list of byMetal.values()) {
      const sorted = [...list].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt));
      capped.push(...sorted.slice(0, MAX_OBSERVATIONS_PER_METAL));
    }
    store.setItem(HISTORY_KEY, JSON.stringify(capped));
    if (!storage) HISTORY_MEMO = capped;
  } catch {
    /* storage full */
  }
}

/** Add new observations, deduplicating by (metal, providerTimestamp, providerId) */
export function mergeObservations(
  existing: PriceObservation[],
  incoming: PriceObservation[],
): PriceObservation[] {
  const keyOf = (o: PriceObservation) =>
    `${o.metal}::${o.providerId}::${o.providerTimestamp}`;
  const seen = new Set(existing.map(keyOf));
  const novel = incoming.filter((o) => !seen.has(keyOf(o)));
  return [...existing, ...novel];
}

export function observationsForMetal(
  history: PriceObservation[],
  metal: MetalCode,
): PriceObservation[] {
  return history
    .filter((o) => o.metal === metal)
    .sort((a, b) => a.retrievedAt.localeCompare(b.retrievedAt));
}

export function filterByRange(
  observations: PriceObservation[],
  range: MarketWatchSettings['selectedRange'],
): PriceObservation[] {
  if (range === 'all') return observations;
  const now = Date.now();
  const cutoffMs: Record<MarketWatchSettings['selectedRange'], number> = {
    '1h': 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
    all: Number.MAX_SAFE_INTEGER,
  };
  const cutoff = now - (cutoffMs[range] ?? Infinity);
  return observations.filter((o) => new Date(o.retrievedAt).getTime() >= cutoff);
}

/**
 * Change across a range of observations, computed from the actual first and
 * last data points in the (already range-filtered) slice.
 * Returns null when fewer than 2 valid observations exist — never a zero
 * masquerading for "no data".
 */
export function rangeChange(
  observations: PriceObservation[],
): { abs: number; pct: number | null; first: PriceObservation; last: PriceObservation } | null {
  if (observations.length < 2) return null;
  const first = observations[0];
  const last = observations[observations.length - 1];
  if (!Number.isFinite(first.price) || !Number.isFinite(last.price)) return null;
  const abs = last.price - first.price;
  const pct = first.price > 0 ? (abs / first.price) * 100 : null;
  return { abs, pct, first, last };
}

/* ─────────────────────────── Validation ─────────────────────────── */

export function validatePrice(metal: MetalCode, price: unknown, unit: string): string | null {
  if (price === null || price === undefined) return 'Price is missing';
  const n = Number(price);
  if (!Number.isFinite(n)) return 'Price is not a finite number';
  if (n <= 0) return 'Price is zero or negative';
  // Bounds check assumes USD / troy oz for precious metals, USD/lb for copper
  const bounds = PRICE_BOUNDS[metal];
  if (!bounds) return null; // unknown metal: accept
  // Only check bounds for expected units
  if (
    (unit === 'troy_ounce' || unit === 'pound') &&
    (n < bounds.min || n > bounds.max)
  ) {
    return `Price ${n} is outside expected range [${bounds.min}, ${bounds.max}] for ${metal}`;
  }
  return null; // valid
}

/* ─────────────────────────── Provider adapters ─────────────────────────── */

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ── GoldAPI.io adapter ── */
export const goldApiAdapter = {
  id: 'goldapi' as ProviderId,
  label: 'GoldAPI.io',
  supported: GOLDAPI_SUPPORTED,

  async fetchMetal(metal: MetalCode, apiKey: string): Promise<PriceObservation | null> {
    if (!GOLDAPI_SUPPORTED.includes(metal)) return null;
    const url = `https://www.goldapi.io/api/${metal}/USD`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        headers: { 'x-access-token': apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 429) {
          throw new RateLimitedError(
            `GoldAPI.io rate limit (HTTP 429) for ${metal}`,
            parseRetryAfter(res),
          );
        }
        return null;
      }
      const j = (await res.json()) as Record<string, unknown>;

      // Validate required fields
      const price = j.price;
      const unit = (j.unit as string) ?? 'troy_ounce';
      const validationErr = validatePrice(metal, price, unit);
      if (validationErr) {
        console.warn(`[MarketWatch] GoldAPI validation failed for ${metal}: ${validationErr}`);
        return null;
      }

      const timestamp = typeof j.timestamp === 'number'
        ? new Date(j.timestamp * 1000).toISOString()
        : typeof j.datetime === 'string'
        ? j.datetime
        : new Date().toISOString();

      const priceNum = Number(price);

      // Per-gram calculation: only for troy-ounce-denominated precious metals
      const pricePerGramUsd =
        unit === 'troy_ounce' && GOLDAPI_SUPPORTED.includes(metal)
          ? priceNum / GRAMS_PER_OZT
          : null;

      const changeVal = typeof j.change === 'number' ? j.change : null;
      const changePctVal = typeof j.change_percent === 'number' ? j.change_percent : null;

      return {
        id: newId(),
        metal,
        price: priceNum,
        currency: 'USD',
        unit,
        quoteType: 'spot',
        providerId: 'goldapi',
        providerTimestamp: timestamp,
        retrievedAt: new Date().toISOString(),
        change: changeVal,
        changePct: changePctVal,
        providerFresh: true, // GoldAPI doesn't report staleness explicitly on success
        exchangeLabel: typeof j.exchange === 'string' ? j.exchange : 'FOREXCOM',
        pricePerGramUsd,
      } satisfies PriceObservation;
    } catch (e) {
      if (e instanceof RateLimitedError) {
        throw e; // rate-limit info must survive fetchAll's per-metal loop
      }
      if ((e as Error).name === 'AbortError') {
        console.warn(`[MarketWatch] GoldAPI timeout for ${metal}`);
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  },

  async fetchAll(
    metals: MetalCode[],
    apiKey: string,
  ): Promise<{ observations: PriceObservation[]; errors: Record<MetalCode, string | null>; retryAfterMs: number | null }> {
    const supported = metals.filter((m) => GOLDAPI_SUPPORTED.includes(m));
    const unsupported = metals.filter((m) => !GOLDAPI_SUPPORTED.includes(m));

    const errors: Record<MetalCode, string | null> = {} as Record<MetalCode, string | null>;
    for (const m of unsupported) {
      errors[m] = `${m} is not supported by GoldAPI.io`;
    }

    const observations: PriceObservation[] = [];
    let retryAfterMs: number | null = null;
    // GoldAPI requires individual requests per metal
    for (const metal of supported) {
      let obs: PriceObservation | null;
      try {
        obs = await this.fetchMetal(metal, apiKey);
      } catch (e) {
        if (e instanceof RateLimitedError) {
          if (e.retryAfterMs !== null && (retryAfterMs === null || e.retryAfterMs > retryAfterMs)) {
            retryAfterMs = e.retryAfterMs;
          }
          errors[metal] = `${e.message}${e.retryAfterMs ? ` — back off ${Math.round(e.retryAfterMs / 1000)}s` : ''}`;
          continue;
        }
        throw e;
      }
      if (obs) {
        observations.push(obs);
        errors[metal] = null;
      } else {
        errors[metal] = `GoldAPI.io fetch failed for ${metal}`;
      }
    }
    return { observations, errors, retryAfterMs };
  },
};

/* ── gold-api.com adapter (keyless fallback) ── */
export const goldApiComAdapter = {
  id: 'goldapicom' as ProviderId,
  label: 'gold-api.com',
  supported: GOLDAPICOM_SUPPORTED,

  async fetchAll(
    metals: MetalCode[],
    _apiKey?: string, // keyless provider — parameter kept for adapter-shape compatibility
  ): Promise<{ observations: PriceObservation[]; errors: Record<MetalCode, string | null>; retryAfterMs: number | null }> {
    const supported = metals.filter((m) => GOLDAPICOM_SUPPORTED.includes(m));
    const unsupported = metals.filter((m) => !GOLDAPICOM_SUPPORTED.includes(m));

    const errors: Record<MetalCode, string | null> = {} as Record<MetalCode, string | null>;
    for (const m of unsupported) {
      errors[m] = `${m} is not supported by gold-api.com`;
    }

    const observations: PriceObservation[] = [];
    let retryAfterMs: number | null = null;

    // gold-api.com serves one symbol per endpoint — sequential requests
    for (const metal of supported) {
      const url = `https://api.gold-api.com/price/${GOLDAPICOM_SYMBOL[metal]}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) {
          if (res.status === 429) {
            const retry = parseRetryAfter(res);
            if (retry !== null && (retryAfterMs === null || retry > retryAfterMs)) {
              retryAfterMs = retry;
            }
            errors[metal] = `gold-api.com rate limit (HTTP 429) for ${metal}${retry ? ` — back off ${Math.round(retry / 1000)}s` : ''}`;
          } else {
            errors[metal] = `gold-api.com returned HTTP ${res.status} for ${metal}`;
          }
          continue;
        }

        const j = (await res.json()) as Record<string, unknown>;
        // Documented shape: { price: number, symbol, name, currency: 'USD', updatedAt: ISO-8601 }
        const rawPrice = j.price;
        const unit = goldApiComUnit(metal);
        const validationErr = validatePrice(metal, rawPrice, unit);
        if (validationErr) {
          errors[metal] = `gold-api.com validation: ${validationErr}`;
          continue;
        }

        const priceNum = Number(rawPrice);
        const providerTimestamp =
          typeof j.updatedAt === 'string' ? j.updatedAt : new Date().toISOString();

        observations.push({
          id: newId(),
          metal,
          price: priceNum,
          currency: 'USD',
          unit,
          quoteType: 'spot',
          providerId: 'goldapicom',
          providerTimestamp,
          retrievedAt: new Date().toISOString(),
          change: null,
          changePct: null,
          providerFresh: true,
          exchangeLabel: 'gold-api.com',
          pricePerGramUsd: unit === 'troy_ounce' ? priceNum / GRAMS_PER_OZT : null,
        });
        errors[metal] = null;
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          console.warn(`[MarketWatch] gold-api.com timeout for ${metal}`);
          errors[metal] = `gold-api.com request timed out for ${metal}`;
        } else {
          errors[metal] = `gold-api.com request failed for ${metal}`;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return { observations, errors, retryAfterMs };
  },
};

/* ─────────────────────────── Orchestrator ─────────────────────────── */

/**
 * Credentials are read from environment variables at call time,
 * never stored in source or bundled as constants.
 */
function readCredentials(): { goldApiKey: string | null } {
  return {
    goldApiKey: (import.meta.env.VITE_GOLDAPI_KEY as string | undefined) ?? null,
  };
}

/**
 * Attempt to fetch prices for the given metals using primary (GoldAPI)
 * then fallback (Goldsafe) when primary fails per-metal.
 *
 * Returns a ProviderResult describing what was fetched and from where.
 * Throws only if both providers fail entirely (partial per-metal errors
 * are represented in result.errors).
 */
export async function fetchLatestPrices(metals: MetalCode[]): Promise<ProviderResult> {
  const { goldApiKey } = readCredentials();
  const fetchedAt = new Date().toISOString();

  const allErrors: Record<MetalCode, string | null> = {} as Record<MetalCode, string | null>;
  let observations: PriceObservation[] = [];
  let providerUsed: ProviderId = 'goldapi';
  let fallbackUsed = false;
  let retryAfterMs: number | null = null;

  // --- Primary: GoldAPI.io ---
  const primaryMetals = metals.filter((m) => goldApiKey); // skip if no key
  let primaryResult: { observations: PriceObservation[]; errors: Record<MetalCode, string | null>; retryAfterMs: number | null } | null = null;

  if (goldApiKey && primaryMetals.length > 0) {
    primaryResult = await goldApiAdapter.fetchAll(primaryMetals, goldApiKey);
    observations = [...observations, ...primaryResult.observations];
    if (primaryResult.retryAfterMs !== null) {
      retryAfterMs = primaryResult.retryAfterMs;
    }
    for (const [metal, err] of Object.entries(primaryResult.errors)) {
      allErrors[metal as MetalCode] = err;
    }
  } else if (!goldApiKey) {
    for (const m of metals) {
      allErrors[m] = 'GoldAPI key not configured (VITE_GOLDAPI_KEY)';
    }
  }

  // Identify metals that primary missed or failed
  const primarySucceeded = new Set(
    (primaryResult?.observations ?? []).map((o) => o.metal),
  );
  const needsFallback = metals.filter((m) => !primarySucceeded.has(m));

  // --- Fallback: gold-api.com (keyless; always attempted for missing metals) ---
  if (needsFallback.length > 0) {
    fallbackUsed = true;
    const fallbackResult = await goldApiComAdapter.fetchAll(needsFallback);
    observations = [...observations, ...fallbackResult.observations];
    if (fallbackResult.retryAfterMs !== null && retryAfterMs === null) {
      retryAfterMs = fallbackResult.retryAfterMs;
    }
    for (const [metal, err] of Object.entries(fallbackResult.errors)) {
      // Only update the error if the primary also failed for that metal
      if (allErrors[metal as MetalCode]) {
        allErrors[metal as MetalCode] = err;
      }
    }
  }

  // Final provider tag: 'goldapi' iff at least one primary observation landed;
  // otherwise the keyless fallback carries the label.
  if (primarySucceeded.size > 0) {
    providerUsed = 'goldapi';
  } else if (fallbackUsed) {
    providerUsed = 'goldapicom';
  }

  return { observations, errors: allErrors, providerUsed, fallbackUsed, fetchedAt, retryAfterMs };
}

/* ─────────────────────────── Scheduling ─────────────────────────── */

/**
 * Returns the number of milliseconds until the next scheduled fetch.
 * Returns 0 if a fetch is due immediately.
 */
export function msUntilNextFetch(settings: MarketWatchSettings): number {
  if (!settings.autoFetchEnabled) return Infinity;
  const intervalMs = (24 * 60 * 60 * 1000) / Math.max(1, settings.fetchesPerDay);
  if (!settings.lastFetchAt) return 0; // never fetched
  const lastFetch = new Date(settings.lastFetchAt).getTime();
  if (Number.isNaN(lastFetch)) return 0;
  const nextFetch = lastFetch + intervalMs;
  const remaining = nextFetch - Date.now();
  return Math.max(0, remaining);
}

/** Human-readable description of the schedule */
export function scheduleDescription(settings: MarketWatchSettings): string {
  if (!settings.autoFetchEnabled) return 'Auto-fetch disabled';
  const n = settings.fetchesPerDay;
  if (n === 1) return 'Once per day';
  if (n === 2) return 'Twice per day (~12h intervals)';
  return `${n}× per day (~${Math.round(24 / n)}h intervals)`;
}

/**
 * Estimated monthly requests.
 * Both providers are billed per request: GoldAPI.io requires one request per
 * supported metal per run; the keyless gold-api.com fallback serves metals
 * GoldAPI.io does not (currently only XCU, via its HG code).
 * Note: when no GoldAPI.io key is configured, the fallback serves ALL metals;
 * this estimator does not model that configuration.
 */
export function estimateMonthlyRequests(
  fetchesPerDay: number,
  metals: MetalCode[],
): { goldapiRequests: number; goldapicomRequests: number; totalRequests: number } {
  const goldapiMetals = metals.filter((m) => GOLDAPI_SUPPORTED.includes(m));
  const goldapicomMetals = metals.filter((m) => !GOLDAPI_SUPPORTED.includes(m));
  // One request per metal per run for each provider (sequential)
  const goldapiRequests = goldapiMetals.length * fetchesPerDay * 30;
  const goldapicomRequests = goldapicomMetals.length * fetchesPerDay * 30;
  return {
    goldapiRequests,
    goldapicomRequests,
    totalRequests: goldapiRequests + goldapicomRequests,
  };
}

/* ─────────────────────────── Freshness helpers ─────────────────────────── */

export type FreshnessStatus = 'live' | 'recent' | 'stale' | 'offline';

export function freshnessStatus(latestObservation: PriceObservation | null): FreshnessStatus {
  if (!latestObservation) return 'offline';
  const ageMs = Date.now() - new Date(latestObservation.retrievedAt).getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  if (!latestObservation.providerFresh) return 'stale';
  if (ageHours < 1) return 'live';
  if (ageHours < 24) return 'recent';
  return 'stale';
}

export function freshnessLabel(status: FreshnessStatus): string {
  switch (status) {
    case 'live': return 'Live';
    case 'recent': return 'Recent';
    case 'stale': return 'Stale';
    case 'offline': return 'Offline';
  }
}

/* ─────────────────────────── Currency conversion helpers ─────────────────────────── */

/**
 * Convert a USD price per troy oz to LKR per gram.
 * Only safe when both prices are valid and the unit basis is known.
 * Returns null rather than fabricating a conversion with a stale/missing rate.
 */
export function usdPerOztToLkrPerGram(
  priceUsd: number,
  usdToLkr: number | null | undefined,
): number | null {
  if (!usdToLkr || usdToLkr <= 0) return null;
  if (!priceUsd || priceUsd <= 0) return null;
  return (priceUsd / GRAMS_PER_OZT) * usdToLkr;
}

export function formatObservationPrice(
  obs: PriceObservation,
  showPerGram = false,
): { value: string; unitLabel: string } {
  if (showPerGram && obs.pricePerGramUsd != null) {
    return {
      value: obs.pricePerGramUsd.toFixed(4),
      unitLabel: `USD / gram (${obs.exchangeLabel})`,
    };
  }
  return {
    value: obs.price.toFixed(2),
    unitLabel: `USD / ${METAL_META[obs.metal]?.displayUnit ?? obs.unit} (${obs.exchangeLabel})`,
  };
}

/* ─────────────────────────── Credential presence check ─────────────────────────── */

/** Non-secret check: are the required env variables set? */
export function credentialStatus(): {
  goldApiConfigured: boolean;
  fallbackProvider: string;
  anyConfigured: boolean;
} {
  const { goldApiKey } = readCredentials();
  const goldApiConfigured = !!goldApiKey && goldApiKey.length > 10;
  return {
    goldApiConfigured,
    fallbackProvider: 'gold-api.com (keyless)',
    // The fallback needs no credential, so live fetching is always possible.
    anyConfigured: true,
  };
}
