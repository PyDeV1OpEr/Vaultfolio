/**
 * Vaultfolio Intelligence 2.0 — Analysis History & Run Persistence Store
 *
 * Saves and retrieves complete automated analysis runs locally, allowing users
 * to compare previous runs, view historical model metrics, and reload reports.
 */

import type { EdaSummary } from './edaEngine';
import type { IntelligenceReport } from './geminiIntelligence';
import type { CompareRow } from '../intel';

export interface SavedAnalysisRun {
  id: string;
  timestamp: string;
  datasetName: string;
  task: 'regression' | 'classification' | 'clustering';
  target: string;
  rowCount: number;
  featureCount: number;
  featuresUsed: string[];
  dataQualityScore: number;
  bestModel: {
    algorithm: string;
    label: string;
    scoreLabel: string;
    score: number;
    metrics: Record<string, unknown>;
  };
  comparison: CompareRow[];
  topFeatures: { feature: string; importance: number }[];
  eda: EdaSummary;
  report: IntelligenceReport;
  savedModelId?: string;
}

const STORAGE_KEY = 'vaultfolio.intelligence.runs.v2';
const MAX_SAVED_RUNS = 25;

export function loadAnalysisHistory(): SavedAnalysisRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('Failed to load analysis history:', err);
    return [];
  }
}

export function saveAnalysisRun(run: SavedAnalysisRun): void {
  try {
    const existing = loadAnalysisHistory();
    // Keep most recent first, limit to MAX_SAVED_RUNS
    const updated = [run, ...existing.filter((r) => r.id !== run.id)].slice(0, MAX_SAVED_RUNS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to persist analysis run:', err);
  }
}

export function deleteAnalysisRun(id: string): void {
  try {
    const existing = loadAnalysisHistory();
    const updated = existing.filter((r) => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to delete analysis run:', err);
  }
}

export function clearAnalysisHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear analysis history:', err);
  }
}
