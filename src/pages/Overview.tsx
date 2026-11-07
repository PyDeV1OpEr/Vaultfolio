import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Coins,
  FileText,
  Files,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
  Vault,
  Wallet,
  Zap,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import {
  statsFor,
  assetMetrics,
  allocationByCategory,
  resolveAssetValuation,
  portfolioTimeline,
} from '../lib/valuation';
import { categoryMeta } from '../lib/categories';
import { formatMoney, formatPercent, relativeTime } from '../lib/money';
import { AllocationDonut, CHART_PALETTE, HistoryLine } from '../components/Charts';
import { Button, Card, CardHeader, EmptyState } from '../components/ui';

export function Overview() {
  const { assets, market, settings, marketLoading, refreshMarket, records, lock, profileName } =
    useData();
  const navigate = useNavigate();
  const marketData = market;
  const usdLkr = marketData?.usdLkr ?? null;
  const stats = useMemo(() => statsFor(assets, marketData), [assets, marketData]);
  const [timelineFilter, setTimelineFilter] = useState<'All' | '1Y' | '90D' | '30D'>('All');
  const [sortOrder, setSortOrder] = useState<'value_desc' | 'gain_desc' | 'recent'>('value_desc');

  // Auto-refresh market data periodically in background
  useEffect(() => {
    const timer = setInterval(() => {
      void refreshMarket();
    }, 180_000);
    return () => clearInterval(timer);
  }, [refreshMarket]);

  const sortedAssets = useMemo(() => {
    const list = [...assets].filter((a) => a.status === 'active');
    if (sortOrder === 'value_desc') {
      return list.sort((a, b) => {
        const va = resolveAssetValuation(a, marketData).valueLkr ?? 0;
        const vb = resolveAssetValuation(b, marketData).valueLkr ?? 0;
        return vb - va;
      });
    }
    if (sortOrder === 'gain_desc') {
      return list.sort((a, b) => {
        const ga = assetMetrics(a, marketData).unrealizedGainLkr ?? -Infinity;
        const gb = assetMetrics(b, marketData).unrealizedGainLkr ?? -Infinity;
        return gb - ga;
      });
    }
    return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [assets, marketData, sortOrder]);

  const allocation = useMemo(
    () => allocationByCategory(assets, marketData).slice(0, 6),
    [assets, marketData],
  );

  const rawTimeline = useMemo(
    () => portfolioTimeline(assets, records),
    [assets, records],
  );

  const filteredTimeline = useMemo(() => {
    if (rawTimeline.length < 3) return rawTimeline;
    const now = Date.now();
    let cutoff = 0;
    if (timelineFilter === '30D') cutoff = now - 30 * 86_400_000;
    else if (timelineFilter === '90D') cutoff = now - 90 * 86_400_000;
    else if (timelineFilter === '1Y') cutoff = now - 365 * 86_400_000;

    const filtered = cutoff > 0 ? rawTimeline.filter((t) => new Date(t.date).getTime() >= cutoff) : rawTimeline;
    return filtered.length >= 2 ? filtered : rawTimeline;
  }, [rawTimeline, timelineFilter]);

  if (assets.length === 0) {
    return (
      <div className="max-w-xl mx-auto pt-8 animate-fadeUp">
        <Onboarding />
      </div>
    );
  }

  const gainPct = stats.totalCostLkr > 0 ? stats.gainLkr / stats.totalCostLkr : null;

  // Breakdown sub-items for the featured balance card
  const metalsTotal = allocation.find((a) => a.category === 'gold_silver')?.valueLkr ?? 0;
  const watchesAndGemsTotal =
    (allocation.find((a) => a.category === 'watches')?.valueLkr ?? 0) +
    (allocation.find((a) => a.category === 'gems_jewelry')?.valueLkr ?? 0);
  const propertyAndOtherTotal =
    (allocation.find((a) => a.category === 'land_property')?.valueLkr ?? 0) +
    (allocation.find((a) => a.category === 'cars')?.valueLkr ?? 0) +
    (allocation.find((a) => a.category === 'other')?.valueLkr ?? 0);

  return (
    <div className="space-y-6 animate-fadeUp">
      {/* Dashboard Top Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-1">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-txt">
            Dashboard
          </h1>
          <p className="text-xs text-txt-muted mt-0.5">
            Institutional physical wealth portfolio · {stats.activeCount} active asset{stats.activeCount === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            onClick={() => void refreshMarket()}
            variant="secondary"
            size="sm"
            aria-label="Refresh market data"
            className="rounded-xl text-xs"
          >
            <RefreshCw size={13} className={marketLoading ? 'animate-spin text-accent' : 'text-txt-muted'} />
            <span>{marketLoading ? 'Updating…' : 'Refresh Rates'}</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/add')}
            className="rounded-xl text-xs shadow-btn-primary"
          >
            <Plus size={14} /> Add Asset
          </Button>
        </div>
      </div>

      {/* Top Hero Section: My Balance + Statistics + Fast Action (Quantix layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Featured "My Balance" style Card (col-span-4) */}
        <div className="lg:col-span-4 bg-gradient-to-br from-[#1E1938] via-[#141524] to-[#0D0E16] border border-accent/30 rounded-2xl p-5 sm:p-6 shadow-card-purple flex flex-col justify-between relative overflow-hidden">
          {/* Subtle ambient background glow */}
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-accent/15 rounded-full blur-3xl pointer-events-none" />

          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-accent/20 border border-accent/35 flex items-center justify-center text-accent shadow-[0_0_12px_rgba(169,155,255,0.2)]">
                  <Vault size={16} />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-txt-muted">
                  Portfolio Value
                </span>
              </div>
              <Link
                to="/portfolio"
                className="w-7 h-7 rounded-lg bg-ink-800/80 border border-ink-700/80 hover:border-accent/40 flex items-center justify-center text-txt-dim hover:text-accent transition-colors"
                title="View Holdings"
              >
                <ArrowUpRight size={14} />
              </Link>
            </div>

            {/* Total Balance Number */}
            <div className="my-2">
              <p className="text-3xl sm:text-4xl font-extrabold tnum text-white value-display tracking-tight">
                {formatMoney(stats.totalValueLkr, settings.displayCurrency, usdLkr)}
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold tnum ${
                    stats.gainLkr >= 0
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                  }`}
                >
                  <TrendingUp size={11} className={stats.gainLkr < 0 ? 'rotate-180' : ''} />
                  {gainPct !== null ? formatPercent(gainPct) : '+0.0%'}
                </span>
                <span className="text-2xs text-txt-dim">
                  {stats.gainLkr >= 0 ? '+' : ''}
                  {formatMoney(stats.gainLkr, settings.displayCurrency, usdLkr)} total gain
                </span>
              </div>
            </div>
          </div>

          {/* Sub-holdings breakdown rows (like BTC & ETH in Quantix Balance card) */}
          <div className="mt-6 pt-4 border-t border-ink-700/80 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]" />
                <span className="text-txt font-medium">Precious Metals</span>
              </div>
              <span className="font-semibold text-white tnum">
                {formatMoney(metalsTotal, settings.displayCurrency, usdLkr)}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]" />
                <span className="text-txt font-medium">Timepieces & Gems</span>
              </div>
              <span className="font-semibold text-white tnum">
                {formatMoney(watchesAndGemsTotal, settings.displayCurrency, usdLkr)}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#A99BFF] shadow-[0_0_8px_rgba(169,155,255,0.4)]" />
                <span className="text-txt font-medium">Land & Property</span>
              </div>
              <span className="font-semibold text-white tnum">
                {formatMoney(propertyAndOtherTotal, settings.displayCurrency, usdLkr)}
              </span>
            </div>
          </div>
        </div>

        {/* "Statistics" Chart Card (col-span-5) */}
        <Card className="lg:col-span-5 flex flex-col justify-between">
          <div className="p-5 pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-ink-800 border border-ink-700 flex items-center justify-center text-accent">
                  <BarChart3 size={16} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-txt leading-none">Statistics</h3>
                  <p className="text-2xs text-txt-dim mt-0.5">Recorded valuation trajectory</p>
                </div>
              </div>

              {/* Timeframe pill filters */}
              <div className="flex items-center gap-1 bg-ink-900 border border-ink-700 p-0.5 rounded-full text-2xs">
                {(['All', '1Y', '90D', '30D'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setTimelineFilter(filter)}
                    className={`px-2.5 py-0.5 rounded-full font-medium transition-all ${
                      timelineFilter === filter
                        ? 'bg-[#7047EB]/30 border border-accent/40 text-white shadow-[0_0_10px_rgba(169,155,255,0.15)]'
                        : 'text-txt-muted hover:text-txt'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {/* History Graph */}
            {filteredTimeline.length >= 2 ? (
              <div className="pt-2">
                <HistoryLine data={filteredTimeline} />
              </div>
            ) : (
              <div className="py-14 text-center">
                <p className="text-xs text-txt-muted max-w-xs mx-auto">
                  Snapshot history appears as valuations are recorded over time. Real data only, no backfill.
                </p>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-ink-700/60 bg-ink-900/60 flex items-center justify-between text-2xs text-txt-dim">
            <span>Basis: {stats.valuedCount} valued assets</span>
            <Link to="/insights" className="text-accent hover:underline flex items-center gap-1 font-medium">
              Detailed Analytics <ArrowRight size={11} />
            </Link>
          </div>
        </Card>

        {/* Right Widget Column (col-span-3) */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {/* "Fast Action" Card (Quantix style) */}
          <Card className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/35 flex items-center justify-center text-accent">
                  <Zap size={14} />
                </span>
                <span className="text-xs font-semibold text-txt">Fast Actions</span>
              </div>

              <div className="space-y-2 mt-2">
                <Link
                  to="/add"
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-ink-800 border border-ink-700 hover:border-accent/40 hover:bg-ink-750 text-xs text-txt transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <Plus size={14} className="text-accent" />
                    <span>Catalog New Asset</span>
                  </div>
                  <ArrowRight size={12} className="text-txt-dim group-hover:text-accent transition-colors" />
                </Link>

                <Link
                  to="/valuation-centre"
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-ink-800 border border-ink-700 hover:border-accent/40 hover:bg-ink-750 text-xs text-txt transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <Coins size={14} className="text-amber-400" />
                    <span>Valuation Centre</span>
                  </div>
                  <ArrowRight size={12} className="text-txt-dim group-hover:text-accent transition-colors" />
                </Link>

                <Link
                  to="/market-watch"
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-ink-800 border border-ink-700 hover:border-accent/40 hover:bg-ink-750 text-xs text-txt transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-emerald-400" />
                    <span>Live Market Spot</span>
                  </div>
                  <ArrowRight size={12} className="text-txt-dim group-hover:text-accent transition-colors" />
                </Link>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-ink-700/60">
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/portfolio')}
                className="w-full text-xs rounded-xl shadow-btn-primary"
              >
                Review Holdings
              </Button>
            </div>
          </Card>

          {/* Quantix "Upgrade to Pro" style Security Banner */}
          <div className="bg-gradient-to-br from-[#2D1B69] via-[#1C163C] to-[#100F1B] border border-accent/40 rounded-2xl p-4 shadow-card-purple text-white relative overflow-hidden">
            <div className="flex items-center gap-2 mb-1.5">
              <Shield size={14} className="text-accent" />
              <span className="text-xs font-bold tracking-tight text-white">Private & Encrypted</span>
            </div>
            <p className="text-2xs text-[#D1D3DF] leading-relaxed">
              Zero telemetry. All valuations, documents and credentials sealed with AES-256-GCM.
            </p>
            <button
              onClick={() => lock()}
              className="mt-3 w-full py-1.5 px-3 rounded-xl bg-white text-ink-950 font-bold text-xs hover:bg-slate-100 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Lock size={12} /> Lock Vault Now
            </button>
          </div>
        </div>
      </div>

      {/* Main Asset Holdings Table ("Proposition to buy" style from Quantix) */}
      <Card>
        <div className="p-5 pb-3 flex items-center justify-between flex-wrap gap-3 border-b border-ink-700">
          <div>
            <h3 className="text-base font-semibold text-txt">Holdings & Valuations</h3>
            <p className="text-xs text-txt-muted mt-0.5">
              Live estimated value based on fine-metal content and recorded owner appraisals
            </p>
          </div>

          {/* Sort Control */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-txt-dim">Sort by:</span>
            <div className="relative">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
                className="bg-ink-800 border border-ink-700 text-xs text-txt rounded-xl px-3 py-1.5 pr-8 appearance-none focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="value_desc">Highest Value</option>
                <option value="gain_desc">Highest Return</option>
                <option value="recent">Recently Added</option>
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-txt-muted pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Holdings Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-ink-700 text-txt-muted uppercase text-[10px] tracking-wider bg-ink-900/50">
                <th className="py-3 px-5 font-semibold">Physical Asset</th>
                <th className="py-3 px-4 font-semibold">Category</th>
                <th className="py-3 px-4 font-semibold">Current Value</th>
                <th className="py-3 px-4 font-semibold">Cost Basis</th>
                <th className="py-3 px-4 font-semibold">Unrealized Gain</th>
                <th className="py-3 px-5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {sortedAssets.map((asset) => {
                const resolved = resolveAssetValuation(asset, marketData);
                const m = assetMetrics(asset, marketData);
                const meta = categoryMeta(asset.category);
                const Icon = meta.icon;
                const gain = m.unrealizedGainLkr;
                const returnPct =
                  gain !== null && m.purchaseCostLkr && m.purchaseCostLkr > 0
                    ? (gain / m.purchaseCostLkr) * 100
                    : null;

                return (
                  <tr
                    key={asset.id}
                    onClick={() => navigate(`/portfolio/${asset.id}`)}
                    className="hover:bg-ink-800/50 cursor-pointer transition-colors group"
                  >
                    {/* Asset Name + Icon */}
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-xl bg-ink-800 border border-ink-700 flex items-center justify-center text-accent shrink-0 group-hover:border-accent/40 transition-colors shadow-sm">
                          <Icon size={17} />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-txt group-hover:text-white transition-colors truncate max-w-[220px]">
                            {asset.name}
                          </p>
                          <p className="text-2xs text-txt-dim mt-0.5 truncate max-w-[220px]">
                            {asset.valuation?.sourceLabel || 'Owner valuation'}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="py-3.5 px-4 text-txt-muted font-medium whitespace-nowrap">
                      {meta.label}
                    </td>

                    {/* Current Value */}
                    <td className="py-3.5 px-4 font-semibold text-white tnum whitespace-nowrap">
                      {resolved.valueLkr === null ? (
                        <span className="text-txt-dim font-normal">—</span>
                      ) : (
                        formatMoney(resolved.valueLkr, settings.displayCurrency, usdLkr)
                      )}
                    </td>

                    {/* Cost Basis */}
                    <td className="py-3.5 px-4 text-txt-muted tnum whitespace-nowrap">
                      {m.purchaseCostLkr != null
                        ? formatMoney(m.purchaseCostLkr, settings.displayCurrency, usdLkr)
                        : '—'}
                    </td>

                    {/* Gain / Return */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {gain !== null ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-semibold tnum text-xs ${
                              gain >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {gain >= 0 ? '+' : ''}
                            {formatMoney(gain, settings.displayCurrency, usdLkr)}
                          </span>
                          {returnPct !== null && (
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                                returnPct >= 0
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {returnPct >= 0 ? '+' : ''}
                              {returnPct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-txt-dim">—</span>
                      )}
                    </td>

                    {/* Action Button (Quantix purple button) */}
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/portfolio/${asset.id}`);
                        }}
                        className="rounded-lg shadow-btn-primary"
                      >
                        Inspect
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="p-3.5 px-5 border-t border-ink-700/60 bg-ink-900/40 flex items-center justify-between text-2xs text-txt-dim">
          <span>Showing {sortedAssets.length} active holdings</span>
          <Link to="/portfolio" className="text-accent hover:underline flex items-center gap-1 font-medium">
            Open Full Asset Register <ArrowRight size={11} />
          </Link>
        </div>
      </Card>

      {/* Allocation Distribution & Insights Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Allocation Donut */}
        <Card>
          <CardHeader
            title="Portfolio Asset Distribution"
            subtitle={`${stats.valuedCount} valued holdings categorized`}
            action={
              <Link to="/insights" className="text-xs text-accent hover:underline inline-flex items-center gap-1 font-medium">
                Deep Insights <ArrowRight size={12} />
              </Link>
            }
          />
          <div className="px-5 pb-5">
            <AllocationDonut data={allocation} displayCurrency={settings.displayCurrency} />
            <div className="mt-4 space-y-2 pt-3 border-t border-ink-700/60">
              {allocation.map((a, i) => {
                const p = stats.totalValueLkr > 0 ? a.valueLkr / stats.totalValueLkr : 0;
                const color = CHART_PALETTE[i % CHART_PALETTE.length];
                return (
                  <div key={a.category} className="flex items-center gap-2.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-txt-muted flex-1 truncate">{categoryMeta(a.category).label}</span>
                    <span className="tnum font-semibold text-white">
                      {formatMoney(a.valueLkr, settings.displayCurrency, usdLkr)}
                    </span>
                    <span className="tnum text-txt-dim w-14 text-right font-mono text-2xs">{formatPercent(p)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Intelligence ML & Document Readiness */}
        <Card className="flex flex-col justify-between">
          <div>
            <CardHeader
              title="Intelligence & Documentation"
              subtitle="Private machine learning models & insured title deeds"
            />
            <div className="p-5 pt-0 space-y-3">
              <Link
                to="/intelligence"
                className="flex items-start gap-3 p-3.5 rounded-xl bg-ink-800/80 border border-ink-700 hover:border-accent/40 hover:bg-ink-750 transition-all group"
              >
                <span className="w-9 h-9 rounded-xl bg-accent/20 border border-accent/35 flex items-center justify-center text-accent shrink-0">
                  <Sparkles size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-txt group-hover:text-white transition-colors">
                    On-Device ML Intelligence
                  </p>
                  <p className="text-2xs text-txt-dim mt-0.5 leading-relaxed">
                    Train regression & classification models on your local CSV data using bundled scikit-learn without cloud exposure.
                  </p>
                </div>
                <ArrowRight size={14} className="text-txt-dim group-hover:text-accent transition-colors shrink-0 mt-2" />
              </Link>

              <Link
                to="/documents"
                className="flex items-start gap-3 p-3.5 rounded-xl bg-ink-800/80 border border-ink-700 hover:border-accent/40 hover:bg-ink-750 transition-all group"
              >
                <span className="w-9 h-9 rounded-xl bg-ink-800 border border-ink-700 flex items-center justify-center text-sky-400 shrink-0">
                  <Files size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-txt group-hover:text-white transition-colors">
                    Encrypted Documents Centre
                  </p>
                  <p className="text-2xs text-txt-dim mt-0.5 leading-relaxed">
                    Store GIA diamond certificates, gold purchase receipts, land deeds and watch authenticity papers with sandboxed previews.
                  </p>
                </div>
                <ArrowRight size={14} className="text-txt-dim group-hover:text-accent transition-colors shrink-0 mt-2" />
              </Link>
            </div>
          </div>

          <div className="p-4 px-5 border-t border-ink-700/60 bg-ink-900/60 flex items-center justify-between text-2xs text-txt-dim">
            <span>Air-gapped local execution</span>
            <Link to="/ai-insights" className="text-accent hover:underline flex items-center gap-1 font-medium">
              View AI Insights <ArrowRight size={11} />
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Onboarding() {
  return (
    <Card elevated className="mt-4">
      <EmptyState
        icon={<Sparkles size={26} className="text-accent" />}
        title="Welcome to your private vault"
        body="Track and organize your physical wealth — gold & precious metals, gemstones, luxury watches, land & property, vehicles, and valuables. Everything is AES-256 encrypted on this device."
        action={
          <Link to="/add">
            <Button variant="primary" size="md">
              <Plus size={16} /> Add your first asset
            </Button>
          </Link>
        }
      />
    </Card>
  );
}
