/**
 * Vaultfolio Intelligence 2.0 — Automatic Data Extraction Service
 *
 * Automatically inspects the user's local unlocked portfolio (assets, valuation records,
 * market snapshots, and documents), normalizes and sanitizes attributes without data leakage,
 * and builds structured tabular datasets ready for machine-learning training and EDA.
 *
 * NO manual CSV export/upload is required by the user.
 */

import type { Asset, AssetCategory, DocumentRecord, MarketSnapshot, ValuationRecord } from '../types';

export interface ExtractedFeatureMeta {
  name: string;
  label: string;
  type: 'numeric' | 'categorical' | 'datetime' | 'identifier';
  description: string;
  isLeakageRisk?: boolean;
}

export interface ExtractedRow {
  [column: string]: string | number | null;
}

export interface ExtractionResult {
  datasetName: string;
  description: string;
  rowCount: number;
  usableRowCount: number;
  totalRecordsRetrieved: number;
  dateRangeCovered: {
    earliest: string;
    latest: string;
    spanYears: number;
    label: string;
  };
  columnCount: number;
  columns: ExtractedFeatureMeta[];
  numericColumns: string[];
  categoricalColumns: string[];
  rows: ExtractedRow[];
  csvContent: string;
  recommendedTask: 'regression' | 'classification' | 'clustering';
  recommendedTarget: string;
  candidateTargets: {
    column: string;
    task: 'regression' | 'classification';
    label: string;
  }[];
  dataQualityNotes: string[];
}

/** Helper to compute days between two dates */
function daysBetween(startIso: string | null | undefined, endIso: string | Date = new Date()): number {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = typeof endIso === 'string' ? new Date(endIso).getTime() : endIso.getTime();
  if (isNaN(start) || isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Normalize purity strings (24k, 22k, 18k, 999, etc.) to numeric carats */
function normalizePurityCarats(purity?: string | null): number {
  if (!purity) return 0;
  const p = purity.toLowerCase().trim();
  if (p.includes('24k') || p === '999' || p === '99.9') return 24;
  if (p.includes('22k') || p === '916') return 22;
  if (p.includes('18k') || p === '750') return 18;
  if (p.includes('14k') || p === '585') return 14;
  if (p.includes('10k') || p === '417') return 10;
  if (p.includes('925') || p.includes('sterling')) return 22.2; // ~92.5% fineness
  const match = p.match(/(\d+(\.\d+)?)/);
  if (match) {
    const val = parseFloat(match[1]);
    if (val <= 24) return val;
    if (val <= 1000) return (val / 1000) * 24;
  }
  return 0;
}

/** Map condition strings to 1-5 ordinal grade */
function normalizeConditionGrade(cond?: string | null): number {
  if (!cond) return 3; // neutral default
  const c = cond.toLowerCase().trim();
  if (c.includes('mint') || c.includes('new') || c.includes('unworn')) return 5;
  if (c.includes('excellent') || c.includes('near mint')) return 4;
  if (c.includes('good') || c.includes('very good')) return 3;
  if (c.includes('fair') || c.includes('average')) return 2;
  if (c.includes('poor') || c.includes('damaged')) return 1;
  return 3;
}

/**
 * Extracts the primary Asset Analysis Dataset from Vaultfolio holdings.
 */
export function extractPortfolioAssetDataset(
  assets: Asset[],
  records: ValuationRecord[] = [],
  market: MarketSnapshot | null = null,
  documents: DocumentRecord[] = []
): ExtractionResult {
  const now = new Date();
  const notes: string[] = [];

  // Filter to active assets
  const activeAssets = assets.filter((a) => a.status !== 'archived');
  if (activeAssets.length === 0) {
    notes.push('No active assets found in the local vault. Dataset is empty.');
  }

  // Spot prices
  const goldSpotPerGram = market?.goldPerGramLkr ?? 28500;
  const silverSpotPerGram = market?.silverPerGramLkr ?? 360;

  // Pre-index records and documents by assetId
  const recordsByAsset = new Map<string, ValuationRecord[]>();
  for (const r of records) {
    const list = recordsByAsset.get(r.assetId) ?? [];
    list.push(r);
    recordsByAsset.set(r.assetId, list);
  }

  const docsByAsset = new Set<string>();
  for (const d of documents) {
    if (d.assetId) docsByAsset.add(d.assetId);
  }

  // Scan date range and usable rows
  let earliestDateMs = Infinity;
  let latestDateMs = -Infinity;
  let usableRowCount = 0;

  for (const a of activeAssets) {
    const val = Number(a.valuation?.valueLkr ?? a.purchase?.priceLkr ?? 0);
    if (val > 0) usableRowCount++;

    const checkDate = (iso?: string | null) => {
      if (!iso) return;
      const t = new Date(iso).getTime();
      if (!isNaN(t) && t > 0) {
        if (t < earliestDateMs) earliestDateMs = t;
        if (t > latestDateMs) latestDateMs = t;
      }
    };
    checkDate(a.purchase?.date);
    checkDate(a.createdAt);
    checkDate(a.updatedAt);
  }

  for (const r of records) {
    if (r.recordedAt) {
      const t = new Date(r.recordedAt).getTime();
      if (!isNaN(t) && t > 0) {
        if (t < earliestDateMs) earliestDateMs = t;
        if (t > latestDateMs) latestDateMs = t;
      }
    }
  }

  const hasDates = earliestDateMs !== Infinity && latestDateMs !== -Infinity;
  const earliestStr = hasDates ? new Date(earliestDateMs).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const latestStr = hasDates ? new Date(latestDateMs).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const spanYears = hasDates
    ? Math.max(0.1, Math.round(((latestDateMs - earliestDateMs) / (365.25 * 86_400_000)) * 10) / 10)
    : 0;

  const dateRangeCovered = {
    earliest: earliestStr,
    latest: latestStr,
    spanYears,
    label: hasDates ? `${earliestStr} to ${latestStr} (${spanYears} yrs)` : 'Present',
  };

  const columns: ExtractedFeatureMeta[] = [
    { name: 'asset_id', label: 'Asset ID', type: 'identifier', description: 'Unique asset identifier', isLeakageRisk: true },
    { name: 'asset_name', label: 'Asset Name', type: 'identifier', description: 'Asset display title', isLeakageRisk: true },
    { name: 'category', label: 'Category', type: 'categorical', description: 'Primary asset class' },
    { name: 'form_type', label: 'Form Type', type: 'categorical', description: 'Physical asset form factor' },
    { name: 'condition_grade', label: 'Condition Grade', type: 'numeric', description: 'Physical condition rating (1-5)' },
    { name: 'purity_carats', label: 'Purity (Carats)', type: 'numeric', description: 'Precious metal fineness or karatage' },
    { name: 'fine_weight_g', label: 'Fine Weight (g)', type: 'numeric', description: 'Pure metal or total measured weight' },
    { name: 'stone_carats', label: 'Gem Weight (cts)', type: 'numeric', description: 'Carats of precious stone' },
    { name: 'asset_age_years', label: 'Asset Age (Years)', type: 'numeric', description: 'Age based on manufacture or purchase' },
    { name: 'holding_days', label: 'Holding Period (Days)', type: 'numeric', description: 'Days held since acquisition' },
    { name: 'has_documents', label: 'Has Verified Docs', type: 'numeric', description: 'Whether certificate or receipt is attached (1/0)' },
    { name: 'historical_valuation_count', label: 'Valuation Reassessments', type: 'numeric', description: 'Number of past appraisals on record' },
    { name: 'valuation_method', label: 'Valuation Method', type: 'categorical', description: 'Valuation technique applied' },
    { name: 'valuation_confidence', label: 'Valuation Confidence', type: 'categorical', description: 'Confidence level (high/medium/low)' },
    { name: 'purchase_cost_lkr', label: 'Purchase Cost (LKR)', type: 'numeric', description: 'Original acquisition cost basis' },
    { name: 'current_valuation_lkr', label: 'Current Valuation (LKR)', type: 'numeric', description: 'Present asset estimated valuation' },
    { name: 'gain_lkr', label: 'Gain / Loss (LKR)', type: 'numeric', description: 'Appreciation amount in LKR' },
    { name: 'gain_pct', label: 'Gain (%)', type: 'numeric', description: 'Percentage return over purchase cost' },
    { name: 'annualized_return_pct', label: 'Annualized Return (%)', type: 'numeric', description: 'Compound annual return percentage' },
    { name: 'performance_tier', label: 'Performance Tier', type: 'categorical', description: 'Classification tier: Outperforming / Steady / Underperforming' },
  ];

  const rows: ExtractedRow[] = [];

  for (const asset of activeAssets) {
    const assetRecords = recordsByAsset.get(asset.id) ?? [];
    const purchaseCost = asset.purchase?.priceLkr ?? 0;
    const currentVal = asset.valuation?.valueLkr ?? purchaseCost;
    const gainLkr = currentVal - purchaseCost;
    const gainPct = purchaseCost > 0 ? ((currentVal - purchaseCost) / purchaseCost) * 100 : 0;
    const holdingDays = Math.max(1, daysBetween(asset.purchase?.date, now));
    const holdingYears = holdingDays / 365.25;

    // Annualized return (CAGR)
    let cagr = 0;
    if (purchaseCost > 0 && currentVal > 0 && holdingYears >= 0.1) {
      cagr = (Math.pow(currentVal / purchaseCost, 1 / holdingYears) - 1) * 100;
      // Clamp extreme outliers for stability
      cagr = Math.max(-100, Math.min(500, cagr));
    }

    // Performance tier for classification
    let tier = 'Steady';
    if (gainPct >= 15) tier = 'Outperforming';
    else if (gainPct < 0) tier = 'Underperforming';

    // Extract attributes by category
    const attrs = (asset.attributes as unknown as Record<string, unknown>) ?? {};
    let formType = 'other';
    let purityCarats = 0;
    let fineWeightG = 0;
    let stoneCarats = 0;
    let conditionGrade = 3;
    let ageYears = holdingYears;

    if (asset.category === 'gold_silver') {
      formType = String(attrs.form ?? 'bullion');
      purityCarats = normalizePurityCarats(String(attrs.purity ?? '24k'));
      fineWeightG = Number(attrs.weightGrams ?? 0);
    } else if (asset.category === 'watches') {
      formType = 'timepiece';
      conditionGrade = normalizeConditionGrade(String(attrs.condition ?? 'good'));
      if (attrs.year && typeof attrs.year === 'number') {
        ageYears = Math.max(0, now.getFullYear() - attrs.year);
      }
    } else if (asset.category === 'gems_jewelry') {
      formType = 'jewelry';
      stoneCarats = Number(attrs.carat ?? 0);
      purityCarats = normalizePurityCarats(String(attrs.metal ?? '18k'));
      fineWeightG = Number(attrs.weightGrams ?? 0);
    } else if (asset.category === 'cars' || asset.category === 'motorcycles') {
      formType = 'vehicle';
      conditionGrade = normalizeConditionGrade(String(attrs.condition ?? 'good'));
      if (attrs.year && typeof attrs.year === 'number') {
        ageYears = Math.max(0, now.getFullYear() - attrs.year);
      }
    } else if (asset.category === 'land_property') {
      formType = 'real_estate';
      ageYears = holdingYears;
    }

    rows.push({
      asset_id: asset.id,
      asset_name: asset.name.replace(/[,"]/g, ' '),
      category: asset.category,
      form_type: formType,
      condition_grade: conditionGrade,
      purity_carats: Math.round(purityCarats * 10) / 10,
      fine_weight_g: Math.round(fineWeightG * 100) / 100,
      stone_carats: Math.round(stoneCarats * 100) / 100,
      asset_age_years: Math.round(ageYears * 10) / 10,
      holding_days: holdingDays,
      has_documents: docsByAsset.has(asset.id) ? 1 : 0,
      historical_valuation_count: assetRecords.length,
      valuation_method: asset.valuation?.method ?? 'user',
      valuation_confidence: asset.valuation?.confidence ?? 'medium',
      purchase_cost_lkr: Math.round(purchaseCost),
      current_valuation_lkr: Math.round(currentVal),
      gain_lkr: Math.round(gainLkr),
      gain_pct: Math.round(gainPct * 10) / 10,
      annualized_return_pct: Math.round(cagr * 10) / 10,
      performance_tier: tier,
    });
  }

  // Build CSV string
  const headerLine = columns.map((c) => c.name).join(',');
  const rowLines = rows.map((r) =>
    columns
      .map((c) => {
        const val = r[c.name];
        if (val === null || val === undefined) return '';
        if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
        return String(val);
      })
      .join(',')
  );
  const csvContent = [headerLine, ...rowLines].join('\n');

  const numericColumns = columns
    .filter((c) => c.type === 'numeric')
    .map((c) => c.name);
  const categoricalColumns = columns
    .filter((c) => c.type === 'categorical')
    .map((c) => c.name);

  // Targets
  const candidateTargets = [
    { column: 'current_valuation_lkr', task: 'regression' as const, label: 'Asset Valuation (LKR)' },
    { column: 'gain_pct', task: 'regression' as const, label: 'Appreciation Gain (%)' },
    { column: 'performance_tier', task: 'classification' as const, label: 'Performance Tier (Outperforming / Steady / Underperforming)' },
    { column: 'category', task: 'classification' as const, label: 'Asset Category' },
  ];

  // Auto-detect best task
  let recommendedTask: 'regression' | 'classification' | 'clustering' = 'regression';
  let recommendedTarget = 'current_valuation_lkr';

  if (rows.length < 10) {
    recommendedTask = 'clustering';
    recommendedTarget = '';
    notes.push(`Portfolio has ${rows.length} assets. Machine learning training requires at least 10 records for train/test evaluation; clustering and exploratory analysis will run.`);
  } else {
    // Check if current_valuation_lkr has non-zero variance
    const vals = rows.map((r) => Number(r.current_valuation_lkr));
    const uniqueVals = new Set(vals);
    if (uniqueVals.size > 2) {
      recommendedTask = 'regression';
      recommendedTarget = 'current_valuation_lkr';
    } else {
      recommendedTask = 'classification';
      recommendedTarget = 'category';
    }
  }

  return {
    datasetName: 'Portfolio_Assets_Analysis',
    description: 'Automated extract of tangible assets with physical attributes, purchase cost, valuation, and return metrics.',
    rowCount: rows.length,
    usableRowCount,
    totalRecordsRetrieved: activeAssets.length + records.length,
    dateRangeCovered,
    columnCount: columns.length,
    columns,
    numericColumns,
    categoricalColumns,
    rows,
    csvContent,
    recommendedTask,
    recommendedTarget,
    candidateTargets,
    dataQualityNotes: notes,
  };
}

/**
 * Extracts a combined Valuation Trajectory Dataset when multiple historical
 * valuation snapshots exist across portfolio assets over time.
 */
export function extractValuationTimelineDataset(
  assets: Asset[],
  records: ValuationRecord[] = [],
  market: MarketSnapshot | null = null
): ExtractionResult | null {
  if (records.length < 10) {
    return null; // Not enough timeline points
  }

  const assetMap = new Map<string, Asset>();
  for (const a of assets) assetMap.set(a.id, a);

  const columns: ExtractedFeatureMeta[] = [
    { name: 'record_id', label: 'Record ID', type: 'identifier', description: 'Valuation entry ID', isLeakageRisk: true },
    { name: 'asset_id', label: 'Asset ID', type: 'identifier', description: 'Asset ID', isLeakageRisk: true },
    { name: 'category', label: 'Category', type: 'categorical', description: 'Asset class' },
    { name: 'days_since_purchase', label: 'Days Since Purchase', type: 'numeric', description: 'Holding duration at observation' },
    { name: 'purchase_price_lkr', label: 'Cost Basis (LKR)', type: 'numeric', description: 'Original acquisition cost' },
    { name: 'observed_value_lkr', label: 'Observed Value (LKR)', type: 'numeric', description: 'Valuation amount recorded at this point' },
    { name: 'gain_from_cost_pct', label: 'Gain from Cost (%)', type: 'numeric', description: 'Percentage return at observation' },
    { name: 'valuation_confidence', label: 'Confidence', type: 'categorical', description: 'Appraisal confidence' },
    { name: 'valuation_method', label: 'Method', type: 'categorical', description: 'Valuation source method' },
  ];

  const rows: ExtractedRow[] = [];

  for (const r of records) {
    const asset = assetMap.get(r.assetId);
    if (!asset) continue;

    const purchaseDate = asset.purchase?.date;
    const recordDate = r.recordedAt;
    const daysSince = daysBetween(purchaseDate, recordDate);
    const cost = Number(asset.purchase?.priceLkr ?? r.valueLkr ?? 0);
    const val = Number(r.valueLkr ?? cost);
    const gainPct = cost > 0 ? ((val - cost) / cost) * 100 : 0;

    rows.push({
      record_id: r.id,
      asset_id: asset.id,
      category: asset.category,
      days_since_purchase: daysSince,
      purchase_price_lkr: Math.round(cost),
      observed_value_lkr: Math.round(val),
      gain_from_cost_pct: Math.round(gainPct * 10) / 10,
      valuation_confidence: r.confidence || 'medium',
      valuation_method: r.method || 'user',
    });
  }

  if (rows.length < 10) return null;

  const headerLine = columns.map((c) => c.name).join(',');
  const rowLines = rows.map((r) => columns.map((c) => String(r[c.name] ?? '')).join(','));
  const csvContent = [headerLine, ...rowLines].join('\n');

  return {
    datasetName: 'Valuation_Timeline_Trajectory',
    description: 'Time-series historical appraisal and spot observations across all portfolio holdings.',
    rowCount: rows.length,
    usableRowCount: rows.length,
    totalRecordsRetrieved: records.length,
    dateRangeCovered: {
      earliest: new Date().toISOString().slice(0, 10),
      latest: new Date().toISOString().slice(0, 10),
      spanYears: 1.0,
      label: 'All Historical Appraisals',
    },
    columnCount: columns.length,
    columns,
    numericColumns: ['days_since_purchase', 'purchase_price_lkr', 'observed_value_lkr', 'gain_from_cost_pct'],
    categoricalColumns: ['category', 'valuation_confidence', 'valuation_method'],
    rows,
    csvContent,
    recommendedTask: 'regression',
    recommendedTarget: 'observed_value_lkr',
    candidateTargets: [
      { column: 'observed_value_lkr', task: 'regression', label: 'Observed Value (LKR)' },
      { column: 'gain_from_cost_pct', task: 'regression', label: 'Gain from Cost (%)' },
    ],
    dataQualityNotes: [`Extracted ${rows.length} chronological appraisal observations.`],
  };
}
