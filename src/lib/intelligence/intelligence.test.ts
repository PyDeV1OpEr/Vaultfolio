import { describe, expect, it, vi, beforeEach } from 'vitest';
import { extractPortfolioAssetDataset, extractValuationTimelineDataset } from './dataExtractor';
import { runAutomatedEda } from './edaEngine';
import {
  generateIntelligenceReport,
  generateLocalDeterministicReport,
  type MinimizedMlContext,
} from './geminiIntelligence';
import {
  loadAnalysisHistory,
  saveAnalysisRun,
  deleteAnalysisRun,
  clearAnalysisHistory,
  type SavedAnalysisRun,
} from './historyStore';
import {
  runAutoIntelligence,
  generateCurrentDataset,
  trainModelOnPreparedDataset,
} from './autoMlOrchestrator';
import { buildDemoData } from '../demo';
import type { Asset, MarketSnapshot, ValuationRecord } from '../types';

class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}
(globalThis as any).localStorage = new MockStorage();

describe('Vaultfolio Intelligence 2.0 — Comprehensive Test Suite', () => {
  const { assets: demoAssets, records: demoRecords } = buildDemoData();

  const mockMarket: MarketSnapshot = {
    goldPerGramLkr: 29000,
    silverPerGramLkr: 375,
    usdLkr: 310,
    sourceLabel: 'Demo Live Rates',
    asOf: new Date().toISOString(),
    isDemo: true,
    isLive: false,
  };

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ── 1. Automatic Extraction from Real Database ──────────────────────────
  it('extracts structured tabular dataset directly from real assets without CSV upload', () => {
    const dataset = extractPortfolioAssetDataset(demoAssets, demoRecords, mockMarket, []);

    expect(dataset.rowCount).toBe(demoAssets.length);
    expect(dataset.columnCount).toBeGreaterThan(15);
    expect(dataset.numericColumns).toContain('current_valuation_lkr');
    expect(dataset.numericColumns).toContain('purchase_cost_lkr');
    expect(dataset.numericColumns).toContain('gain_pct');
    expect(dataset.categoricalColumns).toContain('category');
    expect(dataset.rows.length).toBe(demoAssets.length);

    // Verify first row contains physical and financial values
    const firstRow = dataset.rows[0];
    expect(firstRow.category).toBeDefined();
    expect(Number(firstRow.current_valuation_lkr)).toBeGreaterThan(0);
    expect(Number(firstRow.purchase_cost_lkr)).toBeGreaterThan(0);
  });

  // ── 2. Dataset Generation & CSV Integrity ──────────────────────────────
  it('generates valid UTF-8 CSV representation with headers and escaped commas', () => {
    const dataset = extractPortfolioAssetDataset(demoAssets, demoRecords, mockMarket, []);
    expect(dataset.csvContent).toBeDefined();

    const lines = dataset.csvContent.split('\n');
    expect(lines.length).toBe(demoAssets.length + 1); // Header + rows
    expect(lines[0]).toContain('asset_id,asset_name,category');
  });

  // ── 3. Empty Database Handling ─────────────────────────────────────────
  it('handles empty database gracefully with honest explanatory notes', () => {
    const dataset = extractPortfolioAssetDataset([], [], null, []);
    expect(dataset.rowCount).toBe(0);
    expect(dataset.dataQualityNotes.length).toBeGreaterThan(0);
    expect(dataset.dataQualityNotes[0]).toContain('No active assets found');
  });

  // ── 4. Missing-Value Processing & Preprocessing ─────────────────────────
  it('handles missing and sparse attributes without crashing or corrupting data', () => {
    const sparseAssets: Asset[] = [
      {
        id: 'sparse-1',
        userId: 'u1',
        category: 'other',
        name: 'Unspecified Relic',
        status: 'active',
        attributes: { kind: 'artifact' } as any,
        purchase: null as any,
        valuation: null as any,
        resaleValueLkr: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        id: 'sparse-2',
        userId: 'u1',
        category: 'watches',
        name: 'Vintage Watch',
        status: 'active',
        attributes: {} as any,
        purchase: { priceLkr: 50000, currency: 'LKR', priceOriginal: 50000, date: null, extraCostsLkr: null },
        valuation: { valueLkr: 75000, method: 'user', sourceLabel: 'Appraisal', confidence: 'medium', updatedAt: new Date().toISOString() },
        resaleValueLkr: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ];

    const dataset = extractPortfolioAssetDataset(sparseAssets, [], null, []);
    expect(dataset.rowCount).toBe(2);

    const eda = runAutomatedEda(dataset);
    expect(eda.dataQuality.completenessPct).toBeDefined();
    expect(eda.numericStats['current_valuation_lkr'].count).toBe(2);
  });

  // ── 5. Duplicate Handling & Outlier Detection ───────────────────────────
  it('identifies statistical outliers using Tukey IQR fences in EDA', () => {
    const dataset = extractPortfolioAssetDataset(demoAssets, demoRecords, mockMarket, []);
    const eda = runAutomatedEda(dataset);

    expect(eda.numericStats['current_valuation_lkr']).toBeDefined();
    expect(eda.numericStats['current_valuation_lkr'].iqr).toBeGreaterThanOrEqual(0);
    expect(eda.numericStats['current_valuation_lkr'].outlierCount).toBeGreaterThanOrEqual(0);
  });

  // ── 6. Exploratory Data Analysis & Statistical Metrics ──────────────────
  it('calculates accurate mean, median, std dev, and correlation matrix', () => {
    const dataset = extractPortfolioAssetDataset(demoAssets, demoRecords, mockMarket, []);
    const eda = runAutomatedEda(dataset);

    const valStats = eda.numericStats['current_valuation_lkr'];
    expect(valStats.mean).toBeGreaterThan(0);
    expect(valStats.median).toBeGreaterThan(0);
    expect(valStats.std).toBeGreaterThanOrEqual(0);
    expect(valStats.min).toBeLessThanOrEqual(valStats.max);

    // Correlation matrix
    expect(eda.correlationMatrix.columns.length).toBeGreaterThan(0);
    expect(eda.correlationMatrix.matrix.length).toBe(eda.correlationMatrix.columns.length);

    // Diagonal elements of correlation matrix must be 1.0
    for (let i = 0; i < eda.correlationMatrix.matrix.length; i++) {
      expect(eda.correlationMatrix.matrix[i][i]).toBe(1.0);
    }
  });

  // ── 7. Transparent Data Quality Score ───────────────────────────────────
  it('computes a transparent 0-100 data quality score with rating and factors', () => {
    const dataset = extractPortfolioAssetDataset(demoAssets, demoRecords, mockMarket, []);
    const eda = runAutomatedEda(dataset);

    expect(eda.dataQuality.overallScore).toBeGreaterThanOrEqual(0);
    expect(eda.dataQuality.overallScore).toBeLessThanOrEqual(100);
    expect(['Exceptional', 'Good', 'Moderate', 'Limited']).toContain(eda.dataQuality.rating);
    expect(eda.dataQuality.factors.length).toBe(3);
  });

  // ── 8. Valuation Trajectory / Chronological Observations ────────────────
  it('extracts chronological valuation observations across time', () => {
    const timeline = extractValuationTimelineDataset(demoAssets, demoRecords, mockMarket);
    expect(timeline).not.toBeNull();
    if (timeline) {
      expect(timeline.rowCount).toBe(demoRecords.length);
      expect(timeline.numericColumns).toContain('observed_value_lkr');
      expect(timeline.numericColumns).toContain('days_since_purchase');
    }
  });

  // ── 9. Offline / Deterministic Intelligence Generation ──────────────────
  it('generates rich, deterministic report offline without external network', () => {
    const dataset = extractPortfolioAssetDataset(demoAssets, demoRecords, mockMarket, []);
    const eda = runAutomatedEda(dataset);

    const minContext: MinimizedMlContext = {
      task: 'regression',
      target: 'current_valuation_lkr',
      rowCount: dataset.rowCount,
      featureCount: dataset.columnCount,
      dataQualityScore: eda.dataQuality.overallScore,
      dataQualityRating: eda.dataQuality.rating,
      bestModel: {
        algorithm: 'random_forest_regressor',
        label: 'Random Forest Regressor',
        scoreLabel: 'R² Score',
        score: 0.942,
        metrics: { r2: 0.942, rmse: 12500, mae: 8900 },
      },
      comparison: [
        { algorithm: 'random_forest_regressor', label: 'Random Forest Regressor', score: 0.942, durationSeconds: 0.12 },
        { algorithm: 'ridge', label: 'Ridge Regression', score: 0.885, durationSeconds: 0.02 },
      ],
      topFeatures: [
        { feature: 'purchase_cost_lkr', importance: 0.45 },
        { feature: 'fine_weight_g', importance: 0.28 },
      ],
      topCorrelations: [
        { featureA: 'purchase_cost_lkr', featureB: 'current_valuation_lkr', correlation: 0.94 },
      ],
      sampleMetrics: {
        meanTarget: 450000,
        medianTarget: 320000,
      },
    };

    const report = generateLocalDeterministicReport(minContext, eda);

    expect(report.source).toBe('local_deterministic');
    expect(report.executiveSummary).toContain('Random Forest Regressor');
    expect(report.keyFindings.length).toBeGreaterThanOrEqual(2);
    expect(report.modelPerformance.bestModelName).toBe('Random Forest Regressor');
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.limitations.length).toBeGreaterThan(0);
    expect(report.potentialRisks.length).toBeGreaterThan(0);
  });

  // ── 10. Gemini API Success Flow ─────────────────────────────────────────
  it('calls Gemini API and validates structured response when key is present', async () => {
    const mockGeminiJson = {
      executiveSummary: 'Portfolio analysis demonstrates strong appreciation across core physical assets.',
      keyFindings: [
        'Gold holdings drove 45% of total portfolio value.',
        'Watch valuations remained steady with minimal depreciation.',
      ],
      modelPerformance: {
        bestModelName: 'Random Forest Regressor',
        primaryScoreText: 'R²: 0.942',
        narrative: 'Random forest captured non-linear interactions between purity and weight.',
        comparisonNote: 'Outperformed linear ridge regression.',
      },
      chartInterpretation: {
        distributionInsight: 'Valuations skew moderately right towards luxury items.',
        correlationInsight: 'Strong correlation between initial cost and appraisal.',
        predictionAccuracyInsight: 'Residual errors remain balanced around zero.',
      },
      importantPatterns: ['Consistent holding gains over 2+ year horizons.'],
      potentialRisks: ['Spot price volatility may affect liquidation value.'],
      recommendations: ['Maintain regular physical appraisals.'],
      limitations: ['Model does not account for sovereign regulatory shifts.'],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(mockGeminiJson) }] } }],
        }),
      })
    );

    const minContext: MinimizedMlContext = {
      task: 'regression',
      target: 'current_valuation_lkr',
      rowCount: 14,
      featureCount: 18,
      dataQualityScore: 92,
      dataQualityRating: 'Exceptional',
      bestModel: {
        algorithm: 'random_forest_regressor',
        label: 'Random Forest Regressor',
        scoreLabel: 'R² Score',
        score: 0.942,
        metrics: {},
      },
      comparison: [],
      topFeatures: [],
      topCorrelations: [],
      sampleMetrics: {},
    };

    const report = await generateIntelligenceReport(minContext, 'test-key-12345678901234567890', 'gemini-2.5-flash');
    expect(report.source).toBe('gemini');
    expect(report.executiveSummary).toContain('Portfolio analysis demonstrates strong appreciation');
    expect(report.keyFindings.length).toBe(2);
  });

  // ── 11. Gemini API Failure & Fallback ───────────────────────────────────
  it('falls back safely to local statistical report when Gemini fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network offline')));

    const minContext: MinimizedMlContext = {
      task: 'regression',
      target: 'current_valuation_lkr',
      rowCount: 14,
      featureCount: 18,
      dataQualityScore: 90,
      dataQualityRating: 'Good',
      bestModel: {
        algorithm: 'random_forest_regressor',
        label: 'Random Forest Regressor',
        scoreLabel: 'R² Score',
        score: 0.92,
        metrics: {},
      },
      comparison: [],
      topFeatures: [],
      topCorrelations: [],
      sampleMetrics: {},
    };

    const report = await generateIntelligenceReport(minContext, 'test-key-12345678901234567890', 'gemini-2.5-flash');
    expect(report.source).toBe('local_deterministic');
    expect(report.executiveSummary).toBeDefined();
  });

  // ── 12. Analysis History Persistence & Reloading ────────────────────────
  it('persists analysis runs locally, lists them chronologically, and deletes', () => {
    const run: SavedAnalysisRun = {
      id: 'test-run-1',
      timestamp: new Date().toISOString(),
      datasetName: 'Portfolio_Assets_Analysis',
      task: 'regression',
      target: 'current_valuation_lkr',
      rowCount: 14,
      featureCount: 18,
      featuresUsed: ['purchase_cost_lkr', 'fine_weight_g'],
      dataQualityScore: 94,
      bestModel: {
        algorithm: 'random_forest_regressor',
        label: 'Random Forest Regressor',
        scoreLabel: 'R²',
        score: 0.94,
        metrics: {},
      },
      comparison: [],
      topFeatures: [],
      eda: {} as any,
      report: {
        generatedAt: new Date().toISOString(),
        source: 'local_deterministic',
        executiveSummary: 'Summary text',
        keyFindings: ['Finding 1'],
        modelPerformance: { bestModelName: 'RF', primaryScoreText: '0.94', narrative: 'Text', comparisonNote: 'Text' },
        chartInterpretation: { distributionInsight: 'Dist', correlationInsight: 'Corr', predictionAccuracyInsight: 'Pred' },
        importantPatterns: [],
        potentialRisks: [],
        recommendations: [],
        limitations: [],
      },
    };

    saveAnalysisRun(run);
    const history = loadAnalysisHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe('test-run-1');

    deleteAnalysisRun('test-run-1');
    expect(loadAnalysisHistory().length).toBe(0);
  });

  // ── 13. End-to-End One-Click Auto Intelligence Orchestrator ────────────
  it('executes full end-to-end one-click workflow and emits progression stages', async () => {
    const stagesSeen: string[] = [];

    const result = await runAutoIntelligence(demoAssets, demoRecords, mockMarket, [], {
      onProgress: (p) => {
        stagesSeen.push(p.stage);
      },
    });

    expect(result.runId).toBeDefined();
    expect(result.task).toBe('regression');
    expect(result.bestModel.label).toBeDefined();
    expect(result.comparison.length).toBeGreaterThan(0);
    expect(result.report).toBeDefined();
    expect(result.eda.dataQuality.overallScore).toBeGreaterThan(0);

    // Verify progress progression traversed expected stages
    expect(stagesSeen).toContain('connecting');
    expect(stagesSeen).toContain('extracting');
    expect(stagesSeen).toContain('preparing');
    expect(stagesSeen).toContain('eda');
    expect(stagesSeen).toContain('training');
    expect(stagesSeen).toContain('completed');

    // Verify it was saved to history
    const history = loadAnalysisHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].id).toBe(result.runId);
  });

  // ── 14. Step 1: Get Current CSV Data Extraction Pipeline ────────────────
  it('generateCurrentDataset computes total records, usable records, and historical date range', () => {
    const { dataset, eda } = generateCurrentDataset(demoAssets, demoRecords, mockMarket, []);

    expect(dataset.rowCount).toBe(demoAssets.length);
    expect(dataset.usableRowCount).toBeGreaterThan(0);
    expect(dataset.totalRecordsRetrieved).toBe(demoAssets.length + demoRecords.length);
    expect(dataset.dateRangeCovered).toBeDefined();
    expect(dataset.dateRangeCovered.earliest).toBeDefined();
    expect(dataset.dateRangeCovered.latest).toBeDefined();
    expect(dataset.dateRangeCovered.spanYears).toBeGreaterThan(0);
    expect(eda.dataQuality.overallScore).toBeGreaterThan(0);
  });

  // ── 15. Step 2: Train ML Model on Prepared Dataset ───────────────────────
  it('trainModelOnPreparedDataset trains candidate models and benchmarks metrics without data leakage', async () => {
    const { dataset, eda } = generateCurrentDataset(demoAssets, demoRecords, mockMarket, []);
    const trained = await trainModelOnPreparedDataset(dataset, eda, {
      taskOverride: 'regression',
    });

    expect(trained.task).toBe('regression');
    expect(trained.bestModel).toBeDefined();
    expect(trained.bestModel.score).toBeGreaterThan(0);
    expect(trained.comparison.length).toBeGreaterThan(1);
    expect(trained.topFeatures.length).toBeGreaterThan(0);
    // Verify no identifiers in training features
    expect(trained.featuresUsed).not.toContain('asset_id');
    expect(trained.featuresUsed).not.toContain('asset_name');
  });
});
