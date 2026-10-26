import { useMemo } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  CircleHelp,
  Layers,
  PieChart as PieIcon,
  Scale,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
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
import { formatMoney, formatNumber, formatPercent } from '../lib/money';
import {
  AllocationDonut,
  CategoryBarChart,
  CostVsValueChart,
  HistoryLine,
  TopAssetsBarChart,
} from '../components/Charts';
import { Badge, Card, CardHeader, EmptyState } from '../components/ui';

export function Insights() {
  const { assets, records, market, settings } = useData();
  const usd = market?.usdLkr ?? null;
  const stats = useMemo(() => statsFor(assets, market), [assets, market]);
  const allocation = useMemo(() => allocationByCategory(assets, market), [assets, market]);
  const timeline = useMemo(() => portfolioTimeline(assets, records), [assets, records]);

  const fm = (v: number | null) => (v === null ? '—' : formatMoney(v, settings.displayCurrency, usd));
  const pct = (v: number) => formatPercent(v);
  const num1 = (v: number) => formatNumber(v, 'en-US', 1);

  if (assets.length === 0) {
    return (
      <div className="max-w-xl mx-auto pt-8">
        <Card>
          <EmptyState
            icon={<Sparkles size={24} className="text-accent" />}
            title="Insights appear once you add physical assets"
            body="Add your assets, purchase records, and estimates. This analytics suite turns your real records into transparent charts, allocation breakdowns, and cost-vs-value comparisons."
          />
        </Card>
      </div>
    );
  }

  // Active valued assets
  const activeAssets = assets.filter((a) => a.status === 'active');
  const valuedAssets = activeAssets
    .filter((a) => resolveAssetValuation(a, market).valueLkr !== null)
    .sort((a, b) => (assetMetrics(b, market).currentValueLkr ?? 0) - (assetMetrics(a, market).currentValueLkr ?? 0));

  const totalValued = valuedAssets.reduce((s, a) => s + (assetMetrics(a, market).currentValueLkr ?? 0), 0);
  const topAsset = valuedAssets[0] ?? null;

  // Top individual assets for horizontal bar chart (up to 6)
  const topAssetsData = valuedAssets.slice(0, 6).map((a) => ({
    name: a.name,
    valueLkr: assetMetrics(a, market).currentValueLkr ?? 0,
    category: a.category,
  }));

  // Cost vs Value comparison data by category
  const costVsValueData = allocation.map((cat) => {
    const catAssets = activeAssets.filter((a) => a.category === cat.category);
    let cost = 0;
    for (const a of catAssets) {
      const m = assetMetrics(a, market);
      if (m.purchaseCostLkr !== null) cost += m.purchaseCostLkr;
    }
    return {
      label: categoryMeta(cat.category).shortLabel,
      costLkr: cost,
      valueLkr: cat.valueLkr,
    };
  });

  // Gains breakdown
  const gains = valuedAssets
    .map((a) => assetMetrics(a, market))
    .filter((m) => m.unrealizedGainLkr !== null);
  const winners = gains.filter((m) => (m.unrealizedGainLkr ?? 0) > 0).length;
  const losers = gains.filter((m) => (m.unrealizedGainLkr ?? 0) < 0).length;
  const even = gains.length - winners - losers;

  const completeness = stats.activeCount > 0 ? stats.valuedCount / stats.activeCount : 0;
  const concentrationTop = allocation.length > 0 && totalValued > 0 ? allocation[0].valueLkr / totalValued : 0;

  const resaleKnown = valuedAssets.filter((a) => assetMetrics(a, market).resaleValueLkr !== null);
  const resaleTotal = resaleKnown.reduce((s, a) => s + (assetMetrics(a, market).resaleValueLkr ?? 0), 0);

  const historyReady = timeline.length >= 3;

  return (
    <div className="space-y-6 animate-fadeUp">
      <header>
        <h1 className="text-xl lg:text-2xl font-semibold">Portfolio Insights</h1>
        <p className="text-sm text-txt-muted mt-1">
          Analytics calculated strictly from your genuine recorded data — no synthetic forecasts or fabricated trends.
        </p>
      </header>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-txt-muted font-medium">Total Estimated Value</p>
          <p className="text-xl font-semibold tnum text-txt mt-1.5">{fm(stats.totalValueLkr)}</p>
          <p className="text-[11px] text-txt-dim mt-1">
            {stats.valuedCount} of {stats.activeCount} active assets valued
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-txt-muted font-medium">Total Invested Cost</p>
          <p className="text-xl font-semibold tnum text-txt mt-1.5">{fm(stats.totalCostLkr)}</p>
          <p className="text-[11px] text-txt-dim mt-1">Sum of recorded purchase prices & fees</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-txt-muted font-medium">Unrealized Gain / Loss</p>
          <p
            className={`text-xl font-semibold tnum mt-1.5 ${
              stats.gainLkr > 0 ? 'text-emerald-400' : stats.gainLkr < 0 ? 'text-rose-400' : 'text-txt'
            }`}
          >
            {stats.gainLkr > 0 ? '+' : ''}
            {fm(stats.gainLkr)}
          </p>
          <p className="text-[11px] text-txt-dim mt-1">
            {stats.returnPct !== null && stats.returnPct !== undefined
              ? `${stats.returnPct >= 0 ? '+' : ''}${num1(stats.returnPct)}% net return`
              : 'Requires purchase costs'}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-txt-muted font-medium">Valuation Completeness</p>
          <p className="text-xl font-semibold tnum text-txt mt-1.5">{num1(completeness * 100)}%</p>
          <div className="h-1.5 rounded-full bg-ink-800 mt-2 overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${Math.round(completeness * 100)}%` }}
            />
          </div>
        </Card>
      </div>

      {/* Charts Row 1: Category Bar Chart & Allocation Donut */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Total Value by Category */}
        <Card>
          <CardHeader
            title="Total Value by Category"
            subtitle="Current estimated wealth by physical asset class"
            action={
              allocation.length > 0 ? (
                <Badge tone="accent">
                  <BarChart3 size={11} className="mr-1" /> {allocation.length} categories
                </Badge>
              ) : undefined
            }
          />
          <div className="px-5 pb-5">
            {allocation.length === 0 ? (
              <p className="text-sm text-txt-muted py-12 text-center">
                No valued assets yet. Enter estimated values to generate category bars.
              </p>
            ) : (
              <CategoryBarChart data={allocation} displayCurrency={settings.displayCurrency} />
            )}
          </div>
        </Card>

        {/* Portfolio Allocation Donut */}
        <Card>
          <CardHeader
            title="Portfolio Allocation"
            subtitle="Percentage distribution of your valued assets"
            action={
              allocation.length > 0 ? (
                <Badge tone="neutral">
                  <PieIcon size={11} className="mr-1" /> {pct(1)} total
                </Badge>
              ) : undefined
            }
          />
          <div className="px-5 pb-5">
            {allocation.length === 0 ? (
              <p className="text-sm text-txt-muted py-12 text-center">
                Add valuations to view portfolio weightings.
              </p>
            ) : (
              <>
                <AllocationDonut data={allocation} displayCurrency={settings.displayCurrency} />
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {allocation.map((a) => (
                    <div key={a.category} className="flex items-center justify-between py-0.5">
                      <span className="text-txt-muted truncate">{categoryMeta(a.category).label}</span>
                      <span className="tnum font-medium text-txt ml-2">
                        {pct(totalValued > 0 ? a.valueLkr / totalValued : 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Charts Row 2: Top Assets & Cost vs Value */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Top Asset Holdings */}
        <Card>
          <CardHeader
            title="Top Asset Holdings"
            subtitle="Largest individual physical assets by current estimate"
            action={
              topAsset ? (
                <Badge tone="neutral">
                  Top: {pct(totalValued > 0 ? (assetMetrics(topAsset, market).currentValueLkr ?? 0) / totalValued : 0)}
                </Badge>
              ) : undefined
            }
          />
          <div className="px-5 pb-5">
            {topAssetsData.length === 0 ? (
              <p className="text-sm text-txt-muted py-12 text-center">
                Valuations needed to display individual asset weights.
              </p>
            ) : (
              <TopAssetsBarChart data={topAssetsData} displayCurrency={settings.displayCurrency} />
            )}
          </div>
        </Card>

        {/* Cost vs Current Value */}
        <Card>
          <CardHeader
            title="Purchase Cost vs Current Value"
            subtitle="Compare invested cost against current owner estimates"
          />
          <div className="px-5 pb-5">
            {costVsValueData.length === 0 ? (
              <p className="text-sm text-txt-muted py-12 text-center">
                Enter purchase costs and current valuations to compare.
              </p>
            ) : (
              <>
                <CostVsValueChart data={costVsValueData} displayCurrency={settings.displayCurrency} />
                <div className="mt-3 flex items-center justify-between text-xs text-txt-dim pt-2 border-t border-ink-800">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 size={13} /> {winners} holding{winners === 1 ? '' : 's'} above cost
                  </span>
                  {losers > 0 && (
                    <span className="flex items-center gap-1.5 text-rose-400">
                      <AlertTriangle size={13} /> {losers} holding{losers === 1 ? '' : 's'} below cost
                    </span>
                  )}
                  {even > 0 && <span>{even} at break-even</span>}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Historical Valuation Line Chart */}
      <Card>
        <CardHeader
          title="Recorded Valuation History"
          subtitle={
            historyReady
              ? `${timeline.length} recorded valuation snapshots over time`
              : 'Requires three or more recorded snapshots for an honest timeline'
          }
        />
        <div className="px-5 pb-5">
          {historyReady ? (
            <>
              <HistoryLine data={timeline} />
              <p className="text-[11px] text-txt-dim mt-2">
                Timeline is generated strictly from timestamped valuation events you recorded. No data is
                fabricated or interpolated.
              </p>
            </>
          ) : (
            <div className="flex items-start gap-3 py-6 px-2 text-txt-muted">
              <CircleHelp size={18} className="text-txt-dim shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-txt">
                  {timeline.length === 0
                    ? 'No valuation snapshots recorded yet.'
                    : `Only ${timeline.length} snapshot${timeline.length === 1 ? '' : 's'} recorded.`}
                </p>
                <p className="text-xs text-txt-dim mt-1">
                  Using “Update valuation” on your assets appends historical snapshots. Once you have at least 3
                  snapshots across your vault, a trend line appears here.
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Concentration & Realizability Summary */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Concentration Analysis */}
        <Card>
          <CardHeader
            title="Asset & Class Concentration"
            subtitle="Understand portfolio exposure without algorithmic noise"
          />
          <div className="px-5 pb-5 space-y-3">
            {allocation.slice(0, 3).map((a, i) => (
              <div key={a.category} className="flex items-center gap-3">
                <Award size={15} className={i === 0 ? 'text-accent' : 'text-txt-dim'} />
                <p className="text-xs flex-1 truncate">
                  <strong className="text-txt">{categoryMeta(a.category).label}</strong> represents{' '}
                  <strong className="text-accent">{pct(totalValued > 0 ? a.valueLkr / totalValued : 0)}</strong>{' '}
                  of your valued wealth ({a.count} asset{a.count === 1 ? '' : 's'})
                </p>
              </div>
            ))}
            {concentrationTop > 0.5 && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 flex items-start gap-2.5 text-xs text-amber-300">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <strong>High concentration:</strong> {categoryMeta(allocation[0].category).label} accounts for{' '}
                  {pct(concentrationTop)} of your total valued portfolio.
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* Resale Realizability */}
        <Card>
          <CardHeader
            title="Estimated Liquidation & Resale"
            subtitle="Conservative resale values after dealer spreads and discounts"
          />
          <div className="px-5 pb-5 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-txt-muted">Est. Resale Proceeds (Recorded)</span>
              <span className="tnum font-medium text-txt">{resaleTotal > 0 ? fm(resaleTotal) : '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-txt-muted">Assets with Resale Estimate</span>
              <span className="tnum font-medium text-txt">
                {resaleKnown.length} of {stats.valuedCount} valued assets
              </span>
            </div>
            <p className="text-[11px] text-txt-dim leading-relaxed">
              Physical assets (especially jewelry, watches, vehicles, and real estate) often liquidate below
              retail value. Recording conservative dealer resale estimates keeps expectations grounded.
            </p>
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-center gap-2 text-xs text-txt-dim pt-2">
        <Scale size={13} />
        <span>Vaultfolio provides honest personal estimation and record-keeping — not appraisal, tax, or investment advice.</span>
      </div>
    </div>
  );
}
