/**
 * Vaultfolio Intelligence 2.0 — Exploratory Data Analysis (EDA) Engine
 *
 * Automatically calculates descriptive statistics, distribution histograms,
 * pairwise Pearson correlation matrices, and a transparent Data Quality Score.
 */

import type { ExtractionResult, ExtractedRow } from './dataExtractor';

export interface NumericFeatureStats {
  column: string;
  count: number;
  missing: number;
  missingPct: number;
  mean: number;
  std: number;
  median: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
  outlierCount: number;
  skewness: number;
  distribution: { bin: string; count: number; rangeMin: number; rangeMax: number }[];
}

export interface CategoricalFeatureStats {
  column: string;
  count: number;
  missing: number;
  unique: number;
  topCategories: { label: string; count: number; percentage: number }[];
}

export interface CorrelationPair {
  featureA: string;
  featureB: string;
  correlation: number; // -1.0 to 1.0
  significance: 'strong_positive' | 'moderate_positive' | 'weak' | 'moderate_negative' | 'strong_negative';
}

export interface DataQualityReport {
  overallScore: number; // 0 to 100
  rating: 'Exceptional' | 'Good' | 'Moderate' | 'Limited';
  completenessPct: number;
  validityPct: number;
  sampleAdequacyPct: number;
  factors: {
    name: string;
    score: number;
    weight: number;
    description: string;
  }[];
  warnings: string[];
}

export interface EdaSummary {
  rowCount: number;
  featureCount: number;
  numericCount: number;
  categoricalCount: number;
  missingTotal: number;
  duplicateRows: number;
  numericStats: Record<string, NumericFeatureStats>;
  categoricalStats: Record<string, CategoricalFeatureStats>;
  correlationMatrix: {
    columns: string[];
    matrix: number[][]; // N x N
  };
  topCorrelations: CorrelationPair[];
  dataQuality: DataQualityReport;
}

/** Calculate mean of an array */
function calcMean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Calculate sample standard deviation */
function calcStd(arr: number[], mean: number): number {
  if (arr.length <= 1) return 0;
  const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/** Calculate percentile (0 to 1) from sorted array */
function calcPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/** Calculate skewness (Fisher-Pearson) */
function calcSkewness(arr: number[], mean: number, std: number): number {
  if (arr.length < 3 || std === 0) return 0;
  const n = arr.length;
  const m3 = arr.reduce((acc, val) => acc + Math.pow((val - mean) / std, 3), 0);
  return (n / ((n - 1) * (n - 2))) * m3;
}

/** Pearson correlation coefficient between two numeric vectors */
function calcPearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n <= 1) return 0;

  const meanX = calcMean(x);
  const meanY = calcMean(y);

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (den === 0) return 0;
  const r = num / den;
  return Math.max(-1, Math.min(1, r));
}

/**
 * Execute automated Exploratory Data Analysis on the extracted dataset.
 */
export function runAutomatedEda(dataset: ExtractionResult): EdaSummary {
  const rows = dataset.rows;
  const numericStats: Record<string, NumericFeatureStats> = {};
  const categoricalStats: Record<string, CategoricalFeatureStats> = {};

  // 1. Analyze numeric features
  for (const col of dataset.numericColumns) {
    const rawValues = rows.map((r) => r[col]);
    const validNumbers: number[] = [];
    let missing = 0;

    for (const v of rawValues) {
      if (v === null || v === undefined || v === '') {
        missing++;
      } else {
        const num = Number(v);
        if (!isNaN(num)) validNumbers.push(num);
        else missing++;
      }
    }

    const count = validNumbers.length;
    const missingPct = rows.length > 0 ? (missing / rows.length) * 100 : 0;

    if (count === 0) {
      numericStats[col] = {
        column: col,
        count: 0,
        missing,
        missingPct: 100,
        mean: 0,
        std: 0,
        median: 0,
        min: 0,
        max: 0,
        q1: 0,
        q3: 0,
        iqr: 0,
        outlierCount: 0,
        skewness: 0,
        distribution: [],
      };
      continue;
    }

    const sorted = [...validNumbers].sort((a, b) => a - b);
    const mean = calcMean(validNumbers);
    const std = calcStd(validNumbers, mean);
    const median = calcPercentile(sorted, 0.5);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const q1 = calcPercentile(sorted, 0.25);
    const q3 = calcPercentile(sorted, 0.75);
    const iqr = q3 - q1;

    // Outlier count using Tukey's fences (1.5 * IQR)
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const outliers = validNumbers.filter((v) => v < lowerFence || v > upperFence);
    const skewness = calcSkewness(validNumbers, mean, std);

    // Build 6-bin histogram
    const distribution: { bin: string; count: number; rangeMin: number; rangeMax: number }[] = [];
    const binCount = Math.min(6, Math.max(3, Math.floor(Math.sqrt(count))));
    const binWidth = max > min ? (max - min) / binCount : 1;

    for (let b = 0; b < binCount; b++) {
      const bMin = min + b * binWidth;
      const bMax = b === binCount - 1 ? max : min + (b + 1) * binWidth;
      const binItems = validNumbers.filter((v) =>
        b === binCount - 1 ? v >= bMin && v <= bMax : v >= bMin && v < bMax
      );

      const label =
        max >= 1000
          ? `${(bMin / 1000).toFixed(0)}k–${(bMax / 1000).toFixed(0)}k`
          : `${bMin.toFixed(0)}–${bMax.toFixed(0)}`;

      distribution.push({
        bin: label,
        count: binItems.length,
        rangeMin: Math.round(bMin),
        rangeMax: Math.round(bMax),
      });
    }

    numericStats[col] = {
      column: col,
      count,
      missing,
      missingPct: Math.round(missingPct * 10) / 10,
      mean: Math.round(mean * 100) / 100,
      std: Math.round(std * 100) / 100,
      median: Math.round(median * 100) / 100,
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      q1: Math.round(q1 * 100) / 100,
      q3: Math.round(q3 * 100) / 100,
      iqr: Math.round(iqr * 100) / 100,
      outlierCount: outliers.length,
      skewness: Math.round(skewness * 100) / 100,
      distribution,
    };
  }

  // 2. Analyze categorical features
  for (const col of dataset.categoricalColumns) {
    const rawValues = rows.map((r) => r[col]);
    const freqMap = new Map<string, number>();
    let missing = 0;

    for (const v of rawValues) {
      if (v === null || v === undefined || v === '') {
        missing++;
      } else {
        const str = String(v).trim();
        freqMap.set(str, (freqMap.get(str) ?? 0) + 1);
      }
    }

    const topCategories = Array.from(freqMap.entries())
      .map(([label, count]) => ({
        label,
        count,
        percentage: Math.round((count / rows.length) * 1000) / 10,
      }))
      .sort((a, b) => b.count - a.count);

    categoricalStats[col] = {
      column: col,
      count: rows.length - missing,
      missing,
      unique: freqMap.size,
      topCategories,
    };
  }

  // 3. Correlation matrix on numeric features
  const corrCols = dataset.numericColumns.filter((c) => {
    const s = numericStats[c];
    return s && s.std > 0; // Exclude zero variance
  });

  const matrix: number[][] = [];
  const topCorrelations: CorrelationPair[] = [];

  for (let i = 0; i < corrCols.length; i++) {
    const rowCorr: number[] = [];
    const colA = corrCols[i];
    const valsA = rows.map((r) => Number(r[colA] ?? 0));

    for (let j = 0; j < corrCols.length; j++) {
      if (i === j) {
        rowCorr.push(1.0);
      } else {
        const colB = corrCols[j];
        const valsB = rows.map((r) => Number(r[colB] ?? 0));
        const r = calcPearson(valsA, valsB);
        rowCorr.push(Math.round(r * 100) / 100);

        if (i < j && Math.abs(r) >= 0.25) {
          let sig: CorrelationPair['significance'] = 'weak';
          if (r >= 0.7) sig = 'strong_positive';
          else if (r >= 0.4) sig = 'moderate_positive';
          else if (r <= -0.7) sig = 'strong_negative';
          else if (r <= -0.4) sig = 'moderate_negative';

          topCorrelations.push({
            featureA: colA,
            featureB: colB,
            correlation: Math.round(r * 100) / 100,
            significance: sig,
          });
        }
      }
    }
    matrix.push(rowCorr);
  }

  // Sort correlations by absolute magnitude
  topCorrelations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  // 4. Data Quality Score computation
  const warnings: string[] = [];
  const totalCells = rows.length * dataset.columns.length;
  let totalMissing = 0;
  for (const r of rows) {
    for (const c of dataset.columns) {
      if (r[c.name] === null || r[c.name] === undefined || r[c.name] === '') {
        totalMissing++;
      }
    }
  }

  const completenessScore = totalCells > 0 ? Math.max(0, 100 - (totalMissing / totalCells) * 100) : 0;
  if (completenessScore < 90) {
    warnings.push(`Dataset contains ${(100 - completenessScore).toFixed(1)}% missing values.`);
  }

  // Sample adequacy
  let sampleScore = 100;
  if (rows.length < 10) {
    sampleScore = Math.max(30, rows.length * 8);
    warnings.push(`Sample size (${rows.length}) is limited. Training requires at least 10 observations.`);
  } else if (rows.length < 25) {
    sampleScore = 75;
  }

  // Variance & diversity
  let varianceScore = 100;
  const zeroVarCols = dataset.numericColumns.filter((c) => numericStats[c]?.std === 0);
  if (zeroVarCols.length > 0) {
    varianceScore = Math.max(40, 100 - zeroVarCols.length * 15);
    warnings.push(`Features with constant zero variance: ${zeroVarCols.join(', ')}.`);
  }

  const overallScore = Math.round(
    completenessScore * 0.4 + sampleScore * 0.4 + varianceScore * 0.2
  );

  let rating: DataQualityReport['rating'] = 'Good';
  if (overallScore >= 88) rating = 'Exceptional';
  else if (overallScore >= 72) rating = 'Good';
  else if (overallScore >= 55) rating = 'Moderate';
  else rating = 'Limited';

  const dataQuality: DataQualityReport = {
    overallScore,
    rating,
    completenessPct: Math.round(completenessScore * 10) / 10,
    validityPct: Math.round(varianceScore * 10) / 10,
    sampleAdequacyPct: Math.round(sampleScore * 10) / 10,
    factors: [
      { name: 'Feature Completeness', score: Math.round(completenessScore), weight: 40, description: 'Percentage of non-empty attributes' },
      { name: 'Sample Adequacy', score: Math.round(sampleScore), weight: 40, description: 'Evaluation statistical power & row count' },
      { name: 'Information Diversity', score: Math.round(varianceScore), weight: 20, description: 'Presence of informative feature variance' },
    ],
    warnings,
  };

  return {
    rowCount: rows.length,
    featureCount: dataset.columnCount,
    numericCount: dataset.numericColumns.length,
    categoricalCount: dataset.categoricalColumns.length,
    missingTotal: totalMissing,
    duplicateRows: 0,
    numericStats,
    categoricalStats,
    correlationMatrix: {
      columns: corrCols,
      matrix,
    },
    topCorrelations: topCorrelations.slice(0, 10),
    dataQuality,
  };
}
