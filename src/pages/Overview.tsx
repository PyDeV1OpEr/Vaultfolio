import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Coins,
  Hash,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Vault,
  Wallet,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { statsFor, assetMetrics, allocationByCategory, resolveAssetValuation, portfolioTimeline } from '../lib/valuation';
import { categoryMeta } from '../lib/categories';
import { formatMoney, formatPercent, relativeTime } from '../lib/money';
import { AllocationDonut, CHART_PALETTE, HistoryLine } from '../components/Charts';
import { Button, Card, CardHeader, EmptyState, StatCard } from '../components/ui';

export function Overview() {
  const { assets, market, settings, marketLoading, refreshMarket, records } = useData();
  const navigate = useNavigate();
  const marketData = market;
  const usdLkr = marketData?.usdLkr ?? null;
  const stats = useMemo(() => statsFor(assets, marketData), [assets, marketData]);
  const recent = useMemo(
    () =>
      [...assets]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 4),
    [assets],
  );
  const allocation = useMemo(
    () => allocationByCategory(assets, marketData).slice(0, 6),
    [assets, marketData],
  );
  const timeline = useMemo(
    () => portfolioTimeline(assets, records),
    [assets, records],
  );
  const history = timeline.length >= 3 ? timeline : [];

  if (assets.length === 0) {
    return (
      <div className="max-w-xl mx-auto pt-8 animate-fadeUp">
        <Onboarding />
      </div>
    );
  }

  const gainPct = stats.totalCostLkr > 0 ? stats.gainLkr / stats.totalCostLkr : null;

  return (
    <div className="space-y-6 animate-fadeUp">
      {/* Top Header */}
      <header className="flex items-center justify-between gap-4 flex-wrap pb-2 border-b border-ink-800/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-txt">Portfolio Overview</h1>
          <p className="text-xs text-txt-muted mt-0.5">
            {stats.activeCount} active physical asset{stats.activeCount === 1 ? '' : 's'}
            {stats.unvaluedCount > 0 && ` · ${stats.unvaluedCount} awaiting valuation`}
            {settings.displayCurrency === 'USD' && usdLkr == null && ' · USD rate unavailable'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void refreshMarket()}
            variant="ghost"
            size="sm"
            aria-label="Refresh market data"
            className="text-txt-muted hover:text-txt"
          >
            <RefreshCw size={14} className={marketLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/add')}>
            <Plus size={14} /> Add Asset
          </Button>
        </div>
      </header>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          icon={<Vault size={15} className="text-accent" />}
          label="Estimated Total Value"
          value={formatMoney(stats.totalValueLkr, settings.displayCurrency, usdLkr)}
          sub={
            stats.unvaluedCount > 0
              ? `Excl. ${stats.unvaluedCount} unvalued asset${stats.unvaluedCount > 1 ? 's' : ''}`
              : `${stats.valuedCount} valued assets`
          }
        />
        <StatCard
          icon={<TrendingUp size={15} className={stats.gainLkr >= 0 ? 'text-emerald-400' : 'text-rose-400'} />}
          label="Estimated Net Gain"
          value={
            stats.totalCostLkr > 0
              ? `${stats.gainLkr >= 0 ? '+' : ''}${formatMoney(stats.gainLkr, settings.displayCurrency, usdLkr)}`
              : '—'
          }
          tone={stats.gainLkr > 0 ? 'positive' : stats.gainLkr < 0 ? 'negative' : 'neutral'}
          sub={
            gainPct !== null
              ? `${formatPercent(gainPct)} return over purchase cost`
              : 'Add purchase costs to calculate return'
          }
        />
        <StatCard
          icon={<Hash size={15} className="text-txt-dim" />}
          label="Total Invested Cost"
          value={formatMoney(stats.totalCostLkr, settings.displayCurrency, usdLkr)}
          sub="Sum of recorded purchase prices & fees"
        />
        <StatCard
          icon={<Coins size={15} className="text-amber-400" />}
          label="Active Holdings"
          value={String(stats.activeCount)}
          sub={`${stats.soldCount} sold · ${assets.length} total recorded`}
        />
      </div>

      {/* Charts Section: Allocation & History */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Category Allocation */}
        <Card>
          <CardHeader
            title="Asset Class Distribution"
            subtitle={
              stats.valuedCount === 0
                ? 'No valued assets yet'
                : `${stats.valuedCount} valued assets categorized`
            }
            action={
              <Link to="/insights" className="text-xs text-accent hover:text-accent-hover inline-flex items-center gap-1 font-medium">
                Deep Insights <ArrowRight size={12} />
              </Link>
            }
          />
          {allocation.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-txt-muted">
              Valuations aren’t available yet — add an estimate on any asset.
            </div>
          ) : (
            <div className="px-5 pb-5">
              <AllocationDonut data={allocation} displayCurrency={settings.displayCurrency} />
              <div className="mt-4 space-y-1.5 pt-3 border-t border-ink-800">
                {allocation.map((a, i) => {
                  const p = stats.totalValueLkr > 0 ? a.valueLkr / stats.totalValueLkr : 0;
                  const color = CHART_PALETTE[i % CHART_PALETTE.length];
                  return (
                    <div key={a.category} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-txt-muted flex-1 truncate">{categoryMeta(a.category).label}</span>
                      <span className="tnum font-medium text-txt">
                        {formatMoney(a.valueLkr, settings.displayCurrency, usdLkr)}
                      </span>
                      <span className="tnum text-txt-dim w-12 text-right">{formatPercent(p)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Valuation Timeline */}
        <Card>
          <CardHeader
            title="Recorded Valuation Trend"
            subtitle={
              history.length >= 3
                ? `${history.length} recorded valuation snapshots`
                : 'Appears after keeping snapshots over time'
            }
          />
          {history.length >= 3 ? (
            <div className="px-3 pb-4">
              <HistoryLine data={history} />
              <p className="text-2xs text-txt-dim px-3 pt-2">
                Timeline derived strictly from timestamped valuation snapshots. Zero backfilled data.
              </p>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <div className="w-10 h-10 rounded-xl bg-ink-800 border border-ink-700 flex items-center justify-center text-txt-dim mx-auto mb-3">
                <BarChart3 size={18} />
              </div>
              <p className="text-sm font-medium text-txt">Snapshot Trend Line</p>
              <p className="text-xs text-txt-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
                {timeline.length > 0
                  ? `You have ${timeline.length} recorded snapshot${timeline.length === 1 ? '' : 's'}. A trend line renders once you have 3 or more.`
                  : 'Update valuations over time and verified snapshots form an honest trend graph here.'}
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Bottom Grid: Recent Assets + Quick Access */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Recent Assets */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recently Added Holdings"
            subtitle="Most recently cataloged items"
            action={
              <Link to="/portfolio" className="text-xs text-accent hover:text-accent-hover inline-flex items-center gap-1 font-medium">
                View All Assets <ArrowRight size={12} />
              </Link>
            }
          />
          <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3">
            {recent.map((a) => {
              const resolved = resolveAssetValuation(a, marketData);
              const meta = categoryMeta(a.category);
              const Icon = meta.icon;
              return (
                <Link
                  key={a.id}
                  to={`/portfolio/${a.id}`}
                  className="bg-ink-850/70 border border-ink-700/80 rounded-xl p-3 hover:border-ink-600 hover:bg-ink-800/80 card-lift transition-all duration-120 group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center text-accent shrink-0">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-txt truncate group-hover:text-white">
                        {a.name}
                      </p>
                      <p className="text-2xs text-txt-dim mt-0.5">{meta.label}</p>
                    </div>
                    <ArrowUpRight size={14} className="text-txt-dim group-hover:text-accent transition-colors" />
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-ink-800/80 flex items-center justify-between text-xs">
                    <span className="tnum font-medium text-txt">
                      {resolved.valueLkr === null
                        ? <span className="text-txt-dim font-normal text-2xs">No estimate</span>
                        : formatMoney(resolved.valueLkr, settings.displayCurrency, usdLkr)}
                    </span>
                    <span className="text-2xs text-txt-dim">{relativeTime(a.createdAt)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        {/* Quick Actions Card */}
        <Card>
          <CardHeader title="Quick Actions" subtitle="Everyday vault tasks" />
          <div className="px-4 pb-4 space-y-2">
            <QuickAction to="/add" icon={<Plus size={15} className="text-accent" />} label="Add Physical Asset" />
            <QuickAction to="/portfolio" icon={<Wallet size={15} className="text-sky-400" />} label="Review Asset Library" />
            <QuickAction to="/insights" icon={<BarChart3 size={15} className="text-emerald-400" />} label="Portfolio Analytics" />
            <QuickAction to="/settings" icon={<Vault size={15} className="text-amber-400" />} label="Backup & Security" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-ink-700/80 bg-ink-850/60 px-3.5 py-2.5 text-xs font-medium text-txt-muted hover:text-txt hover:bg-ink-800/80 hover:border-ink-600 transition-all duration-120 group"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <ArrowUpRight size={13} className="text-txt-dim group-hover:text-accent transition-colors" />
    </Link>
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
