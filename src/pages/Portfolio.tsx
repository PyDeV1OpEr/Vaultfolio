import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpDown,
  Filter,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { CATEGORIES, categoryMeta } from '../lib/categories';
import { assetMetrics, resolveAssetValuation } from '../lib/valuation';
import { formatMoney, relativeTime } from '../lib/money';
import type { AssetCategory, AssetStatus } from '../lib/types';
import { AssetCard } from '../components/AssetCard';
import { Badge, Button, Card, EmptyState, Input, Pill, Select } from '../components/ui';

type SortKey = 'value' | 'name' | 'added' | 'gain';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'value', label: 'Value (High → Low)' },
  { value: 'name', label: 'Name (A → Z)' },
  { value: 'added', label: 'Date Added (New → Old)' },
  { value: 'gain', label: 'Estimated Gain (High → Low)' },
];

export function Portfolio() {
  const { assets, market, settings } = useData();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AssetCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'sold' | 'archived' | 'all'>('active');
  const [sort, setSort] = useState<SortKey>('value');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const usdLkr = market?.usdLkr ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = assets.filter((a) => {
      if (category !== 'all' && a.category !== category) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'added':
          return a.createdAt < b.createdAt ? 1 : -1;
        case 'gain': {
          const ga = assetMetrics(a, market).unrealizedGainLkr;
          const gb = assetMetrics(b, market).unrealizedGainLkr;
          return (gb ?? -Infinity) - (ga ?? -Infinity);
        }
        case 'value':
        default: {
          const va = resolveAssetValuation(a, market).valueLkr;
          const vb = resolveAssetValuation(b, market).valueLkr;
          return (vb ?? -Infinity) - (va ?? -Infinity);
        }
      }
    });
    return list;
  }, [assets, query, category, statusFilter, sort, market]);

  const filtersActive = query !== '' || category !== 'all' || statusFilter !== 'active';
  const assetCount = {
    active: assets.filter((a) => a.status === 'active').length,
    other: assets.length - assets.filter((a) => a.status === 'active').length,
  };

  if (assets.length === 0) {
    return (
      <div className="max-w-xl mx-auto pt-10 animate-fadeUp">
        <Card elevated>
          <EmptyState
            icon={<Sparkles size={24} className="text-accent" />}
            title="Your physical vault is empty"
            body="Start cataloging your wealth — gold & precious metals, gemstones & fine jewelry, luxury watches, land & property, or vehicles. Every asset maintains its own records, purchase costs, and valuation history."
            action={
              <Button variant="primary" size="md" onClick={() => navigate('/add')}>
                <Plus size={16} /> Add your first asset
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeUp">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 flex-wrap pb-2 border-b border-ink-800/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-txt">My Physical Assets</h1>
          <p className="text-xs text-txt-muted mt-0.5">
            {assetCount.active} active asset{assetCount.active === 1 ? '' : 's'}
            {assetCount.other > 0 ? ` · ${assetCount.other} sold or archived` : ''}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate('/add')}>
          <Plus size={14} /> Add Asset
        </Button>
      </header>

      {/* Category Pills Bar */}
      <div className="flex gap-2 overflow-x-auto pb-1.5 pt-0.5 -mx-1 px-1 no-scrollbar" role="toolbar" aria-label="Category filters">
        <Pill active={category === 'all'} onClick={() => setCategory('all')}>
          <span>All Classes</span>
          <span className="tnum text-[10px] opacity-70 font-mono">({assets.length})</span>
        </Pill>
        {CATEGORIES.map((c) => {
          const count = assets.filter((a) => a.category === c.id).length;
          const Icon = c.icon;
          return (
            <Pill key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
              <Icon size={13} className="shrink-0" />
              <span>{c.shortLabel}</span>
              {count > 0 && (
                <span className="tnum text-[10px] opacity-70 font-mono">({count})</span>
              )}
            </Pill>
          );
        })}
      </div>

      {/* Filter and View Controls Bar */}
      <div className="flex flex-wrap gap-2.5 items-center justify-between bg-ink-900/60 p-2.5 rounded-xl border border-ink-700/80">
        <div className="flex flex-wrap gap-2 items-center flex-1 min-w-[240px]">
          {/* Search Field */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-dim" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search assets…"
              aria-label="Search assets"
              className="pl-8 pr-8 text-xs h-8"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-txt-dim hover:text-txt"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Sort Select */}
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort assets"
            className="w-auto text-xs h-8 py-0"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>

          {/* Status Select */}
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'active' | 'sold' | 'archived' | 'all')}
            aria-label="Filter by status"
            className="w-auto text-xs h-8 py-0"
          >
            <option value="active">Active Only</option>
            <option value="sold">Sold Only</option>
            <option value="archived">Archived Only</option>
            <option value="all">All Records</option>
          </Select>

          {filtersActive && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setQuery('');
                setCategory('all');
                setStatusFilter('active');
              }}
              className="text-2xs text-txt-dim hover:text-txt"
            >
              <X size={12} /> Reset
            </Button>
          )}
        </div>

        {/* Grid/List View Toggle */}
        <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5 overflow-hidden" role="group" aria-label="Display mode">
          <button
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
            title="Grid view"
            className={`p-1.5 rounded-md transition-colors duration-120 ${
              view === 'grid' ? 'bg-ink-750 text-accent shadow-elev-1' : 'text-txt-dim hover:text-txt'
            }`}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            title="List view"
            className={`p-1.5 rounded-md transition-colors duration-120 ${
              view === 'list' ? 'bg-ink-750 text-accent shadow-elev-1' : 'text-txt-dim hover:text-txt'
            }`}
          >
            <List size={15} />
          </button>
        </div>
      </div>

      {/* Assets Presentation */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Filter size={20} className="text-txt-dim" />}
            title="No matching assets found"
            body={
              filtersActive
                ? 'Try adjusting your search terms or clearing active filters.'
                : 'No assets exist in this view.'
            }
            action={
              filtersActive ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setCategory('all');
                    setStatusFilter('active');
                  }}
                >
                  Clear Filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : view === 'grid' ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {filtered.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              market={market}
              displayCurrency={settings.displayCurrency}
              usdLkr={usdLkr}
            />
          ))}
        </div>
      ) : (
        <Card className="divide-y divide-ink-800/80 overflow-hidden">
          {filtered.map((a) => {
            const resolved = resolveAssetValuation(a, market);
            const m = assetMetrics(a, market);
            const meta = categoryMeta(a.category);
            const Icon = meta.icon;
            const gain = m.unrealizedGainLkr;

            return (
              <Link
                key={a.id}
                to={`/portfolio/${a.id}`}
                className="flex items-center gap-3.5 px-4 py-3 hover:bg-ink-850/70 transition-colors group"
              >
                <span className="w-8 h-8 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center text-accent shrink-0 group-hover:scale-105 transition-transform">
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-txt truncate group-hover:text-white">
                      {a.name}
                    </p>
                    {a.quantity && a.quantity > 1 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-ink-800 text-txt-dim border border-ink-700">
                        ×{a.quantity}
                      </span>
                    )}
                  </div>
                  <p className="text-2xs text-txt-dim mt-0.5">
                    {meta.label} · Updated {relativeTime(a.valuation.updatedAt)}
                  </p>
                </div>

                {a.status !== 'active' && (
                  <Badge tone="warning" className="text-[9px] uppercase">
                    {a.status}
                  </Badge>
                )}

                {gain !== null && a.status === 'active' && (
                  <span
                    className={`tnum text-xs font-medium hidden md:block w-24 text-right ${
                      gain >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {gain >= 0 ? '+' : ''}
                    {formatMoney(gain, settings.displayCurrency, usdLkr)}
                  </span>
                )}

                <div className="tnum text-xs font-semibold text-right w-32 truncate">
                  {resolved.valueLkr === null ? (
                    <span className="text-txt-dim font-normal text-2xs">No valuation</span>
                  ) : (
                    formatMoney(resolved.valueLkr, settings.displayCurrency, usdLkr)
                  )}
                </div>
              </Link>
            );
          })}
        </Card>
      )}

      {/* Honest Note */}
      <p className="text-2xs text-txt-dim text-center pt-2">
        Assets without a valuation are excluded from portfolio totals — never counted as zero.
      </p>
    </div>
  );
}
