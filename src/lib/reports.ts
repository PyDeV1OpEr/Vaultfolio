/**
 * Reports — Phase 5. Builds a verified market snapshot from REAL stored
 * observations, sends it to Gemini for structured analysis, and assembles a
 * report whose numbers come exclusively from the app's own data.
 *
 * Privacy model: report history lives in localStorage on the user's device
 * only (key `vf:reports:v1`), same as MarketWatch history. Nothing is synced.
 */

import { z } from 'zod';
import {
  METAL_META,
  filterByRange,
  observationsForMetal,
  rangeChange,
  type MarketWatchSettings,
  type MetalCode,
  type PriceObservation,
} from './marketWatch';
import {
  runGeminiReport,
  sanitizeModelText,
  type MarketSnapshot,
  type MetalSnapshot,
  type ReportAnalysis,
  type ReportPeriod,
} from './gemini';

export type { ReportPeriod };

/* ─────────────────────────── Report document ─────────────────────────── */

export interface MetalReportCard extends MetalSnapshot {
  trend: 'bullish' | 'bearish' | 'neutral' | 'uncertain' | 'no-analysis';
  outlook: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  supportingEvidence: string[];
  risks: string[];
  recommendation: 'hold' | 'monitor' | 'research_further' | 'insufficient_data' | 'no-analysis';
  reasoningSummary: string | null;
  /** Model's own view of the underlying data quality for this metal. */
  dataQuality: 'verified' | 'delayed' | 'incomplete' | 'stale' | null;
  /** True when the required fields could not be filled from verified data */
  incomplete: boolean;
}

export interface ReportSource {
  name: string;
  timestamp: string;
}

export interface MarketReportDoc {
  reportId: string;
  createdAt: string;
  period: ReportPeriod;
  /** Newest providerTimestamp across the metals included in the snapshot */
  dataAsOf: string | null;
  sources: ReportSource[];
  marketSummary: string;
  metals: MetalReportCard[];
  limitations: string[];
  disclaimer: string;
}

const DEFAULT_DISCLAIMER =
  'Informational analysis generated with Google Gemini from your locally stored provider data. Not a guaranteed prediction and not personalized financial advice.';

/* ─────────────────────────── Snapshot builder ─────────────────────────── */

const REPORT_PERIODS: ReportPeriod[] = ['24h', '7d', '30d', '90d'];

export function isReportPeriod(v: string): v is ReportPeriod {
  return (REPORT_PERIODS as string[]).includes(v);
}

/**
 * Build the Gemini market snapshot from the app's own stored observations.
 * Every price, timestamp, and period change here is REAL data — computed by
 * app code, never supplied by the model. Metals with no observations get
 * hasData=false and an explicit coverage note; nothing is fabricated.
 */
export function buildSnapshot(history: PriceObservation[], period: ReportPeriod): MarketSnapshot {
  const asOf = new Date().toISOString();

  const metals: MetalSnapshot[] = (Object.keys(METAL_META) as MetalCode[]).map((symbol) => {
    const all = observationsForMetal(history, symbol);
    const inWindow = filterByRange(all, period as MarketWatchSettings['selectedRange']);
    const latest = all.length > 0 ? all[all.length - 1] : null;

    const meta = METAL_META[symbol];
    const change = rangeChange(inWindow);

    let coverageNote: string | null = null;
    if (all.length === 0) {
      coverageNote = 'No observations stored yet — enable Market Watch fetching to build history.';
    } else if (inWindow.length === 0) {
      coverageNote = `No observations within the ${period} window; latest stored observation is from ${latest!.retrievedAt}.`;
    } else if (inWindow.length < 2) {
      coverageNote = `Only one observation inside the ${period} window — trend analysis for this period is not supported yet.`;
    }

    return {
      symbol,
      metal: meta.label,
      hasData: latest !== null,
      latestPrice: latest && Number.isFinite(latest.price) && latest.price > 0 ? latest.price : null,
      currency: (latest?.currency ?? 'USD') as 'USD',
      unit: latest?.unit ?? meta.unit,
      quoteType: latest?.quoteType ?? null,
      provider: latest?.providerId ?? null,
      providerTimestamp: latest?.providerTimestamp ?? null,
      observationCount: inWindow.length,
      firstObservedAt: inWindow.length > 0 ? inWindow[0].retrievedAt : null,
      lastObservedAt: inWindow.length > 0 ? inWindow[inWindow.length - 1].retrievedAt : null,
      periodChange: change
        ? {
            startPrice: change.first.price,
            endPrice: change.last.price,
            abs: change.abs,
            pct: change.pct,
            fromTime: change.first.retrievedAt,
            toTime: change.last.retrievedAt,
          }
        : null,
      coverageNote,
    };
  });

  return { period, asOf, metals };
}

/* ─────────────────────────── Report assembly ─────────────────────────── */

function newReportId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const NO_ANALYSIS_CARD_EXTRA = {
  trend: 'no-analysis' as const,
  outlook: null,
  confidence: null,
  supportingEvidence: [],
  risks: [],
  recommendation: 'no-analysis' as const,
  reasoningSummary: null,
  dataQuality: null,
  incomplete: true,
};

/**
 * Merge the model's returned analysis with the app-verified snapshot.
 * Prices are copied from the snapshot only — anything the model says about a
 * price not present in the snapshot is dropped.
 */
export function assembleReport(
  snapshot: MarketSnapshot,
  analysis: ReportAnalysis,
): MarketReportDoc {
  const analysisForSymbol = new Map(analysis.metals.map((m) => [m.symbol, m]));

  const metals: MetalReportCard[] = snapshot.metals.map((m): MetalReportCard => {
    const a = analysisForSymbol.get(m.symbol);
    const base: MetalReportCard = { ...m, ...NO_ANALYSIS_CARD_EXTRA };

    if (!a) {
      // Model omitted this metal entirely: keep the verified data, mark absent.
      return base;
    }

    return {
      ...base,
      trend: a.trend,
      outlook: sanitizeModelText(a.outlook),
      confidence: a.confidence,
      supportingEvidence: a.supporting_evidence.map(sanitizeModelText),
      risks: a.risks.map(sanitizeModelText),
      recommendation: a.recommendation,
      reasoningSummary: sanitizeModelText(a.reasoning_summary),
      dataQuality: a.data_quality,
      incomplete: false,
    };
  });

  const sources: ReportSource[] = [];
  const seenProviders = new Set<string>();
  for (const m of snapshot.metals) {
    if (m.provider && m.providerTimestamp && !seenProviders.has(m.provider)) {
      seenProviders.add(m.provider);
      sources.push({ name: m.provider, timestamp: m.providerTimestamp });
    }
  }

  const dataAsOf =
    snapshot.metals
      .map((m) => m.providerTimestamp)
      .filter((t): t is string => Boolean(t))
      .sort()
      .pop() ?? null;

  const providerNames = sources.map((s) => s.name);
  const periodNoData = snapshot.metals.filter((m) => !m.periodChange).map((m) => METAL_META[m.symbol].label);

  const autoLimitations: string[] = [];
  if (periodNoData.length > 0) {
    autoLimitations.push(
      `No ${snapshot.period} trend could be computed for: ${periodNoData.join(', ')} (insufficient stored observations).`,
    );
  }
  autoLimitations.push(
    `Prices are provider spot quotes (USD) retrieved from ${[...seenProviders].join(', ') || 'no provider yet'}; they may be delayed and are not exchange futures.`,
  );

  return {
    reportId: newReportId(),
    createdAt: snapshot.asOf,
    period: snapshot.period,
    dataAsOf,
    sources,
    marketSummary: sanitizeModelText(analysis.market_summary),
    metals,
    limitations: [
      ...analysis.limitations.map(sanitizeModelText),
      ...autoLimitations,
    ],
    disclaimer: DEFAULT_DISCLAIMER,
  };
}

/* ─────────────────────────── Report generation ─────────────────────────── */

export interface GenerateReportResult {
  report: MarketReportDoc;
  metalsSnapped: number;
  metalsWithInsufficientData: number;
}

/**
 * Generate a Gemini report for a specific period using stored history.
 * NOTE: no automatic retry — quota (429) responses surface exactly once so
 * the UI can show with Retry-After, rather than multiplying quota usage.
 */
export async function generateReport(
  history: PriceObservation[],
  period: ReportPeriod,
  apiKey: string,
): Promise<GenerateReportResult> {
  const snapshot = buildSnapshot(history, period);
  const { analysis } = await runGeminiReport(snapshot, apiKey); // throws GeminiError
  const report = assembleReport(snapshot, analysis);
  const insufficient = report.metals.filter((m) => m.incomplete || (!m.periodChange && m.observationCount < 2)).length;
  return {
    report,
    metalsSnapped: snapshot.metals.filter((m) => m.hasData).length,
    metalsWithInsufficientData: insufficient,
  };
}

/* ─────────────────────────── Local report history ─────────────────────────── */

const REPORT_HISTORY_KEY = 'vf:reports:v1';
export const REPORT_FORMAT_VERSION = 1;
const MAX_REPORTS = 50;

const reportSchema = z.object({
  reportId: z.string().min(5),
  createdAt: z.string().min(10),
  period: z.enum(REPORT_PERIODS as [ReportPeriod, ReportPeriod, ReportPeriod, ReportPeriod]),
  dataAsOf: z.string().nullable(),
  sources: z.array(z.object({ name: z.string().min(1), timestamp: z.string().min(4) })),
  marketSummary: z.string(),
  metals: z.array(
    z.object({
      symbol: z.enum(['XAU', 'XAG', 'XPT', 'XPD', 'XCU']),
      metal: z.string().min(1),
      hasData: z.boolean(),
      latestPrice: z.number().positive().nullable(),
      currency: z.string().min(1),
      unit: z.string().min(1),
      quoteType: z.string().nullable(),
      provider: z.string().nullable(),
      providerTimestamp: z.string().nullable(),
      observationCount: z.number().int().nonnegative(),
      firstObservedAt: z.string().nullable(),
      lastObservedAt: z.string().nullable(),
      periodChange: z
        .object({
          startPrice: z.number().positive(),
          endPrice: z.number().positive(),
          abs: z.number(),
          pct: z.number().nullable(),
          fromTime: z.string().min(4),
          toTime: z.string().min(4),
        })
        .nullable(),
      coverageNote: z.string().nullable(),
      trend: z.enum(['bullish', 'bearish', 'neutral', 'uncertain', 'no-analysis']),
      outlook: z.string().nullable(),
      confidence: z.enum(['low', 'medium', 'high']).nullable(),
      supportingEvidence: z.array(z.string()),
      risks: z.array(z.string()),
      recommendation: z.enum([
        'hold',
        'monitor',
        'research_further',
        'insufficient_data',
        'no-analysis',
      ]),
      reasoningSummary: z.string().nullable(),
      dataQuality: z.enum(['verified', 'delayed', 'incomplete', 'stale']).nullable(),
      incomplete: z.boolean(),
    }),
  ),
  limitations: z.array(z.string()),
  disclaimer: z.string(),
});

export type StoredReport = z.infer<typeof reportSchema>;

function parseStoredReports(raw: string): StoredReport[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StoredReport[] = [];
    for (const entry of parsed) {
      const res = reportSchema.safeParse(entry);
      if (res.success) out.push(res.data);
    }
    return out;
  } catch {
    return [];
  }
}

type ReportsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function listReportsInternal(storageLike: ReportsStorage): StoredReport[] {
  try {
    const raw = storageLike.getItem(REPORT_HISTORY_KEY);
    return raw ? parseStoredReports(raw) : [];
  } catch {
    return [];
  }
}

function saveReportsInternal(storageLike: ReportsStorage, reports: StoredReport[]): void {
  try {
    storageLike.setItem(
      REPORT_HISTORY_KEY,
      JSON.stringify(reports.slice(0, MAX_REPORTS)),
    );
  } catch {
    /* storage full — do not corrupt existing history */
  }
}

function defaultStore(): ReportsStorage {
  return window.localStorage;
}

export function listReports(storage: ReportsStorage = defaultStore()): StoredReport[] {
  return listReportsInternal(storage);
}

export function addReport(report: MarketReportDoc, storage: ReportsStorage = defaultStore()): void {
  const existing = listReportsInternal(storage);
  const next = [report, ...existing.filter((r) => r.reportId !== report.reportId)];
  saveReportsInternal(storage, next);
}

export function getReport(reportId: string, storage: ReportsStorage = defaultStore()): StoredReport | null {
  return listReportsInternal(storage).find((r) => r.reportId === reportId) ?? null;
}

export function deleteReport(reportId: string, storage: ReportsStorage = defaultStore()): void {
  const next = listReportsInternal(storage).filter((r) => r.reportId !== reportId);
  saveReportsInternal(storage, next);
}

export function clearReports(storage: ReportsStorage = defaultStore()): void {
  try {
    storage.removeItem(REPORT_HISTORY_KEY);
  } catch {
    /* noop */
  }
}
