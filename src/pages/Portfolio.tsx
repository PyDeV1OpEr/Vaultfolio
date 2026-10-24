import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpDown, LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import { useData } from '../store/dataStore';
import { CATEGORIES, categoryMeta } from '../lib/categories';
import { assetMetrics, resolveAssetValuation } from '../lib/valuation';
import { formatMoney, relativeTime } from '../lib/money';
import type { AssetCategory, AssetStatus } from '../lib/types';
import { AssetCard } from '../components/AssetCard';
import { Badge, Button, Card, EmptyState, Input, Select } from '../components/ui';

type SortKey = 'value' | 'name' | 'added' | 'gain';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'value', label: 'Estimated value (high → low)' },
  { value: 'name', label: 'Name (A → Z)' },
  { value: 'added', label: 'Date added (new → old)' },
  { value: 'gain', label: 'Gain/loss (best → worst)' },
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
  const assetCount = { active: assets.filter((a) => a.status === 'active').length, other: assets.length - assets.filter((a) => a.status === 'active').length };

  if (assets.length === 0) {
    return (
      <div className="max-w-lg mx-auto pt-10">
        <Card>
          <EmptyState
            icon={<span className="text-xl">🔐</span>}
            title="Your portfolio is empty"
            body="Add pieces of your physical wealth — each one gets a detail page with purchase records, estimates and valuation history."
            action={
              <Button variant="primary" onClick={() => navigate('/add')}>
                <Plus size={15} /> Add your first asset
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeUp">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold">My Portfolio</h1>
          <p className="text-sm text-txt-muted mt-1">
            {assetCount.active} active{assetCount.other > 0 ? ` · ${assetCount.other} sold/archived` : ''}
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate('/add')}>
          <Plus size={15} /> Add Asset
        </Button>
      </header>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="toolbar" aria-label="Category filters">
        <Chip active={category === 'all'} onClick={() => setCategory('all')} count={assets.length}>
          All Assets
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip
            key={c.id}
            active={category === c.id}
            onClick={() => setCategory(c.id)}
            count={assets.filter((a) => a.category === c.id).length}
          >
            <c.icon size={13} />
            {c.label}
          </Chip>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2.5 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-dim" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            aria-label="Search assets"
            className="pl-9 pr-8"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-txt-dim hover:text-txt"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort assets"
          className="w-auto"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'active' | 'sold' | 'archived' | 'all')}
          aria-label="Filter by status"
          className="w-auto"
        >
          <option value="active">Active</option>
          <option value="sold">Sold</option>
          <option value="archived">Archived</option>
          <option value="all">All statuses</option>
        </Select>
        <div className="flex rounded-lg border border-ink-700 overflow-hidden" role="group" aria-label="Display mode">
          <button
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
            title="Grid view"
            className={`p-2.5 ${view === 'grid' ? 'bg-accent-soft text-accent' : 'text-txt-muted hover:bg-ink-800'}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            title="List view"
            className={`p-2.5 ${view === 'list' ? 'bg-accent-soft text-accent' : 'text-txt-muted hover:bg-ink-800'}`}
          >
            <List size={16} />
          </button>
        </div>
        {filtersActive && (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery('');
              setCategory('all');
              setStatusFilter('active');
            }}
          >
            <X size={13} /> Clear filters
          </Button>
        )}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search size={20} />}
            title="No assets match"
            body={
              filtersActive
                ? 'Try different search terms, another category, or clear the filters.'
                : 'Nothing here yet.'
            }
            action={
              filtersActive ? (
                <Button
                  onClick={() => {
                    setQuery('');
                    setCategory('all');
                    setStatusFilter('active');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : view === 'grid' ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {filtered.map((a) => (
            <AssetCard key={a.id} asset={a} market={market} displayCurrency={settings.displayCurrency} usdLkr={usdLklSafe(usdLkr)} />
          ))}
        </div>
      ) : (
        <Card className="divide-y divide-ink-800">
          {filtered.map((a) => (
            <Link
              key={a.id}
              to={`/portfolio/${a.id}`}
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-ink-850 transition-colors"
            >
              {(() => {
                const Icon = categoryMeta(a.category).icon;
                return <Icon size={17} className="text-txt-muted shrink-0" />;
              })()}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{a.name}</p>
                <p className="text-[11px] text-txt-dim">
                  {categoryMeta(a.category).label} · {relativeTime(a.valuation.updatedAt)}
                </p>
              </div>
              {a.status !== 'active' && <Badge>{a.status}</Badge>}
              <p className="tnum text-sm text-right hidden sm:block w-32 truncate">
                {resolveAssetValuation(a, market).valueLkr === null
                  ? <span className="text-txt-dim text-[12px]">No valuation</span>
                  : formatMoney(resolveAssetValuation(a, market).valueLkr!, settings.displayCurrency, usdLklSafe(usdLkr))}
              </p>
            </Link>
          ))}
        </Card>
      )}

      {/* convention note */}
      <p className="text-[11px] text-txt-dim">
        Assets without a valuation are excluded from totals — they are never counted as zero.
      </p>
    </div>
  );
}

function usdLklSafe(v: number | null) {
  return v ? v : undefined;
}

function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
        active
          ? 'bg-accent-soft border-accent/40 text-accent'
          : 'bg-ink-900 border-ink-700 text-txt-muted hover:text-txt hover:border-ink-600'
      }`}
    >
      {children}
      <span className="tnum opacity-60">{count}</span>
    </button>
  );
}
