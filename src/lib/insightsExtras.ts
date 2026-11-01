/**
 * Insights extras — derived analytics feeding the premium Insights surfaces:
 * period performance, biggest movers, metal market moves, valuation freshness,
 * and deterministic local summary cards.
 *
 * Data honesty contract:
 *  - Every number computed here originates from either the append-only
 *    ValuationRecord store (asset valuation history) or the Market-Watch
 *    observation store (verified provider observations). Nothing is
 *    synthesized, interpolated, or backfilled.
 *  - "Performance" means relative valuation change across recorded history.
 *    It is NOT investment return; realized sale prices are never mixed in.
 */

import { METAL_META, rangeChange, type MetalCode, type PriceObservation } from './marketWatch';
import { categoryMeta } from './categories';
import type { Asset, AssetCategory, ValuationRecord } from './types';

/* ── Selectable analysis periods ───────────────────────────────── */

export type PeriodKey = '7d' | '30d' | '90d' | '1y' | 'all';

export const PERIOD_OPTIONS: { id: PeriodKey; label: string; shortLabel: string }[] = [
  { id: '7d', label: '7 days', shortLabel: '7D' },
  { id: '30d', label: '30 days', shortLabel: '30D' },
  { id: '90d', label: '90 days', shortLabel: '90D' },
  { id: '1y', label: '1 year', shortLabel: '1Y' },
  { id: 'all', label: 'All time', shortLabel: 'All' },
];

const PERIOD_MS: Record<Exclude<PeriodKey, 'all'>, number> = {
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
  '1y': 365 * 86_400_000,
};

const DAY_MS = 86_400_000;

export type PerfStatus = 'ok' | 'no_records' | 'no_baseline';

export interface PortfolioPerformance {
  status: PerfStatus;
  period: PeriodKey;
  /** Current sum of latest recorded valuations for assets with a baseline. */
  currentValue: number | null;
  /** Sum of each asset's latest record at/before the period cutoff. */
  baselineValue: number | null;
  /** ISO timestamp of the latest record that formed the baseline. */
  baselineAt: string | null;
  /** ISO timestamp of the latest record feeding the current value. */
  currentAt: string | null;
  deltaLkr: number | null;
  /** Fractional change, e.g. 0.0243 = +2.43 %. null when baseline ≤ 0. */
  deltaPct: number | null;
  /** Assets included in BOTH the baseline and the current sums. */
  comparedCount: number;
  /** Assets with a current value but no record inside the window. */
  excludedCount: number;
  note: string;
}

interface AssetHistory {
  assetId: string;
  tail: ValuationRecord[]; // sorted oldest → newest
}

function relevantHistories(assets: Asset[], records: ValuationRecord[]): AssetHistory[] {
  const active = new Set(assets.filter((a) => a.status === 'active').map((a) => a.id));
  const byAsset = new Map<string, ValuationRecord[]>();
  for (const r of records) {
    if (!active.has(r.assetId)) continue;
    if (r.valueLkr === null || r.valueLkr === undefined || !Number.isFinite(r.valueLkr)) continue;
    const list = byAsset.get(r.assetId) ?? [];
    list.push(r);
    byAsset.set(r.assetId, list);
  }
  const out: AssetHistory[] = [];
  for (const [assetId, list] of byAsset) {
    list.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
    out.push({ assetId, tail: list });
  }
  return out;
}

function latestRecordThrough(h: AssetHistory, toIsoInclusive: string | null): ValuationRecord | null {
  if (toIsoInclusive === null) return h.tail[h.tail.length - 1] ?? null;
  let chosen: ValuationRecord | null = null;
  for (const r of h.tail) {
    if (r.recordedAt <= toIsoInclusive) chosen = r;
    else break;
  }
  return chosen;
}

/* ── Portfolio performance over a selectable period ────────────── */

export function computePortfolioPerformance(
  assets: Asset[],
  records: ValuationRecord[],
  period: PeriodKey,
  now = new Date(),
): PortfolioPerformance {
  const hist = relevantHistories(assets, records);

  const empty = (status: PerfStatus, note: string): PortfolioPerformance => ({
    status,
    period,
    currentValue: null,
    baselineValue: null,
    baselineAt: null,
    currentAt: null,
    deltaLkr: null,
    deltaPct: null,
    comparedCount: 0,
    excludedCount: 0,
    note,
  });

  if (hist.length === 0) {
    return empty('no_records', 'No recorded valuation events yet. “Update valuation” on any asset starts building history.');
  }

  const cutoff = period === 'all' ? null : new Date(now.getTime() - PERIOD_MS[period]).toISOString();

  const baseline = new Map<string, ValuationRecord>();
  let excluded = 0;
  for (const h of hist) {
    // 'all' compares against the asset's EARLIEST recorded valuation;
    // bounded windows compare against the latest record on/before the cutoff.
    const b = period === 'all' ? h.tail[0] ?? null : latestRecordThrough(h, cutoff);
    if (b) baseline.set(h.assetId, b);
    else excluded += 1;
  }

  if (baseline.size === 0) {
    return {
      ...empty('no_baseline',
        `No valuation recorded at or before the ${PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? 'period'} cutoff — nothing to compare against yet.`),
      excludedCount: hist.length, // every holding lacks a record inside the window
    };
  }

  let currentValue = 0;
  let baselineValue = 0;
  let compared = 0;
  let currentAt: string | null = null;
  for (const [assetId, b] of baseline) {
    const h = hist.find((x) => x.assetId === assetId);
    const l = h ? h.tail[h.tail.length - 1] : null;
    if (!l) continue;
    compared += 1;
    currentValue += Number(l.valueLkr);
    baselineValue += Number(b.valueLkr);
    if (!currentAt || l.recordedAt > currentAt) currentAt = l.recordedAt;
  }

  let baselineAt: string | null = null;
  for (const r of baseline.values()) {
    if (!baselineAt || r.recordedAt > baselineAt) baselineAt = r.recordedAt;
  }

  const deltaLkr = currentValue - baselineValue;
  const deltaPct = baselineValue > 0 ? deltaLkr / baselineValue : null;

  const notes: string[] = [`Compares current valuations with the last recorded value inside the window (${baseline.size} of ${hist.length} holding${hist.length === 1 ? '' : 's'}${excluded > 0 ? `; ${excluded} newer holding${excluded === 1 ? '' : 's'} excluded` : ''}).`];
  if (excluded > 0) notes.push(`${excluded} holding${excluded === 1 ? '' : 's'} had no valuation recorded inside the window.`);

  return {
    status: 'ok',
    period,
    currentValue,
    baselineValue,
    baselineAt,
    currentAt,
    deltaLkr,
    deltaPct,
    comparedCount: compared,
    excludedCount: excluded,
    note: notes.join(' '),
  };
}

/* ── Movers section ────────────────────────────────────────────── */

export interface AssetMover {
  id: string;
  name: string;
  category: AssetCategory;
  categoryLabel: string;
  changeSource: 'market' | 'user';
  changeLabel: string;
  prevValueLkr: number;
  prevAt: string;
  lastValueLkr: number;
  lastAt: string;
  absLkr: number;
  pct: number | null;
}

const CHANGE_LABELS: Record<AssetMover['changeSource'], string> = {
  market: 'market tracking (automated revaluation)',
  user: 'owner-adjusted estimate',
};

/** Latest two recorded valuations for one asset's history. */
export function assetValuationDelta(records: ValuationRecord[]): { last: ValuationRecord; prev: ValuationRecord } | null {
  if (records.length < 2) return null;
  const sorted = [...records].sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
  return { last: sorted[0], prev: sorted[1] };
}

export function portfolioMovers(assets: Asset[], records: ValuationRecord[], limit = 4): AssetMover[] {
  const hist = relevantHistories(assets, records);
  const rows: AssetMover[] = [];
  for (const h of hist) {
    const delta = assetValuationDelta(h.tail);
    if (!delta) continue;
    const asset = assets.find((a) => a.id === h.assetId);
    if (!asset) continue;
    const isMarket = delta.last.method !== 'user';
    const prev = Number(delta.prev.valueLkr);
    const last = Number(delta.last.valueLkr);
    rows.push({
      id: asset.id,
      name: asset.name,
      category: asset.category,
      categoryLabel: categoryMeta(asset.category).label,
      changeSource: isMarket ? 'market' : 'user',
      changeLabel: CHANGE_LABELS[isMarket ? 'market' : 'user'],
      prevValueLkr: prev,
      prevAt: delta.prev.recordedAt,
      lastValueLkr: last,
      lastAt: delta.last.recordedAt,
      absLkr: last - prev,
      pct: prev > 0 ? (last - prev) / prev : null,
    });
  }
  const withPct = rows.filter((r) => r.pct !== null);
  if (withPct.length === 0) return [];
  const sorted = [...withPct].sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!));
  const gainers = sorted.filter((r) => r.pct! > 0).slice(0, limit);
  const decliners = sorted.filter((r) => r.pct! < 0).slice(0, limit);
  const seen = new Set<string>();
  const out: AssetMover[] = [];
  for (const r of [...gainers, ...decliners]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/* ── Metal market moves (from Market-Watch observations) ───────── */

export interface MetalMove {
  code: MetalCode;
  label: string;
  unit: string;
  /** Fractional change over the stored observation window, e.g. 0.024 = +2.4 %. */
  pct: number | null;
  startIso: string;
  endIso: string;
  observationCount: number;
}

export function metalMoves(history: PriceObservation[]): MetalMove[] {
  const moves: MetalMove[] = [];
  for (const code of Object.keys(METAL_META) as MetalCode[]) {
    const obs = history
      .filter((o) => o.metal === code)
      .sort((a, b) => a.retrievedAt.localeCompare(b.retrievedAt));
    if (obs.length < 2) continue;
    const rc = rangeChange(obs);
    if (!rc || rc.pct === null) continue;
    moves.push({
      code,
      label: METAL_META[code].label,
      unit: METAL_META[code].displayUnit,
      pct: rc.pct / 100, // rangeChange speaks in percent; normalise to fraction
      startIso: rc.first.retrievedAt,
      endIso: rc.last.retrievedAt,
      observationCount: obs.length,
    });
  }
  return moves;
}

/* ── Valuation freshness ───────────────────────────────────────── */

export type FreshnessBucket = 'fresh' | 'aged' | 'stale' | 'unknown';

export interface AssetFreshness {
  id: string;
  name: string;
  categoryLabel: string;
  valuationUpdatedAt: string | null;
  bucket: FreshnessBucket;
  daysAgo: number | null;
}

export function valuationFreshness(assets: Asset[], limit = 5): AssetFreshness[] {
  const active = assets.filter((a) => a.status === 'active');
  const order: Record<FreshnessBucket, number> = { stale: 0, unknown: 1, aged: 2, fresh: 3 };
  const rows: AssetFreshness[] = [];
  for (const a of active) {
    const iso = a.valuation?.updatedAt ?? null;
    let bucket: FreshnessBucket = 'unknown';
    let days: number | null = null;
    if (iso) {
      const t = new Date(iso).getTime();
      if (!Number.isNaN(t)) {
        days = Math.floor((Date.now() - t) / DAY_MS);
        if (days <= 7) bucket = 'fresh';
        else if (days <= 30) bucket = 'aged';
        else bucket = 'stale';
      }
    }
    rows.push({
      id: a.id,
      name: a.name,
      categoryLabel: categoryMeta(a.category).label,
      valuationUpdatedAt: iso,
      bucket,
      daysAgo: days,
    });
  }
  return rows.sort((x, y) => order[x.bucket] - order[y.bucket]).slice(0, limit);
}

export function countStaleValuations(assets: Asset[]): number {
  return valuationFreshness(assets, Number.MAX_SAFE_INTEGER).filter((r) => r.bucket === 'stale').length;
}

/* ── Local (non-AI) summary cards ──────────────────────────────── */

export interface LocalInsightCard {
  id: string;
  title: string;
  body: string;
  tone: 'positive' | 'negative' | 'neutral' | 'accent';
  icon: 'trend-up' | 'trend-down' | 'balance' | 'clock' | 'alert' | 'info';
}

export function localInsightCards(args: {
  perf: PortfolioPerformance;
  movers: AssetMover[];
  totals: { totalValuedLkr: number; valuedCount: number; activeCount: number; unvaluedCount: number };
  staleCount: number;
  metalMoves: MetalMove[];
}): LocalInsightCard[] {
  const cards: LocalInsightCard[] = [];
  const { perf, totals } = args;

  if (perf.status === 'ok' && perf.deltaPct !== null) {
    const up = perf.deltaPct > 0;
    const flat = perf.deltaPct === 0;
    cards.push({
      id: 'perf',
      title: flat ? 'Portfolio value unchanged across the window' : `Portfolio ${up ? 'up' : 'down'} across the window`,
      body:
        `Across ${perf.comparedCount} holding${perf.comparedCount === 1 ? '' : 's'} with a recorded baseline, value moved ` +
        `${perf.deltaPct >= 0 ? '+' : ''}${(perf.deltaPct * 100).toFixed(2)}% as recorded valuations. ` +
        `Changes reflect valuation updates on record, not a realized sale.`,
      tone: flat ? 'neutral' : up ? 'positive' : 'negative',
      icon: flat ? 'balance' : up ? 'trend-up' : 'trend-down',
    });
  } else {
    cards.push({ id: 'perf', title: 'Not enough history yet', body: perf.note, tone: 'neutral', icon: 'info' });
  }

  if (totals.unvaluedCount > 0) {
    cards.push({
      id: 'unvalued',
      title: 'Valuation coverage gap',
      body: `${totals.unvaluedCount} active asset${totals.unvaluedCount === 1 ? '' : 's'} still lack an estimated value, so totals and shares understate true wealth until valued.`,
      tone: 'accent',
      icon: 'info',
    });
  }

  if (args.staleCount > 0) {
    cards.push({
      id: 'stale',
      title: 'Refresh stale valuations',
      body: `${args.staleCount} asset${args.staleCount === 1 ? '' : 's'} were last valued more than 30 days ago. Physical markets and metal prices move — re-confirm these estimates to keep analytics honest.`,
      tone: 'accent',
      icon: 'clock',
    });
  }

  const top = args.movers[0];
  if (top && top.pct !== null) {
    const up = top.pct > 0;
    cards.push({
      id: 'top-mover',
      title: `${top.name} is the biggest mover`,
      body: `Latest recorded change: ${up ? '+' : ''}${(top.pct * 100).toFixed(1)}% (${up ? '+' : '−'}${Math.abs(Math.round(top.absLkr)).toLocaleString('en-US')} LKR) — sourced from ${top.changeLabel}.`,
      tone: up ? 'positive' : 'negative',
      icon: up ? 'trend-up' : 'trend-down',
    });
  }

  const metal = args.metalMoves[0];
  if (metal && metal.pct !== null) {
    const up = metal.pct > 0;
    cards.push({
      id: 'metal',
      title: `${metal.label} is driving market moves`,
      body: `${metal.label} moved ${up ? '+' : ''}${(metal.pct * 100).toFixed(1)}% across your stored Market-Watch observations (${metal.observationCount} data points).`,
      tone: up ? 'positive' : 'negative',
      icon: up ? 'trend-up' : 'trend-down',
    });
  }

  return cards.slice(0, 4);
}
