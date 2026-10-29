/**
 * Core domain types for Vaultfolio.
 * All monetary amounts are stored in LKR (the base currency).
 * A record's original currency is preserved for display purposes.
 */

export type AssetCategory =
  | 'gold_silver'
  | 'gems_jewelry'
  | 'watches'
  | 'land_property'
  | 'cars'
  | 'motorcycles'
  | 'other';

export type AssetStatus = 'active' | 'sold' | 'archived';

export type ValuationMethod =
  | 'live_market'
  | 'recent_market'
  | 'calculated'
  | 'user'
  | 'indicative'
  | 'unavailable';

export type ValuationConfidence = 'high' | 'medium' | 'low';

export type CurrencyCode = 'LKR' | 'USD';

/* ---- Unit facts (single source of truth) ---- */
export const GRAMS_PER_OZT = 31.1034768;
export const GRAMS_PER_TOLA = 11.6638038;
export const SQFT_PER_PERCH = 272.25; // Sri Lankan perch
export const SQM_PER_PERCH = 25.29285; // 272.25 * 0.09290304

export interface Money {
  /** Amount in LKR. */
  lkr?: number | null;
  /** Original entry amount, for provenance display. */
  originalAmount?: number | null;
  originalCurrency?: CurrencyCode;
}

export interface AssetPurchase {
  priceLkr?: number | null;
  currency?: CurrencyCode;
  priceOriginal?: number | null;
  date?: string | null; // ISO yyyy-mm-dd
  extraCostsLkr?: number | null;
}

/**
 * Valuation recorded on the asset. `method` states where the number came
 * from; user-entered values are NEVER overwritten by automated inference.
 */
export interface AssetValuation {
  valueLkr?: number | null;
  method: ValuationMethod;
  sourceLabel: string;
  confidence: ValuationConfidence;
  note?: string | null;
  updatedAt: string; // ISO datetime
}

export interface SaleRecord {
  date?: string | null;
  proceedsLkr?: number | null;
}

/* ---- Category attribute payloads ---- */
export interface GoldSilverAttrs {
  metal: 'gold' | 'silver' | 'copper' | 'platinum' | 'palladium';
  form: 'bullion' | 'coin' | 'jewelry' | 'other';
  weight: number;
  weightUnit: 'g' | 'kg' | 'ozt' | 'tola';
  /** Karat (gold), fineness description (silver), or explicit fraction. */
  purity: string;
  /** Expected dealer spread when reselling, % of fine-metal value. */
  dealerSpreadPct?: number | null;
  craftsmanshipNote?: string | null;
}

export interface GemsJewelryAttrs {
  itemType: 'gemstone' | 'jewelry';
  gemstoneType?: string | null;
  gemWeight?: number | null;
  gemWeightUnit?: 'ct' | 'g';
  material?: string | null;
  certification?: string | null;
  condition: string;
}

export interface WatchAttrs {
  brand: string;
  model: string;
  reference?: string | null;
  serial?: string | null; // private, never exported by default
  condition: string;
  boxAndPapers: boolean;
}

export interface LandPropertyAttrs {
  propertyType: string;
  district: string;
  city: string;
  address?: string | null;
  sizePerches?: number | null;
  sizeSqft?: number | null;
  sizeSqm?: number | null;
  roadAccess?: string | null;
  utilities?: string | null;
  zoning?: string | null;
}

export interface CarAttrs {
  make: string;
  model: string;
  year: number;
  variant?: string | null;
  mileageKm?: number | null;
  fuelType?: string | null;
  condition: string;
  registration?: string | null; // private
}

export interface MotorcycleAttrs {
  make: string;
  model: string;
  year: number;
  engineCc?: number | null;
  mileageKm?: number | null;
  condition: string;
}

export interface OtherAttrs {
  kind: string;
  description?: string | null;
}

export interface Asset {
  id: string;
  userId: string;
  category: AssetCategory;
  name: string;
  quantity?: number | null;
  status: AssetStatus;
  attributes:
    | GoldSilverAttrs
    | GemsJewelryAttrs
    | WatchAttrs
    | LandPropertyAttrs
    | CarAttrs
    | MotorcycleAttrs
    | OtherAttrs;
  purchase: AssetPurchase;
  valuation: AssetValuation;
  resaleValueLkr?: number | null;
  resaleNote?: string | null;
  notes?: string | null;
  image?: string | null;
  sold?: SaleRecord | null;
  createdAt: string;
  updatedAt: string;
}

/** A historical valuation event (append-only). */
export interface ValuationRecord {
  id: string;
  assetId: string;
  userId: string;
  valueLkr?: number | null;
  method: ValuationMethod;
  sourceLabel: string;
  confidence: ValuationConfidence;
  note?: string | null;
  recordedAt: string;
}

export interface AppSettings {
  displayCurrency: CurrencyCode;
  locale: string;
  theme: 'dark' | 'light' | 'system';
  ownerName: string;
}

export interface ManualPriceOverride {
  kind: 'gold_per_gram' | 'silver_per_gram' | 'usd_lkr';
  value: number;
  note?: string | null;
  setAt: string;
}

export interface MarketSnapshot {
  /** LKR per gram of 24k gold. */
  goldPerGramLkr?: number | null;
  /** LKR per gram of fine (999) silver. */
  silverPerGramLkr?: number | null;
  /** LKR per USD. */
  usdLkr?: number | null;
  sourceLabel: string;
  asOf: string;
  isDemo: boolean;
  isLive: boolean;
  /** Where the FX rate came from (independent of the metal-price source). */
  fxSourceLabel?: string | null;
  /** Provider timestamp for the FX rate, for auditing. */
  fxAsOf?: string | null;
  /** True when the FX quote served is a stale cache after a failed refresh. */
  fxStale?: boolean;
}

export interface PortfolioStats {
  totalValueLkr: number;
  totalCostLkr: number;
  valuedCount: number;
  unvaluedCount: number;
  activeCount: number;
  soldCount: number;
  gainLkr: number;
  returnPct?: number | null;
}

export interface DemoModeInfo {
  active: boolean;
  reason: string;
}
