/**
 * Insights evidence pack — deterministic on-device analysis feeding AI
 * Insights.
 *
 * Everything the AI Insights feature says about numbers originates here,
 * computed from real stored data only:
 *   - the user's own portfolio aggregates (valuation engine),
 *   - append-only ValuationRecord history (per-asset and portfolio),
 *   - Market Watch provider observations on this device.
 *
 * Gemini may ONLY cite evidence IDs from this pack. Numeric values rendered
 * in insight cards are attached here at assembly time — never typed by the
 * model. This is what prevents invented percentages, fake holdings, and
 * fabricated history.
 */

import type { Asset, GoldSilverAttrs, MarketSnapshot, ValuationRecord } from './types';
import { statsFor, resolveAssetValuation } from './valuation';
import { categoryLabel } from './insightsContext';
import { metalNameToCode } from './spotValue';
import { portfolioMovers, valuationFreshness } from './insightsExtras';
import {
  METAL_META,
  type MetalCode,
  type PriceObservation,
} from './marketWatch';
import type { ReportPeriod } from './reports';

/* ───────────────────────────── Types ───────────────────────────── */

export interface EvidenceNumbers {
  label: string;
  value: string;
}

/** A small point series for an inline mini chart; x = epoch ms, y = value. */
export interface EvidenceSeries {
  label: string;
  points: Array<{ x: number; y: number }>;
  /** Description of the y-axis value, e.g. "LKR" or the metal quote unit. */
  unitLabel: string;
}

export interface EvidenceEntry {
  /** Stable id the model cites, e.g. `ev_metal_XAU`. */
  id: string;
  kind:
    | 'portfolio-totals'
    | 'period-change'
    | 'metal-market'
    | 'allocation'
    | 'holding'
    | 'mover'
    | 'freshness'
    | 'valuation-trend';
  /** One factual sentence describing the finding. */
  title: string;
  direction: 'up' | 'down' | 'flat';
  /** 1–4 pre-formatted numeric facts. */
  numbers: EvidenceNumbers[];
  /** Real data points for an inline mini chart; undefined when data is thin. */
  series?: EvidenceSeries;
  /** Honest data-coverage caveat, when applicable. */
  coverage: string;
}

export interface EvidencePack {
  asOf: string;
  period: ReportPeriod;
  totals: {
    activeAssets: number;
    valuedAssets: number;
    unvaluedAssets: number;
    totalValueLkr: number | null;
    totalCostLkr: number | null;
    usdLkr: number | null;
    usdLkrAsOf: string | null;
    usdLkrStale: boolean;
  };
  entries: EvidenceEntry[];
}

/* ─────────────────────── period mapping ───────────────────────── */

const PERIOD_MS: Record<ReportPeriod, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
};
const PERIOD_LABEL: Record<ReportPeriod, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

const fmtInt = (n: number): string => `${Math.round(n).toLocaleString('en-US')}`;
const fmtMoney = (n: number): string => `LKR ${fmtInt(n)}`;
const fmtPct = (f: number): string => `${f >= 0 ? '+' : '−'}${Math.abs(f * 100).toFixed(1)}%`;

/* ─────────────────────── window performance ───────────────────── */

/**
 * Baseline-vs-latest recorded-valuation performance over an arbitrary window.
 * Bounded windows compare each holding's latest record with its last record
 * at/before the cutoff; `fromEarliest` compares with the very first record
 * (all-time semantics). Holdings without an in-window baseline are excluded
 * and reported honestly.
 */
export function windowPerf(
  assets: Asset[],
  records: ValuationRecord[],
  cutoffIso: string,
  fromEarliest: boolean,
): {
  status: 'ok' | 'no_records' | 'no_baseline';
  baselineValue: number | null;
  currentValue: number | null;
  baselineAt: string | null;
  currentAt: string | null;
  deltaLkr: number | null;
  /** Fractional change (0.024 = +2.4 %); null when baseline ≤ 0. */
  deltaPct: number | null;
  comparedCount: number;
  excludedCount: number;
} {
  const active = new Set(assets.filter((a) => a.status === 'active').map((a) => a.id));
  const byAsset = new Map<string, ValuationRecord[]>();
  for (const r of records) {
    if (!active.has(r.assetId)) continue;
    if (r.valueLkr === null || r.valueLkr === undefined || !Number.isFinite(r.valueLkr)) continue;
    const list = byAsset.get(r.assetId) ?? [];
    list.push(r);
    byAsset.set(r.assetId, list);
  }
  const empty = { status: 'no_records' as const, baselineValue: null, currentValue: null, baselineAt: null, currentAt: null, deltaLkr: null, deltaPct: null, comparedCount: 0, excludedCount: 0 };
  if (byAsset.size === 0) return empty;

  let baselineSum = 0;
  let currentSum = 0;
  let compared = 0;
  let excluded = 0;
  let baselineAt: string | null = null;
  let currentAt: string | null = null;
  for (const [, list] of byAsset) {
    const sorted = [...list].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
    const baseline = fromEarliest ? sorted[0] : [...sorted].reverse().find((r) => r.recordedAt <= cutoffIso);
    if (!baseline) {
      excluded += 1;
      continue;
    }
    const latest = sorted[sorted.length - 1];
    compared += 1;
    baselineSum += Number(baseline.valueLkr);
    currentSum += Number(latest.valueLkr);
    if (!baselineAt || baseline.recordedAt > baselineAt) baselineAt = baseline.recordedAt;
    if (!currentAt || latest.recordedAt > currentAt) currentAt = latest.recordedAt;
  }
  if (compared === 0) {
    return { ...empty, status: 'no_baseline', excludedCount: excluded };
  }
  const deltaLkr = currentSum - baselineSum;
  return {
    status: 'ok',
    baselineValue: baselineSum,
    currentValue: currentSum,
    baselineAt,
    currentAt,
    deltaLkr,
    deltaPct: baselineSum > 0 ? deltaLkr / baselineSum : null,
    comparedCount: compared,
    excludedCount: excluded,
  };
}

/* ─────────────────────── pack construction ───────────────────── */

export function buildEvidencePack(args: {
  assets: Asset[];
  records: ValuationRecord[];
  market: MarketSnapshot | null;
  history: PriceObservation[];
  period: ReportPeriod;
}): EvidencePack {
  const { assets, records, market, history, period } = args;
  const entries: EvidenceEntry[] = [];
  const stats = statsFor(assets, market);
  const usdLkr = market?.usdLkr ?? null;

  const totals: EvidencePack['totals'] = {
    activeAssets: stats.activeCount,
    valuedAssets: stats.valuedCount,
    unvaluedAssets: stats.unvaluedCount,
    totalValueLkr: stats.totalValueLkr > 0 ? stats.totalValueLkr : null,
    totalCostLkr: stats.totalCostLkr > 0 ? stats.totalCostLkr : null,
    usdLkr,
    usdLkrAsOf: market?.fxAsOf ?? null,
    usdLkrStale: market?.fxStale ?? false,
  };

  const assetById = new Map(assets.map((a) => [a.id, a] as const));
  const recordsByAsset = new Map<string, ValuationRecord[]>();
  for (const r of records) {
    if (r.valueLkr === null || r.valueLkr === undefined || !Number.isFinite(r.valueLkr)) continue;
    const list = recordsByAsset.get(r.assetId) ?? [];
    list.push(r);
    recordsByAsset.set(r.assetId, list);
  }
  for (const list of recordsByAsset.values()) {
    list.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  }

  /* 1 — portfolio totals */
  entries.push({
    id: 'ev_portfolio_totals',
    kind: 'portfolio-totals',
    title:
      totals.totalValueLkr === null
        ? 'No active assets carry an estimated value yet.'
        : `Portfolio holds ${fmtInt(totals.activeAssets)} active assets, ${fmtInt(totals.valuedAssets)} of which are valued at ${fmtMoney(totals.totalValueLkr)}.`,
    direction: 'flat',
    numbers: [
      { label: 'Active assets', value: fmtInt(totals.activeAssets) },
      { label: 'Valued', value: fmtInt(totals.valuedAssets) },
      { label: 'Not yet valued', value: fmtInt(totals.unvaluedAssets) },
      { label: 'Total estimated value', value: totals.totalValueLkr === null ? '—' : fmtMoney(totals.totalValueLkr) },
    ],
    coverage:
      totals.unvaluedAssets > 0
        ? `${fmtInt(totals.unvaluedAssets)} active asset(s) have no estimated value and are excluded from totals.`
        : 'All active assets contribute.',
  });

  /* 2 — net change vs recorded cost (unrealised, never profit) */
  if (totals.totalCostLkr !== null && totals.totalCostLkr > 0 && stats.returnPct !== null && stats.returnPct !== undefined) {
    entries.push({
      id: 'ev_net_gain',
      kind: 'portfolio-totals',
      title: `Current estimates sit ${stats.gainLkr >= 0 ? 'above' : 'below'} recorded purchase cost by ${fmtPct((stats.returnPct ?? 0) / 100)} — unrealised valuation change, not realised profit.`,
      direction: stats.gainLkr > 0 ? 'up' : stats.gainLkr < 0 ? 'down' : 'flat',
      numbers: [
        { label: 'Total invested cost', value: fmtMoney(totals.totalCostLkr) },
        { label: 'Unrealised change vs cost', value: fmtMoney(Math.abs(stats.gainLkr ?? 0)) },
        { label: 'Change vs cost', value: fmtPct(stats.returnPct / 100) },
      ],
      coverage: 'Unrealised estimated appreciation; realised sale proceeds are excluded.',
    });
  }

  /* 3 — period performance from recorded valuation history */
  const cutoffIso = new Date(Date.now() - PERIOD_MS[period]).toISOString();
  const perf = windowPerf(assets, records, cutoffIso, false);
  if (perf.status === 'ok' && perf.deltaPct !== null && perf.deltaLkr !== null) {
    const windowLabel = PERIOD_LABEL[period];
    entries.push({
      id: 'ev_period_perf',
      kind: 'period-change',
      title: `Recorded portfolio value moved ${fmtPct(perf.deltaPct)} across the ${windowLabel} window over ${fmtInt(perf.comparedCount)} holding(s) with a recorded baseline.`,
      direction: perf.deltaLkr > 0 ? 'up' : perf.deltaLkr < 0 ? 'down' : 'flat',
      numbers: [
        { label: `Baseline (${perf.baselineAt ? new Date(perf.baselineAt).toLocaleDateString('en-US') : '—'})`, value: perf.baselineValue == null ? '—' : fmtMoney(perf.baselineValue) },
        { label: 'Latest recorded', value: perf.currentValue == null ? '—' : fmtMoney(perf.currentValue) },
        { label: `Change over ${windowLabel}`, value: `${fmtMoney(Math.abs(perf.deltaLkr))} ${perf.deltaLkr >= 0 ? 'gained' : 'lost'}` },
        { label: 'Change', value: fmtPct(perf.deltaPct) },
      ],
      series: buildTimelineSeries(assets, records, Date.now() - PERIOD_MS[period]),
      coverage:
        perf.excludedCount > 0
          ? `${fmtInt(perf.excludedCount)} holding(s) had no valuation recorded at/before the cutoff and are excluded — the change covers ${fmtInt(perf.comparedCount)} holding(s) only.`
          : 'Change covers all valued holdings with recorded history.',
    });
  } else {
    entries.push({
      id: 'ev_period_perf',
      kind: 'period-change',
      title: `No recorded valuation baseline inside the ${PERIOD_LABEL[period]} window (${perf.status === 'no_records' ? 'no valuation events at all yet' : 'nothing recorded in-window'}).`,
      direction: 'flat',
      numbers: [
        { label: 'Holdings with in-window baseline', value: '0' },
        { label: 'Holdings excluded', value: fmtInt(perf.excludedCount) },
      ],
      coverage: 'Use “Update valuation” on an asset to start recording history; the change appears once a baseline exists.',
    });
  }

  /* 4 — metal market moves + user's holdings (per metal) */
  const byMetal = new Map<MetalCode, PriceObservation[]>();
  for (const code of Object.keys(METAL_META) as MetalCode[]) byMetal.set(code, []);
  for (const o of history) {
    const list = byMetal.get(o.metal);
    if (list) list.push(o);
  }

  /* per-metal user holdings, matched through the app's own metal-name → code helper */
  const holdingsByCode = new Map<MetalCode, { count: number; grams: number; valueLkr: number }>();
  for (const a of assets) {
    if (a.status !== 'active' || a.category !== 'gold_silver') continue;
    const attrs = a.attributes as GoldSilverAttrs | undefined;
    if (!attrs?.metal) continue;
    const code = metalNameToCode(attrs.metal);
    if (!code) continue;
    const cur = holdingsByCode.get(code) ?? { count: 0, grams: 0, valueLkr: 0 };
    cur.count += 1;
    cur.grams += attrs.weight ?? 0;
    const resolved = resolveAssetValuation(a, market);
    if (resolved.valueLkr != null) cur.valueLkr += resolved.valueLkr;
    holdingsByCode.set(code, cur);
  }

  for (const [code, obs] of byMetal) {
    const meta = METAL_META[code];
    const holding = holdingsByCode.get(code);
    const hasHolding = !!holding && holding.count > 0;
    const inWindow = [...obs]
      .filter((o) => o.retrievedAt >= cutoffIso)
      .sort((a, b) => a.retrievedAt.localeCompare(b.retrievedAt));
    const latest = obs.length > 0 ? obs[obs.length - 1] : null;

    let marketPct: number | null = null;
    if (inWindow.length >= 2 && inWindow[0].price > 0) {
      marketPct = (inWindow[inWindow.length - 1].price - inWindow[0].price) / inWindow[0].price;
    }

    const numbers: EvidenceNumbers[] = [];
    if (marketPct !== null) {
      numbers.push({
        label: `${meta.label} market (${PERIOD_LABEL[period]})`,
        value: `${fmtPct(marketPct)} · ${fmtInt(inWindow[0].price)} → ${fmtInt(inWindow[inWindow.length - 1].price)} ${latest?.unit ?? meta.unit}`,
      });
    } else {
      numbers.push({
        label: `${meta.label} market`,
        value:
          latest !== null
            ? `${fmtInt(latest.price)} ${latest.unit} — no in-window move (${fmtInt(inWindow.length)} obs)`
            : 'No stored observations',
      });
    }
    if (hasHolding && holding) {
      numbers.push({ label: `Your ${meta.label.toLowerCase()} holdings`, value: `${fmtInt(holding.count)} holding(s) · ${fmtMoney(holding.valueLkr)}` });
      numbers.push({ label: 'Combined fine-weight', value: `${fmtInt(holding.grams)} g` });
    }

    const direction: EvidenceEntry['direction'] = marketPct === null ? 'flat' : marketPct > 0 ? 'up' : marketPct < 0 ? 'down' : 'flat';
    entries.push({
      id: `ev_metal_${code}`,
      kind: 'metal-market',
      title:
        marketPct !== null
          ? `${meta.label} spot moved ${fmtPct(marketPct)} across the ${PERIOD_LABEL[period]} window (${fmtInt(inWindow.length)} stored observations).` +
            (hasHolding && holding ? ` Estimated holding value: ${fmtMoney(holding.valueLkr)}.` : ' No holdings recorded in this metal.')
          : hasHolding && holding
            ? `${meta.label} observations are thin for the ${PERIOD_LABEL[period]} window; ${fmtInt(holding.count)} holding(s) value ${fmtMoney(holding.valueLkr)} on-device.`
            : `${meta.label} has ${latest !== null ? `${fmtInt(latest.price)} ${latest.unit} on record — ` : 'no stored observations and '}no user holdings.`,
      direction,
      numbers,
      series:
        inWindow.length >= 2
          ? {
              label: `${meta.label} ${latest?.unit ?? meta.unit}`,
              points: inWindow.slice(-60).map((o) => ({ x: new Date(o.retrievedAt).getTime(), y: o.price })),
              unitLabel: latest?.unit ?? meta.unit,
            }
          : undefined,
      coverage:
        inWindow.length < 2
          ? `Only ${fmtInt(inWindow.length)} ${meta.label} observation(s) inside the ${PERIOD_LABEL[period]} window — the market move is not reliably computable yet.`
          : 'Market move computed from stored provider observations on this device.',
    });
  }

  /* 5 — allocation + concentration */
  const allocation = buildAllocationEntries(assets);
  const totalAlloc = allocation.reduce((n, a) => n + a.valueLkr, 0);
  if (totalAlloc > 0 && allocation.length > 0) {
    const top = allocation[0];
    const topShare = (top.valueLkr / totalAlloc) * 100;
    entries.push({
      id: 'ev_concentration',
      kind: 'allocation',
      title: `${top.label} is the largest allocation at ${topShare.toFixed(1)}% of the valued portfolio.`,
      direction: topShare >= 50 ? 'down' : 'flat',
      numbers: [
        { label: `Largest allocation (${top.label})`, value: `${topShare.toFixed(1)}%` },
        { label: 'Categories represented', value: fmtInt(allocation.length) },
      ],
      coverage: 'Shares computed over valued assets only; un-valued holdings are excluded.',
    });
    for (const cat of allocation.slice(0, 3)) {
      const share = (cat.valueLkr / totalAlloc) * 100;
      entries.push({
        id: `ev_alloc_${cat.category}`,
        kind: 'holding',
        title: `${cat.label} accounts for ${share.toFixed(1)}% of the valued portfolio across ${fmtInt(cat.count)} asset(s).`,
        direction: share >= 50 ? 'down' : 'flat',
        numbers: [
          { label: `${cat.label} value`, value: fmtMoney(cat.valueLkr) },
          { label: 'Share', value: `${share.toFixed(1)}%` },
          { label: 'Assets', value: fmtInt(cat.count) },
        ],
        coverage: 'Category shares computed from current asset valuations only.',
      });
    }
  }

  /* 6 — top movers (biggest recorded valuation changes) */
  const movers = portfolioMovers(assets, records, 3);
  for (const m of movers) {
    const asset = assetById.get(m.id);
    entries.push({
      id: `ev_mover_${m.id}`,
      kind: 'mover',
      title: `${m.name} changed ${fmtPct(m.pct ?? 0)} — source: ${m.changeLabel} (${fmtInt(m.prevValueLkr)} → ${fmtInt(m.lastValueLkr)} LKR).`,
      direction: m.absLkr > 0 ? 'up' : m.absLkr < 0 ? 'down' : 'flat',
      numbers: [
        { label: `${m.name} previous valuation`, value: fmtMoney(m.prevValueLkr) },
        { label: `${m.name} latest valuation`, value: fmtMoney(m.lastValueLkr) },
        { label: 'Change', value: `${fmtPct(m.pct ?? 0)} · ${fmtMoney(Math.abs(m.absLkr))} ${m.absLkr > 0 ? 'gained' : 'lost'}` },
        { label: 'Change source', value: m.changeLabel },
      ],
      series: buildAssetSeries(recordsByAsset.get(m.id) ?? []),
      coverage: 'Recorded valuation change, not a realised sale.',
    });
  }

  /* 7 — valuation freshness */
  const freshness = valuationFreshness(assets, Number.MAX_SAFE_INTEGER);
  const stale = freshness.filter((f) => f.bucket === 'stale');
  if (stale.length > 0) {
    entries.push({
      id: 'ev_stale_valuations',
      kind: 'freshness',
      title: `${fmtInt(stale.length)} active asset(s) were last valued more than 30 days ago — totals may lag current conditions.`,
      direction: 'down',
      numbers: [
        { label: 'Stale valuations', value: fmtInt(stale.length) },
        { label: 'Examples', value: stale.slice(0, 3).map((f) => f.name).join(', ') || '—' },
      ],
      coverage: 'Staleness window: more than 30 days since the asset last received a recorded valuation.',
    });
  }

  /* 8 — recorded portfolio trend */
  const timeline = buildTimelineSeries(assets, records, null);
  if (timeline && timeline.points.length >= 3) {
    const first = timeline.points[0];
    const last = timeline.points[timeline.points.length - 1];
    const deltaPct = first.y > 0 ? (last.y - first.y) / first.y : null;
    entries.push({
      id: 'ev_valuation_trend',
      kind: 'valuation-trend',
      title:
        deltaPct !== null
          ? `Recorded valuation history spans ${fmtInt(timeline.points.length)} snapshots and sits ${fmtPct(deltaPct)} versus the earliest snapshot.`
          : `Recorded valuation history spans ${fmtInt(timeline.points.length)} snapshots.`,
      direction: deltaPct === null ? 'flat' : deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat',
      numbers: [
        { label: 'Earliest recorded total', value: fmtMoney(first.y) },
        { label: 'Latest recorded total', value: fmtMoney(last.y) },
        ...(deltaPct !== null ? [{ label: 'All-time recorded change', value: fmtPct(deltaPct) } as EvidenceNumbers] : []),
      ],
      series: timeline,
      coverage: 'Each point is a real recorded valuation event; nothing backfilled.',
    });
  }

  return {
    asOf: new Date().toISOString(),
    period,
    totals,
    entries,
  };
}

/* ─────────────────────── helpers ─────────────────────────────── */

function buildAssetSeries(records: ValuationRecord[]): EvidenceSeries | undefined {
  if (records.length < 2) return undefined;
  return {
    label: 'Recorded valuations',
    points: records.slice(-12).map((r) => ({ x: new Date(r.recordedAt).getTime(), y: r.valueLkr ?? 0 })),
    unitLabel: 'LKR',
  };
}

function buildTimelineSeries(assets: Asset[], records: ValuationRecord[], sinceMs: number | null): EvidenceSeries | undefined {
  const active = new Set(assets.filter((a) => a.status === 'active').map((a) => a.id));
  const byTs = new Map<number, Map<string, number>>();
  for (const r of records) {
    if (!active.has(r.assetId)) continue;
    if (r.valueLkr === null || r.valueLkr === undefined || !Number.isFinite(r.valueLkr)) continue;
    const ts = new Date(r.recordedAt).getTime();
    if (Number.isNaN(ts)) continue;
    if (sinceMs !== null && ts < sinceMs) continue;
    const bucket = byTs.get(ts) ?? new Map();
    bucket.set(r.assetId, r.valueLkr);
    byTs.set(ts, bucket);
  }
  const points = [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, byAsset]) => ({ x, y: [...byAsset.values()].reduce((n, v) => n + v, 0) }));
  if (points.length < 2) return undefined;
  return { label: 'Valuated portfolio', points: points.slice(-60), unitLabel: 'LKR' };
}

/**
 * Category-level allocation computed from the user's current asset records —
 * distinct from the AI's allocation commentary (which must cite this).
 */
function buildAllocationEntries(
  assets: Asset[],
): Array<{ category: string; label: string; valueLkr: number; count: number }> {
  const map = new Map<string, { category: string; label: string; valueLkr: number; count: number }>();
  for (const a of assets) {
    if (a.status !== 'active') continue;
    const v = a.valuation?.valueLkr;
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    const cur = map.get(a.category) ?? { category: a.category, label: categoryLabel(a.category), valueLkr: 0, count: 0 };
    cur.valueLkr += v;
    cur.count += 1;
    map.set(a.category, cur);
  }
  return [...map.values()].sort((a, b) => b.valueLkr - a.valueLkr);
}
