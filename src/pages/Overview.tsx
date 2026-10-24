import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
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
import { activeAssets } from '../store/dataStore';
import { statsFor, assetMetrics, allocationByCategory, resolveAssetValuation, portfolioTimeline } from '../lib/valuation';
import { categoryMeta } from '../lib/categories';
import { formatMoney, formatPercent, relativeTime } from '../lib/money';
import { AllocationDonut, HistoryLine } from '../components/Charts';
import { Button, Card, CardHeader, EmptyState, Skeleton } from '../components/ui';
import { DEMO_MARKET } from '../lib/market';

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
      <div className="max-w-lg mx-auto">
        <Onboarding />
      </div>
    );
  }

  const gainPct = stats.totalCostLkr > 0 ? stats.gainLkr / stats.totalCostLkr : null;

  return (
    <div className="space-y-6 animate-fadeUp">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-txt-muted mt-1">
            {stats.activeCount} active assets
            {stats.unvaluedCount > 0 && ` · ${stats.unvaluedCount} awaiting a valuation`}
            {settings.displayCurrency === 'USD' && usdLkr == null && ' · USD rate unavailable — showing LKR'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void refreshMarket()} variant="ghost" aria-label="Refresh market data">
            <RefreshCw size={15} className={marketLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant="primary" onClick={() => navigate('/add')}>
            <Plus size={15} /> Add Asset
          </Button>
        </div>
      </header>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Vault size={16} />}
          label="Estimated total value"
          value={formatMoney(stats.totalValueLkr, settings.displayCurrency, usdLkr)}
          sub={
            stats.unvaluedCount > 0
              ? `excl. ${stats.unvaluedCount} unvalued asset${stats.unvaluedCount > 1 ? 's' : ''}`
              : `${stats.valuedCount} valued assets`
          }
        />
        <StatCard
          icon={<TrendingUp size={16} />}
          label="Estimated gain"
          value={formatMoney(stats.gainLkr, settings.displayCurrency, usdLkr)}
          tone={stats.gainLkr > 0 ? 'positive' : stats.gainLkr < 0 ? 'negative' : 'neutral'}
          sub={
            gainPct !== null
              ? `${formatPercent(gainPct)} over cost — excludes selling costs, taxes & fees`
              : 'Add purchase costs to compute gain'
          }
        />
        <StatCard
          icon={<Coins size={16} />}
          label="Assets"
          value={String(stats.activeCount)}
          sub={`${stats.soldCount} sold · ${assets.length} total records`}
        />
        <StatCard
          icon={<Hash size={16} />}
          label="Total paid"
          value={formatMoney(stats.totalCostLkr, settings.displayCurrency, usdLkr)}
          sub="sum of recorded purchase costs"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Distribution */}
        <Card>
          <CardHeader
            title="Category distribution"
            subtitle={
              stats.valuedCount === 0
                ? 'No valued assets yet'
                : `${stats.valuedCount} valued assets shown`
            }
            action={
              <Link to="/insights" className="text-xs text-accent hover:underline">
                Insights →
              </Link>
            }
          />
          {allocation.length === 0 ? (
            <p className="text-sm text-txt-muted px-5 pb-6">
              Valuations aren’t available yet — add an estimate from any asset page.
            </p>
          ) : (
            <div className="px-5 pb-3">
              <AllocationDonut data={allocation} displayCurrency={settings.displayCurrency} />
              <ul className="mt-3 space-y-1.5">
                {allocation.map((a) => {
                  const p = stats.totalValueLkr > 0 ? a.valueLkr / stats.totalValueLkr : 0;
                  return (
                    <li key={a.category} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm bg-accent/70 shrink-0" />
                      <span className="text-txt-muted flex-1 truncate">{categoryMeta(a.category).label}</span>
                      <span className="tnum text-txt">
                        {formatMoney(a.valueLkr, settings.displayCurrency, usdLkr)}
                      </span>
                      <span className="tnum text-txt-dim w-10 text-right">{formatPercent(p)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>

        {/* History */}
        <Card>
          <CardHeader
            title="Recorded valuation history"
            subtitle={
              history.length >= 3
                ? `${history.length} recorded snapshots`
                : 'Appears once you keep valuation records over time'
            }
          />
          {history.length >= 3 ? (
            <div className="px-2 pb-3">
              <HistoryLine data={history} />
              <p className="text-[11px] text-txt-dim px-3 pb-2">
                Built only from recorded valuations — no backfilled or synthetic history.
              </p>
            </div>
          ) : (
            <p className="text-sm text-txt-muted px-5 pb-8">
              {timeline.length > 0
                ? `Only ${timeline.length} snapshot${timeline.length === 1 ? '' : 's'} recorded so far — a trend line needs three or more to be honest.`
                : 'Update valuations over time and snapshots appear here.'}
            </p>
          )}
        </Card>
      </div>

      {/* Recent + quick actions */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recently added"
            action={
              <Link to="/portfolio" className="text-xs text-accent hover:underline">
                View portfolio →
              </Link>
            }
          />
          <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3">
            {recent.map((a) => {
              const resolved = resolveAssetValuation(a, marketData);
              const m = assetMetrics(a, marketData);
              const meta = categoryMeta(a.category);
              return (
                <Link
                  key={a.id}
                  to={`/portfolio/${a.id}`}
                  className="bg-ink-850 border border-ink-700 rounded-lg p-3.5 hover:border-ink-600 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <meta.icon size={15} className="text-txt-muted" />
                    <p className="text-[13px] font-medium truncate">{a.name}</p>
                  </div>
                  <p className="tnum text-sm mt-2">
                    {resolved.valueLkr === null ? (
                      <span className="text-txt-dim text-[13px]">No valuation yet</span>
                    ) : (
                      formatMoney(resolved.valueLkr, settings.displayCurrency, usdLkr)
                    )}
                  </p>
                  <p className="text-[11px] text-txt-dim mt-1">
                    {meta.label} · added {relativeTime(a.createdAt)}
                  </p>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick actions" subtitle="Jump straight in" />
          <div className="px-4 pb-4 grid grid-rows-4 gap-2">
            <QuickAction to="/add" icon={<Plus size={15} />} label="Add an asset" />
            <QuickAction to="/portfolio" icon={<Wallet size={15} />} label="View portfolio" />
            <QuickAction to="/market" icon={<RefreshCw size={15} />} label="Update valuations" />
            <QuickAction to="/insights" icon={<BarChart3 size={15} />} label="View insights" />
          </div>
          {marketData?.isDemo && (
            <p className="text-[11px] text-amber-400/80 px-4 pb-4">
              Prices under demo placeholder: LKR {DEMO_MARKET.goldPerGramLkr?.toLocaleString()}/g gold —
              enter real prices in Market &amp; Valuations.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-txt-muted">
        {icon}
        <span className="text-[12px]">{label}</span>
      </div>
      <p
        className={`text-lg xl:text-xl font-semibold tnum mt-2 break-all ${
          tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : ''
        }`}
      >
        {value || <span className="text-txt-dim font-normal">—</span>}
      </p>
      {sub && <p className="text-[11px] text-txt-dim mt-1 leading-snug">{sub}</p>}
    </Card>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-3 text-sm text-txt-muted hover:text-txt hover:border-ink-600 transition-colors"
    >
      {icon}
      <span className="flex-1">{label}</span>
      <ArrowUpRight size={14} className="text-txt-dim" />
    </Link>
  );
}

function Onboarding() {
  const { continueDemo, busy, demoDeclined } = useData();
  return (
    <Card className="mt-6">
      <EmptyState
        icon={<Sparkles size={22} />}
        title="Welcome to Vaultfolio"
        body="Track what your physical wealth is worth — gold, gems, watches, land, vehicles and anything else you own. Values stay private and estimations are always labeled."
        action={
          <div className="flex flex-col sm:flex-row gap-2">
            <Link to="/add">
              <Button variant="primary">
                <Plus size={15} /> Add your first asset
              </Button>
            </Link>
            <Button onClick={() => void continueDemo()} disabled={busy}>
              {busy ? 'Loading…' : 'Explore with demo data'}
            </Button>
          </div>
        }
      />
      <p className="text-[11px] text-txt-dim text-center pb-6 -mt-2">
        Demo data is clearly labeled, stored only in this browser, and can be reset from Settings.
      </p>
    </Card>
  );
}
