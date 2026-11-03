import { describe, expect, it } from 'vitest';
import {
  classifyValuationNeed,
  latestRecordValue,
  metalsAppraisal,
  movementLabel,
  movementSincePrevious,
  questionsForAsset,
} from './appraisal';
import { buildAppraisalPrompt, parseAndValidate, type AppraisalPayload } from './aiValuation';
import { GeminiError } from './gemini';
import type { Asset, AssetCategory, GoldSilverAttrs, WatchAttrs, LandPropertyAttrs, CarAttrs, MarketSnapshot } from './types';

const baseAsset = (category: AssetCategory, attributes: unknown, valuationValue: number | null = null, updatedAt = '2026-11-01T00:00:00Z'): Asset => ({
  id: 'a1',
  userId: 'u1',
  category,
  name: 'Test asset',
  status: 'active',
  attributes: attributes as never,
  purchase: { priceLkr: 100000, currency: 'LKR', date: '2024-01-01', extraCostsLkr: 0 },
  valuation: { valueLkr: valuationValue, method: valuationValue === null ? 'unavailable' : 'user', sourceLabel: 'x', confidence: 'medium', updatedAt },
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt,
});

const completeWatchAttrs: WatchAttrs = {
  brand: 'Rolex',
  model: 'Submariner Date',
  reference: '126610LN',
  serial: 'AB123456',
  condition: 'Excellent',
  boxAndPapers: true,
};

const market: MarketSnapshot = {
  goldPerGramLkr: 24000,
  silverPerGramLkr: 100,
  usdLkr: 300,
  sourceLabel: 'test',
  asOf: new Date().toISOString(),
  isDemo: false,
  isLive: true,
};

/* ───────── Pre-filled facts suppress redundant questions ───────── */

describe('questionsForAsset', () => {
  it('a watch with reference/serial/condition/box+papers only asks what the record cannot know', () => {
    const q = questionsForAsset(baseAsset('watches', completeWatchAttrs)).map((x) => x.id);
    expect(q).toEqual(['service_history', 'extra_accessories', 'sell_market']);
  });

  it('an incomplete watch asks for reference, condition, box and serial', () => {
    const q = questionsForAsset(baseAsset('watches', { brand: 'Rolex', model: 'Submariner', boxAndPapers: false })).map((x) => x.id);
    expect(q).toContain('reference');
    expect(q).toContain('serial');
    expect(q).toContain('condition');
    expect(q).toContain('box_and_papers');
  });

  it('a complete land record skips district/city/extent/usage questions', () => {
    const attrs: LandPropertyAttrs = {
      propertyType: 'land', district: 'Colombo', city: 'Boralesgamuwa',
      sizePerches: 12, roadAccess: '20 ft road', utilities: 'yes', zoning: 'Residential',
    };
    const q = questionsForAsset(baseAsset('land_property', attrs)).map((x) => x.id);
    expect(q).not.toContain('district');
    expect(q).not.toContain('city');
    expect(q).not.toContain('extent');
    expect(q).not.toContain('usage');
    expect(q).not.toContain('utilities');
  });

  it('a car without year/mileage asks spec questions; variant only when missing', () => {
    const carAttrs: CarAttrs = { make: 'Aqua', model: 'Toyota Aqua', year: 2016, fuelType: 'Hybrid', condition: 'Good', variant: 'G' };
    const q = questionsForAsset(baseAsset('cars', carAttrs)).map((x) => x.id);
    expect(q).not.toContain('year');
    expect(q).not.toContain('fuel');
    expect(q).not.toContain('variant');
    const aVar: CarAttrs = { ...carAttrs, variant: null, mileageKm: null };
    const q2 = questionsForAsset(baseAsset('cars', aVar)).map((x) => x.id);
    expect(q2).toContain('mileage');
    expect(q2).toContain('variant');
  });

  it('a gold asset asks only the premium input (plus workmanship when jewellery)', () => {
    const goldAttrs: GoldSilverAttrs = { metal: 'gold', form: 'bullion', weight: 100, weightUnit: 'g', purity: '24k' };
    expect(questionsForAsset(baseAsset('gold_silver', goldAttrs)).map((x) => x.id)).toEqual(['premium_input']);
    const jew: GoldSilverAttrs = { ...goldAttrs, form: 'jewelry' };
    expect(questionsForAsset(baseAsset('gold_silver', jew)).map((x) => x.id)).toEqual(['craftsmanship_facts', 'premium_input']);
  });
});

/* ───────── Need classification & movement maths ───────── */

describe('classifyValuationNeed', () => {
  it('needs_first when no usable value', () => {
    expect(classifyValuationNeed(baseAsset('other', { kind: 'art' }, null), null)).toBe('needs_first');
  });
  it('fresh when the valuation is newer than the asset', () => {
    expect(classifyValuationNeed(baseAsset('other', { kind: 'art' }, 50000), '2026-11-02T00:00:00Z')).toBe('fresh');
  });
  it('info_changed when the asset was edited after its last valuation', () => {
    expect(classifyValuationNeed(baseAsset('other', { kind: 'art' }, 50000), '2026-10-31T00:00:00Z')).toBe('info_changed');
  });
  it('fresh for sold assets regardless of state', () => {
    const sold = { ...baseAsset('other', { kind: 'art' }, null), status: 'sold' as const };
    expect(classifyValuationNeed(sold, null)).toBe('fresh');
  });
});

describe('movementSincePrevious / movementLabel', () => {
  it('undefined without a finite previous value', () => {
    expect(movementSincePrevious(100, null)).toBeUndefined();
    expect(movementSincePrevious(100, 0)).toBeUndefined();
  });
  it('computes absolute and percentage change', () => {
    const m = movementSincePrevious(1200, 1000)!;
    expect(m.absChange).toBe(200);
    expect(m.pctChange).toBeCloseTo(0.2);
  });
  it('never calls an estimated change realised profit', () => {
    expect(movementLabel(movementSincePrevious(1200, 1000)!).text).toContain('not realized profit');
    expect(movementLabel(movementSincePrevious(900, 1000)!).dir).toBe('down');
  });
});

describe('latestRecordValue', () => {
  it('returns the newest finite record for the asset', () => {
    const recs = [
      { assetId: 'a1', valueLkr: 100, recordedAt: '2026-01-01T00:00:00Z' },
      { assetId: 'a1', valueLkr: 300, recordedAt: '2026-03-01T00:00:00Z' },
      { assetId: 'a1', valueLkr: 200, recordedAt: '2026-02-01T00:00:00Z' },
      { assetId: 'a2', valueLkr: 999, recordedAt: '2026-05-01T00:00:00Z' },
    ];
    expect(latestRecordValue(recs, 'a1')).toEqual({ valueLkr: 300, recordedAt: '2026-03-01T00:00:00Z' });
    expect(latestRecordValue(recs, 'zz')).toBeNull();
  });
  it('ignores null/NaN records', () => {
    expect(latestRecordValue([{ assetId: 'a1', valueLkr: null, recordedAt: '2026-01-01' }], 'a1')).toBeNull();
  });
});

/* ───────── Metals: deterministic, market-watch backed ───────── */

describe('metalsAppraisal', () => {
  it('returns null when there is no usable spot data (fresh cache in tests)', () => {
    const attrs: GoldSilverAttrs = { metal: 'gold', form: 'bullion', weight: 10, weightUnit: 'g', purity: '24k' };
    // In a clean test environment the observation store is empty → deterministic null, not a guess.
    expect(metalsAppraisal(attrs, market)).toBeNull();
  });
});

/* ───────── AI appraisal output validation ───────── */

const validOutput = {
  low_estimate_original: 900,
  expected_estimate_original: 1000,
  high_estimate_original: 1200,
  confidence: 'medium',
  methodology: 'Comparable completed sale patterns, adjusted for condition and completeness.',
  evidence: [{ description: 'Rolex 126610LN asking prices on a dealer site', source_kind: 'model_knowledge', listed_or_sold: 'ask', detail: 'three listings' }],
  positive_factors: ['Full box and papers'],
  negative_factors: ['Light wear on the bracelet'],
  explanation: 'The estimate covers the band typical for this reference in this condition and market.',
  missing_information_impact: '',
  insufficient_for_estimate: false,
};

describe('parseAndValidate', () => {
  it('passes valid model JSON through with clamped=false', () => {
    const v = parseAndValidate(JSON.stringify(validOutput));
    expect(v.clamped).toBe(false);
    expect(v.expected_estimate_original).toBe(1000);
    expect(v.sanitizedOutput.evidence).toHaveLength(1);
  });

  it('rejects invalid JSON with a schema-class GeminiError', () => {
    expect(() => parseAndValidate('not json')).toThrow(GeminiError);
  });

  it('rejects output violating the schema', () => {
    expect(() => parseAndValidate(JSON.stringify({ ...validOutput, confidence: 'weird' }))).toThrow(GeminiError);
    expect(() => parseAndValidate(JSON.stringify({ ...validOutput, low_estimate_original: -5 }))).toThrow(GeminiError);
  });

  it('clamps an inverted range so low ≤ expected ≤ high', () => {
    const v = parseAndValidate(JSON.stringify({ ...validOutput, low_estimate_original: 1100, high_estimate_original: 950 }));
    expect(v.clamped).toBe(true);
    expect(v.low_estimate_original).toBeLessThanOrEqual(v.expected_estimate_original);
    expect(v.expected_estimate_original).toBeLessThanOrEqual(v.high_estimate_original);
  });
});

describe('buildAppraisalPrompt', () => {
  const payload: AppraisalPayload = {
    categoryLabel: 'Luxury watch',
    assetName: 'Rolex Submariner Date',
    facts: [{ key: 'Reference number', value: '126610LN' }],
    answers: [{ key: 'Complete service history', value: 'yes, with papers' }],
    skippedQuestionLabels: ['Extra accessories'],
    marketContext: [],
    hasVerifiedMarketData: false,
    originalCurrency: 'LKR' as const,
    purchasePrice: 'LKR 1,200,000 (recorded at purchase)',
  };
  it('is grounded: includes the asset facts, answers and skips', () => {
    const p = buildAppraisalPrompt(payload);
    expect(p).toContain('126610LN');
    expect(p).toContain('Complete service history');
    expect(p).toContain('Extra accessories');
  });
  it('never hands the model the vault currency to re-price', () => {
    expect(buildAppraisalPrompt(payload)).toContain('Estimates are in LKR');
  });
  it('flushes fine-metal results so the model never re-guesses live prices', () => {
    const p = buildAppraisalPrompt({ ...payload, categoryLabel: 'Fine metal', marketContext: ['Fine-metal value computed by the app: LKR 220000.00'], hasVerifiedMarketData: true });
    expect(p).toContain('220000');
    expect(p).toContain('has_verified_market_data: true');
  });
});
