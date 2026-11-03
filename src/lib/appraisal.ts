import type {
  Asset,
  AssetCategory,
  CarAttrs,
  GemsJewelryAttrs,
  GoldSilverAttrs,
  LandPropertyAttrs,
  MotorcycleAttrs,
  OtherAttrs,
  WatchAttrs,
  MarketSnapshot,
} from './types';
import { purityFraction, toGrams } from './units';
import { computeSpotValue, metalNameToCode, type SpotValuation } from './spotValue';
import { loadPriceHistory, observationsForMetal, type PriceObservation } from './marketWatch';

/**
 * Valuation Centre — appraisal engine.
 *
 * Deterministic app-code logic lives here; the AI provider only explains and
 * estimates over the compact, app-verified payload built from this module
 * (see aiValuation.ts). Nothing in this file ever invents a market figure:
 * metals values come from the existing MarketWatch observation store, and
 * every other category's questions/answers are user-supplied facts.
 */

/* ─────────────────────────── Reassessment cadence ─────────────────────────── */

export type ReassessmentCadence =
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'manual';

export const CADENCE_OPTIONS: { value: ReassessmentCadence; label: string }[] = [
  { value: 'manual', label: 'Manual only' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'semiannual', label: 'Every 6 months' },
  { value: 'annual', label: 'Annually' },
];

const CADENCE_DAYS: Record<ReassessmentCadence, number | null> = {
  manual: null,
  monthly: 30,
  quarterly: 91,
  semiannual: 183,
  annual: 365,
};

const PREFS_KEY = 'vaultfolio.valuationPrefs.v1';

export interface ValuationPrefs {
  cadence: ReassessmentCadence;
}

export const DEFAULT_VALUATION_PREFS: ValuationPrefs = { cadence: 'quarterly' };

export function loadValuationPrefs(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): ValuationPrefs {
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_VALUATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<ValuationPrefs>;
    const cadence = (CADENCE_OPTIONS as { value: string }[]).some((c) => c.value === parsed.cadence)
      ? (parsed.cadence as ReassessmentCadence)
      : DEFAULT_VALUATION_PREFS.cadence;
    return { cadence };
  } catch {
    return DEFAULT_VALUATION_PREFS;
  }
}

export function saveValuationPrefs(prefs: ValuationPrefs, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* non-fatal */
  }
}

/** True when the asset's last valuation record is older than its cadence (or missing). */
export function reassessmentDue(
  lastRecordedAt: string | null,
  cadence: ReassessmentCadence,
  now = Date.now(),
): boolean {
  if (cadence === 'manual') return false;
  if (!lastRecordedAt) return true;
  const t = new Date(lastRecordedAt).getTime();
  if (Number.isNaN(t)) return true;
  return now - t > CADENCE_DAYS[cadence]! * 86_400_000;
}

/* ─────────────────────────── Needs-valuation classification ─────────────────────────── */

export type ValuationNeed =
  | 'needs_first'      // no usable estimated value at all
  | 'reassess_due'     // cadence elapsed since the last record
  | 'info_changed'     // asset edited after its last valuation
  | 'fresh';           // nothing to do

export const VALUATION_NEED_LABEL: Record<ValuationNeed, string> = {
  needs_first: 'Needs a valuation',
  reassess_due: 'Reassessment due',
  info_changed: 'Information changed — consider a new valuation',
  fresh: 'Fresh',
};

export function classifyValuationNeed(asset: Asset, lastRecordedAt: string | null): ValuationNeed {
  if (asset.status !== 'active') return 'fresh';
  if (lastRecordedAt === null) {
    const noValue =
      asset.valuation?.valueLkr == null ||
      asset.valuation.method === 'unavailable' ||
      !Number.isFinite(asset.valuation.valueLkr);
    return noValue ? 'needs_first' : 'fresh';
  }
  const valued = new Date(lastRecordedAt).getTime();
  const changed = new Date(asset.updatedAt).getTime();
  if (Number.isFinite(changed) && changed > valued) {
    // Fixed identity fields (id/category/createdAt rows) don't count; updatedAt
    // only moves on real edits in updateAsset.
    return 'info_changed';
  }
  return 'fresh';
}

/** Category facet used for filter chips and title copy. */
export function appraiseBlurb(category: AssetCategory): string {
  switch (category) {
    case 'gold_silver': return 'Metal value is calculated from live Market Watch data — deterministic, not guessed.';
    case 'watches': return 'Compares brand, reference, condition and completeness to recent market patterns.';
    case 'land_property': return 'Values location, extent, access and infrastructure against surrounding-market patterns.';
    case 'cars': case 'motorcycles': return 'Uses specs, mileage and condition rather than just the model name.';
    case 'gems_jewelry': return 'Considers gem/carat details where supplied; never pretends to authenticate.';
    default: return 'Describe the item and the market context you know.';
  }
}

/* ─────────────────────────── Follow-up questions ─────────────────────────── */

export type AppraisalQuestionKind = 'text' | 'number' | 'choice' | 'boolean';

export interface AppraisalQuestion {
  /** Source field id; answers are keyed by this. */
  id: string;
  label: string;
  kind: AppraisalQuestionKind;
  /** Choices for kind === 'choice'. */
  options?: string[];
  placeholder?: string;
  /** One line explaining how the answer moves the valuation. */
  why: string;
  /** Question is optional — user may skip without blocking. */
  optional?: boolean;
  /** Numeric hint for kind === 'number'. */
  unit?: string;
}

/** Questions ONLY for what the asset record does not already know. */
export function questionsForAsset(asset: Asset): AppraisalQuestion[] {
  const q: AppraisalQuestion[] = [];
  const hmm = (id: string, label: string, why: string, rest: Partial<AppraisalQuestion> = {}) =>
    q.push({ id, label, why, optional: true, kind: 'text', ...rest });

  switch (asset.category) {
    case 'watches': {
      const a = asset.attributes as WatchAttrs;
      if (!a.reference?.trim()) hmm('reference', 'Reference number', 'Reference numbers pin the exact marketable model (e.g. Rolex 126610LN).', { kind: 'text', placeholder: 'e.g. 126610LN' });
      if (!a.serial?.trim()) hmm('serial', 'Serial number (optional, stays on-device)', 'Serial dating verifies production year in the AI context and is never exported.', { kind: 'text' });
      if (!a.condition?.trim()) hmm('condition', 'Condition', 'Condition is the largest valuation swing factor after the reference.', {
        kind: 'choice', options: ['Mint / unpolished', 'Excellent', 'Good', 'Worn', 'For parts / damaged'],
      });
      if (!a.boxAndPapers) hmm('box_and_papers', 'Original box and papers included?', 'Full sets consistently resale meaningfully above bare watches on the secondary market.', { kind: 'boolean' });
      // Service history and accessories are never persisted on the asset, so they are always asked.
      hmm('service_history', 'Complete service history available?', 'Documented servicing history supports authenticity and resale value.', { kind: 'boolean' });
      hmm('extra_accessories', 'Extra accessories (e.g. extra bracelet, warranty card…)', 'Extra-fitted parts and accessories can add value beyond the standard set.', { kind: 'text' });
      hmm('sell_market', 'Where do you expect resale to happen?', 'Different markets materially differ in realised prices; the estimate will reference that market.', { kind: 'text', placeholder: 'e.g. Sri Lanka, international' });
      break;
    }
    case 'land_property': {
      const a = asset.attributes as LandPropertyAttrs;
      if (!a.district?.trim()) hmm('district', 'District', 'District drives surrounding-market reference prices.', { kind: 'text', placeholder: 'e.g. Colombo' });
      if (!a.city?.trim()) hmm('city', 'City / village', 'Within-district micro-markets move on locality and outlook.', { kind: 'text', placeholder: 'e.g. Boralesgamuwa' });
      if (a.sizePerches == null && a.sizeSqft == null && a.sizeSqm == null) hmm('extent', 'Land extent', 'Extent converts to price-relative units (perches are the Sri Lankan standard).', { kind: 'number', unit: 'perches' });
      const extentShape = a.roadAccess == null ? 'road_access' : 'shape';
      hmm(extentShape, 'Road access (frontage/width if known)', 'Directness, frontage and public-road type are first-order price drivers of land.', { kind: 'text', placeholder: 'e.g. 20 ft public road frontage' });
      if (extentShape === 'road_access' && a.roadAccess) hmm('shape', 'Shape / terrain', 'Irregular or sloped plots generally command weaker prices despite equal extent.', { kind: 'text', placeholder: 'e.g. regular flat block' });
      const hasBlocks = a.zoning == null; // block availability pruned
      if (hasBlocks) hmm('usage', 'Intended usage', 'Residential, commercial and agricultural landed price bands differ widely.', { kind: 'choice', options: ['Residential', 'Commercial', 'Agricultural', 'Mixed / other'] });
      const utilitiesUnset = !a.utilities?.trim();
      if (utilitiesUnset) hmm('utilities', 'Electricity and water available?', 'Serviced plots transact in a materially stronger band than un-served ones.', { kind: 'boolean' });
      hmm('nearby', 'Nearby developments / facilities', 'Schools, offices and upcoming development lift locality demand.', { kind: 'text' });
      break;
    }
    case 'cars': case 'motorcycles': {
      const a = asset.attributes as CarAttrs | MotorcycleAttrs;
      if (a.year == null || a.year <= 0) hmm('year', 'Manufacturing year', 'Depreciation is tightly interval-driven on the make/model timeline.', { kind: 'number', placeholder: 'e.g. 2016' });
      if (a.mileageKm == null) hmm('mileage', 'Mileage (km)', 'Odometer is the practical secondary-market filter above condition.', { kind: 'number', unit: 'km' });
      if (!a.condition?.trim()) hmm('condition', 'Condition', 'Condition must be matched to the vehicle, not assumed.', {
        kind: 'choice', options: ['Excellent', 'Good', 'Average', 'Poor', 'Damaged'],
      });
      if (asset.category === 'cars') {
        const car = asset.attributes as CarAttrs;
        if (!car.fuelType?.trim()) hmm('fuel', 'Fuel type', 'Petrol/diesel/email-hybrid and EV segments re-price separately.', { kind: 'choice', options: ['Petrol', 'Diesel', 'Hybrid', 'Electric'] });
        if (!car.variant?.trim()) hmm('variant', 'Exact model & variant', 'Trim/variant demand differences, e.g. Base vs hybrid variants, are priced apart.', { kind: 'text' });
      }
      if (asset.category === 'motorcycles') {
        const bike = asset.attributes as MotorcycleAttrs;
        if (bike.engineCc == null) hmm('engine_cc', 'Engine capacity (cc)', 'Engine cc separates permit/demand classes of motorcycles.', { kind: 'number', unit: 'cc' });
      }
      hmm('service_records', 'Service history available?', 'Documented servicing supports valuation and, in some markets, re-sale pricing.', { kind: 'boolean' });
      hmm('accident_history', 'Any accident history?', 'Recorded accident history very strongly separates valuation bands for the same model.', { kind: 'boolean' });
      hmm('owners', 'Number of previous owners', 'Owner count is a standard discriminator, especially in the local market.', { kind: 'number', placeholder: 'e.g. 1' });
      hmm('import_status', 'Import status', 'Locally registered vs. freshly imported vehicles follow different price bands.', { kind: 'choice', options: ['Locally registered', 'Fresh import', 'Not sure'] });
      break;
    }
    case 'gems_jewelry': {
      const a = asset.attributes as GemsJewelryAttrs;
      if (a.itemType === 'gemstone') {
        if (!a.gemstoneType?.trim()) hmm('gem_type', 'Gem type', 'Gem family (e.g. sapphire, ruby, cat’s-eye) sets the valuation framework.', { kind: 'text', placeholder: 'e.g. Blue sapphire' });
        if (a.gemWeight == null) hmm('gem_weight', 'Carat weight', 'Carat-weight bands de-price in steps, not linearly per carat.', { kind: 'number', unit: 'ct' });
        hmm('cut', 'Cut quality', 'Proportion and cutting quality swing a gem’s valuation substantially.', { kind: 'choice', options: ['Excellent', 'Good', 'Fair', 'Poor / unknown'] });
        hmm('colour', 'Colour description (or grade if known)', 'Within a gem family colour saturation and hue dominate price.', { kind: 'text' });
        hmm('clarity', 'Clarity / visible inclusions', 'Eye-clean vs visibly included stones are priced in different bands.', {
          kind: 'choice', options: ['Eye-clean', 'Light inclusions', 'Visible inclusions', 'Unknown'],
        });
        if (!a.certification?.trim()) hmm('certification', 'Certification (lab & number, if any)', 'A respectable lab certificate materially de-risks the estimate; absence lowers confidence.', { kind: 'text', placeholder: 'e.g. GRS report' });
        hmm('gem_origin', 'Verified origin (if certified)', 'Origin premiums are only applied when evidence exists; never assumed.', { kind: 'text' });
      } else {
        if (!a.material?.trim()) hmm('material', 'Metal / material of the piece', 'Whether it is 22k gold, 18k, silver or valueless base metal changes the baseline.', { kind: 'text', placeholder: 'e.g. 22k gold' });
        if (!a.certification?.trim()) hmm('certification', 'Certification or hallmark present?', 'Hallmarks and certificates can be independently verified; absence is priced accordingly.', { kind: 'text' });
        hmm('craftsmanship', 'Workmanship / designer value', 'Named-designer or museum-level craftsmanship carries value beyond materials.', { kind: 'text' });
      }
      if (!a.condition?.trim()) hmm('condition', 'Condition', 'Wear and damage compose the estimate from actual, not catalogue, condition.', {
        kind: 'choice', options: ['Excellent', 'Good', 'Worn', 'Damaged'],
      });
      break;
    }
    case 'gold_silver': {
      const a = asset.attributes as GoldSilverAttrs;
      if (!a.craftsmanshipNote?.trim() && a.form === 'jewelry') hmm('craftsmanship_facts', 'Workmanship / brand of the piece', 'A well-recognised maker’s premium can be part of value; without one value stays at fine-metal content.', { kind: 'text' });
      hmm('premium_input', 'Any collectible premium you know of (optional %)', 'Only do so where evidence exists (e.g. issued-at premia on bullion); otherwise spot content value is used.', { kind: 'number', unit: '%', optional: true });
      break;
    }
    default: {
      const a = asset.attributes as OtherAttrs;
      if (!a.kind?.trim()) hmm('other_kind', 'What kind of item is it?', 'Broadly type and level (antique, art, collectible) frame the valuation.', { kind: 'text' });
      if (!a.description?.trim()) hmm('description', 'Describe maker, age, provenance and condition', 'Provenance and original packaging strongly affect the estimate for one-off pieces.', { kind: 'text' });
      break;
    }
  }
  return q;
}

/* ─────────────────────────── Metals: deterministic calc ─────────────────────────── */

export interface MetalsOptions {
  /** User-claimed collectible premium in % (0–50). Applied ONLY by explicit input. */
  premiumPct?: number | null;
}

export interface MetalsAppraisal {
  fineValueLkr: number;
  grams: number;
  purity: number;
  /** Expected = fine value at spot; premiums live only in the bounds. */
  expectedLkr: number;
  lowLkr: number;
  highLkr: number;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  premiumPct: number;
  /** Basis observation(s) the number came from. */
  spot: SpotValuation | null;
}

const STABLE_SPREAD = 0.05; // 5% typical dealer-spread band for the low bound

/**
 * Deterministic fine-metal value for a gold/silver/platinum/palladium asset,
 * derived from the SAME MarketWatch observation store every other page uses.
 * Never calls the model for prices; the premium input is user-supplied only.
 */
export function metalsAppraisal(
  attrs: GoldSilverAttrs,
  market: MarketSnapshot,
  options: MetalsOptions = {},
): MetalsAppraisal | null {
  const purity = purityFraction(attrs.purity);
  const usdLkr = market.usdLkr;
  if (purity === null || !(attrs.weight > 0) || !usdLkr || usdLkr <= 0) return null;
  const grams = toGrams(attrs.weight, attrs.weightUnit);

  const code = metalNameToCode(attrs.metal);
  let spot: SpotValuation | null = null;
  if (code) {
    spot = computeSpotValue({
      metalCode: code,
      weightGrams: grams,
      purity,
      observations: observationsForMetal(loadPriceHistory() as PriceObservation[], code),
      usdLkr,
      usdLkrAsOf: market.fxAsOf ?? null,
    });
  }

  const fineValueLkr = spot?.valueLkr ?? null;
  if (fineValueLkr === null || fineValueLkr <= 0) return null;

  const base = fineValueLkr;
  const premium = Math.min(50, Math.max(0, options.premiumPct ?? 0));
  const lowLkr = base * (1 - STABLE_SPREAD);
  const highLkr = premium > 0 ? base * (1 + premium / 100) : base;

  const basisLine = spot
    ? `${spot.instrumentLabel} (${spot.instrument}) spot ${spot.spotPerGramUsd.toFixed(4)} USD/g via ${spot.providerLabel}` +
      (spot.fxAsOf ? ` · FX ${usdLkr.toFixed(2)} LKR/USD (as of ${spot.fxAsOf})` : '')
    : 'fine-metal valuation source';

  return {
    fineValueLkr: base,
    grams,
    purity,
    expectedLkr: base,
    lowLkr,
    highLkr,
    explanation:
      `Fine-metal content: ${grams.toFixed(2)} g × ${(purity * 100).toFixed(1)}% purity, derived from ${basisLine} — ` +
      `LKR ${base.toFixed(0)} (USD ${(base / usdLkr).toFixed(0)}). ${spot?.stale ? 'WARNING: the spot price is not fresh; this is NOT presented as a live quote. ' : ''}` +
      `No collectible premium applied${premium > 0 ? ` EXCEPT your ${premium}% input shown in the high bound, which is your claim, not verified market evidence` : ''}. ` +
      'A real resale is typically BELOW fine value after dealer spreads and test deductions.',
    confidence: spot ? spot.confidence : 'low',
    premiumPct: premium,
    spot,
  };
}

/* ─────────────────────────── History helpers ─────────────────────────── */

export interface AssetValuationMovement {
  previousLkr: number | null;
  currentLkr: number;
  absChange: number;
  pctChange: number | null;
  previousDate: string | null;
}

export function movementSincePrevious(
  currentLkr: number,
  previousLkr: number | null,
  previousDate: string | null = null,
): AssetValuationMovement | null | undefined {
  if (previousLkr === null || !Number.isFinite(previousLkr) || previousLkr === 0) {
    return undefined;
  }
  const absChange = currentLkr - previousLkr;
  return {
    previousLkr,
    currentLkr,
    absChange,
    pctChange: absChange / Math.abs(previousLkr),
    previousDate,
  };
}

/** Neutral guard: never label an estimated appreciation as realised profit. */
export function movementLabel(m: AssetValuationMovement): { dir: 'up' | 'down' | 'flat'; text: string } {
  const dir = m.absChange > 0 ? 'up' : m.absChange < 0 ? 'down' : 'flat';
  const pct = m.pctChange === null ? '' : ` (${(m.pctChange * 100).toFixed(1)}%)`;
  return { dir, text: m.absChange === 0 ? 'Unchanged' : `Estimate moved ${m.absChange > 0 ? 'up' : 'down'}${pct} — an estimated change, not realized profit.` };
}

/** Latest value of the asset from its LAST (most recent) ValuationRecord, or null. */
export function latestRecordValue(records: { assetId: string; valueLkr?: number | null; recordedAt: string }[], assetId: string): { valueLkr: number | null; recordedAt: string } | null {
  const rec = records.filter((r) => r.assetId === assetId && r.valueLkr != null && Number.isFinite(r.valueLkr));
  if (rec.length === 0) return null;
  const latest = rec.reduce((a, b) => (new Date(b.recordedAt) > new Date(a.recordedAt) ? b : a));
  return { valueLkr: latest.valueLkr!, recordedAt: latest.recordedAt };
}
