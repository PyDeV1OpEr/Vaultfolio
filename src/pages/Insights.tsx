import { useMemo } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  CircleHelp,
  PieChart as PieIcon,
  Scale,
  Sparkles,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import {
  allocationByCategory,
  assetMetrics,
  portfolioTimeline,
  resolveAssetValuation,
  statsFor,
} from '../lib/valuation';
import { categoryMeta } from '../lib/categories';
import { formatMoney, formatNumber, formatPercent, parseNum } from '../lib/money';
import { AllocationDonut, HistoryLine } from '../components/Charts';
import { Badge, Card, CardHeader, EmptyState } from '../components/ui';

export function Insights() {
  const { assets, records, market, settings } = useData();
  const usd = market?.usdLkr ?? null;
  const stats = useMemo(() => statsFor(assets, market), [assets, market]);
  const allocation = useMemo(() => allocationByCategory(assets, market), [assets, market]);
  const timeline = useMemo(() => portfolioTimeline(assets, records), [assets, records]);

  const fm = (v: number | null) => (v === null ? '—' : formatMoney(v, settings.displayCurrency, usd));

  if (assets.length === 0) {
    return (
      <EmptyState
        icon={<Sparkles size={20} />}
        title="Insights appear once you own assets"
        body="Add assets and valuations, and this page turns your records into honest analysis — no invented numbers."
      />
    );
  }

  const valuedAssets = assets
    .filter((a) => a.status === 'active' && resolveAssetValuation(a, market).valueLkr !== null)
    .sort((a, b) => (assetMetrics(b, market).currentValueLkr ?? 0) - (assetMetrics(a, market).currentValueLkr ?? 0));
  const top = valuedAssets[0];
  const newValued = valuedAssets.map((a) => ({ a, v: assetMetrics(a, market).currentValueLkr ?? 0 }));
  const totalValued = newValued.reduce((s, x) => s + x.v, 0);

  const gains = newValued
    .map((x) => assetMetrics(x.a, market))
    .filter((m) => m.unrealizedGainLkr !== null);
  const winners = gains.filter((m) => (m.unrealizedGainLkr ?? 0) > 0).length;
  const losers = gains.length - winners;

  const completeness = stats.activeCount > 0 ? stats.valuedCount / stats.activeCount : 0;
  const concentrationTop = allocation.length > 0 && totalValued > 0 ? allocation[0].valueLkr / totalValued : 0;

  const resaleKnown = newValued.filter((x) => assetMetrics(x.a, market).resaleValueLkr !== null);
  const resaleTotal = resaleKnown.reduce((s, x) => s + (assetMetrics(x.a, market).resaleValueLkr ?? 0), 0);

  const historyReady = timeline.length >= 3;
  const pct = (v: number) => formatPercent(v);
  const num1 = (v: number) => formatNumber(v, 'en-US', 1);

  return (
    <div className="max-w-5xl space-y-5 animate-fadeUp">
      <header>
        <h1 className="text-xl lg:text-2xl font-semibold">Insights</h1>
        <p className="text-sm text-txt-muted mt-1">
          Analysis built strictly from your recorded data — nothing backfilled, nothing assumed.
        </p>
      </header>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* What's my wealth */}
        <Card>
          <CardHeader title="What does your physical wealth look like?" subtitle={`${stats.activeCount} active assets · ${stats.unvaluedCount} unvalued (never counted as zero)`} />
          <div className="px-5 pb-5 space-y-3">
            {(top ? [
              ['Estimated wealth (tracked)', stats.totalValueLkr],
              ['What you paid', stats.totalCostLkr],
              ['Paper gain', stats.gainLkr],
              ['Est. resale today', resaleTotal || null],
            ] as const : []).map(([label, v]) =>
              v === null ? null : (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-txt-muted">{label}</span>
                  <span className="tnum font-medium">{fm(v as number)}</span>
                </div>
              ),
            )}
            <p className="text-[11px] text-txt-dim">
              “Paper gain” compares owner estimates against cost and ignores selling costs, taxes and fees. Resale
              figures cover {resaleKnown.length} of {stats.valuedCount || assets.length} valued assets where you
              recorded one.
            </p>
          </div>
        </Card>

        {/* Distribution */}
        <Card>
          <CardHeader
            title="Where your value sits"
            subtitle={allocation.length ? 'By category, valued subset only' : 'Needs valuations'}
            action={
              allocation.length > 0 ? (
                <Badge tone="accent">
                  <PieIcon size={11} /> {allocation.length} categories
                </Badge>
              ) : undefined
            }
          />
          {allocation.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-txt-muted">No valuations yet — add estimates from asset pages.</p>
          ) : (
            <div className="px-5 pb-5">
              <AllocationDonut data={allocation.slice(0, 7)} displayCurrency={settings.displayCurrency} />
              <ul className="mt-2 space-y-1.5 text-xs">
                {allocation.slice(0, 7).map((a) => (
                  <li key={a.category} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-accent/70" />
                    <span className="text-txt-muted flex-1 truncate">{categoryMeta(a.category).label}</span>
                    <span className="text-txt-dim tnum">{pct(totalValued > 0 ? a.valueLkr / totalValued : 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Cost vs value */}
        <Card>
          <CardHeader title="Purchase cost vs current estimate" subtitle="Two different numbers, both shown" />
          <div className="px-5 pb-5 space-y-3">
            <Meter
              label="Recorded purchase cost"
              subV={stats.totalCostLkr}
              maxV={Math.max(stats.totalCostLkr, stats.totalValueLkr, 1)}
              tone="muted"
              fm={fm}
            />
            <Meter
              label="Current estimated value"
              subV={stats.totalValueLkr}
              maxV={Math.max(stats.totalCostLkr, stats.totalValueLkr, 1)}
              tone={stats.gainLkr >= 0 ? 'positive' : 'negative'}
              fm={fm}
            />
            <div className="flex items-center gap-2 text-[12px]">
              {stats.gainLkr >= 0 ? (
                <CheckCircle2 size={14} className="text-emerald-400" />
              ) : (
                <AlertTriangle size={14} className="text-rose-400" />
              )}
              <span className="text-txt-muted">
                {winners} holding{winners === 1 ? '' : 's'} above cost · {losers} below ·
                {' '}
                {stats.gainLkr >= 0 ? 'net estimated gain' : 'net estimated loss'} {fm(Math.abs(stats.gainLkr))}
              </span>
            </div>
          </div>
        </Card>

        {/* Valuation completeness */}
        <Card>
          <CardHeader title="Valuation completeness" subtitle="How much of your portfolio has reliable numbers" />
          <div className="px-5 pb-5">
            <div className="flex items-end gap-3">
              <p className="text-3xl font-semibold tnum">{num1(completeness * 100)}%</p>
              <p className="text-[12px] text-txt-muted pb-1.5">
                {stats.valuedCount} of {stats.activeCount} active assets valued
              </p>
            </div>
            <div className="h-2.5 rounded-full bg-ink-800 mt-3 overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.round(completeness * 100)}%` }} />
            </div>
            <p className="text-[11px] text-txt-dim mt-3">
              {stats.unvaluedCount === 0
                ? 'Everything active is valued. Keep updating estimates to stay this complete.'
                : `${stats.unvaluedCount} asset${stats.unvaluedCount === 1 ? '' : 's'} still need an estimate — open them from My Portfolio.`}
            </p>
          </div>
        </Card>

        {/* Top asset */}
        <Card>
          <CardHeader title="Most valuable asset" subtitle={top ? 'By your current estimates' : 'Once valued'} />
          {top ? (
            <div className="px-5 pb-5 flex items-start gap-3">
              <span className="w-10 h-10 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center">
                {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */}
                {(() => {
                  const Icon = categoryMeta(top.category).icon;
                  return <Icon size={18} className="text-accent" />;
                })()}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{top.name}</p>
                <p className="tnum text-lg font-semibold mt-1">{fm(assetMetrics(top, market).currentValueLkr)}</p>
                <p className="text-[11px] text-txt-dim mt-0.5">
                  {pct(totalValued > 0 ? (assetMetrics(top, market).currentValueLkr ?? 0) / totalValued : 0)} of valued portfolio ·{' '}
                  {categoryMeta(top.category).label}
                </p>
              </div>
            </div>
          ) : (
            <p className="px-5 pb-6 text-sm text-txt-muted">Add valuations to see your biggest holding.</p>
          )}
        </Card>

        {/* Concentration */}
        <Card>
          <CardHeader title="Category concentration" subtitle="Concentration cuts both ways — clarity first, not advice" />
          <div className="px-5 pb-5 space-y-2.5">
            {allocation.slice(0, 3).map((a, i) => (
              <div key={a.category} className="flex items-center gap-3">
                <Award size={i === 0 ? 15 : 13} className={i === 0 ? 'text-accent' : 'text-txt-dim'} />
                <p className="text-[13px] flex-1 truncate">
                  {categoryMeta(a.category).label} represents{' '}
                  <strong className="text-txt">{pct(totalValued > 0 ? a.valueLkr / totalValued : 0)}</strong>{' '}
                  of your valued assets ({a.count} asset{a.count === 1 ? '' : 's'})
                </p>
              </div>
            ))}
            {concentrationTop > 0.5 && (
              <p className="text-[11px] text-amber-400/90 flex gap-1.5 mt-2">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {categoryMeta(allocation[0].category).label} alone is more than half of your valued total.
                Vaultfolio offers no investment advice — just the fact.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardHeader
          title="Portfolio history"
          subtitle={historyReady ? `${timeline.length} recorded snapshots` : 'Needs three or more recorded snapshots for an honest trend'}
        />
        {historyReady ? (
          <div className="px-2 pb-4">
            <HistoryLine data={timeline} />
            <p className="text-[11px] text-txt-dim px-3 pb-2">
              Trend is built only on valuation events you recorded ({timeline.length} snapshots,{' '}
              {records.length} events). Past recorded values do not guarantee future value.
            </p>
          </div>
        ) : (
          <div className="px-5 pb-6 flex items-start gap-3">
            <CircleHelp size={16} className="text-txt-dim mt-0.5" />
            <p className="text-[13px] text-txt-muted">
              {timeline.length === 0
                ? 'No valuation records yet. “Update valuation” on any asset creates one.'
                : `Only ${timeline.length} snapshot${timeline.length === 1 ? '' : 's'} exist. A line chart of ${timeline.length} point${timeline.length === 1 ? '' : 's'} would sell a false sense of trend — it appears at three.`}
            </p>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-txt-dim flex items-center gap-1.5">
        <Scale size={12} /> Vaultfolio is a record-keeping and estimation tool — not investment, tax or appraisal advice.
      </p>
    </div>
  );
}

function Meter({
  label,
  subV,
  maxV,
  tone,
  fm,
}: {
  label: string;
  subV: number;
  maxV: number;
  tone: 'muted' | 'positive' | 'negative';
  fm: (v: number | null) => string;
}) {
  void parseNum;
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-txt-muted">{label}</span>
        <span className="tnum font-medium">{fm(subV)}</span>
      </div>
      <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${tone === 'positive' ? 'bg-emerald-500/80' : tone === 'negative' ? 'bg-rose-500/80' : 'bg-ink-500/70'}`}
          style={{ width: `${Math.max(2, Math.min(100, (subV / maxV) * 100))}%` }}
        />
      </div>
    </div>
  );
}
