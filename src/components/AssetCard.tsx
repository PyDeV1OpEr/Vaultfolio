import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import type { Asset, MarketSnapshot, CurrencyCode, AssetCategory } from '../lib/types';
import { categoryMeta } from '../lib/categories';
import { assetMetrics, resolveAssetValuation, valuationMethodLabel } from '../lib/valuation';
import { formatMoney, relativeTime } from '../lib/money';

const CATEGORY_COLORS: Record<AssetCategory, { icon: string; bg: string; border: string }> = {
  gold_silver: {
    icon: 'text-amber-400',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/20',
  },
  gems_jewelry: {
    icon: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/20',
  },
  watches: {
    icon: 'text-sky-400',
    bg: 'bg-sky-400/10',
    border: 'border-sky-400/20',
  },
  land_property: {
    icon: 'text-teal-400',
    bg: 'bg-teal-400/10',
    border: 'border-teal-400/20',
  },
  cars: {
    icon: 'text-blue-400',
    bg: 'bg-blue-400/10',
    border: 'border-blue-400/20',
  },
  motorcycles: {
    icon: 'text-indigo-400',
    bg: 'bg-indigo-400/10',
    border: 'border-indigo-400/20',
  },
  other: {
    icon: 'text-violet-400',
    bg: 'bg-violet-400/10',
    border: 'border-violet-400/20',
  },
};

export function AssetCard({
  asset,
  market,
  displayCurrency,
  usdLkr,
}: {
  asset: Asset;
  market: MarketSnapshot | null;
  displayCurrency: CurrencyCode;
  usdLkr?: number | null;
}) {
  const meta = categoryMeta(asset.category);
  const Icon = meta.icon;
  const colors = CATEGORY_COLORS[asset.category] ?? CATEGORY_COLORS.other;
  const resolved = resolveAssetValuation(asset, market);
  const m = assetMetrics(asset, market);
  const gain = m.unrealizedGainLkr;

  const returnPct =
    gain !== null && m.purchaseCostLkr && m.purchaseCostLkr > 0
      ? (gain / m.purchaseCostLkr) * 100
      : null;

  return (
    <Link
      to={`/portfolio/${asset.id}`}
      className={`
        group relative block bg-ink-900 border border-ink-700/80 rounded-xl p-4
        hover:border-ink-600 hover:bg-ink-850/80 card-lift transition-all duration-150
        ${asset.status === 'sold' ? 'opacity-65' : ''}
      `}
    >
      {/* Top Header */}
      <div className="flex items-start gap-3">
        <span
          className={`w-10 h-10 rounded-xl ${colors.bg} ${colors.border} border flex items-center justify-center shrink-0 ${colors.icon} transition-transform duration-120 group-hover:scale-105`}
        >
          <Icon size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-txt truncate tracking-tight group-hover:text-white transition-colors">
              {asset.name}
            </p>
            {asset.quantity && asset.quantity > 1 && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-ink-800 text-txt-muted border border-ink-700 shrink-0">
                ×{asset.quantity}
              </span>
            )}
          </div>
          <p className="text-2xs text-txt-dim mt-0.5 flex items-center gap-1.5">
            <span>{meta.label}</span>
            {asset.status !== 'active' && (
              <>
                <span>·</span>
                <span className="font-medium uppercase text-[9px] px-1 py-0.2 rounded bg-ink-800 text-amber-400 border border-amber-400/20">
                  {asset.status}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="text-txt-dim group-hover:text-accent transition-colors shrink-0 mt-0.5">
          <ArrowUpRight size={15} />
        </div>
      </div>

      {/* Value & Gain Body */}
      <div className="mt-3.5 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold tnum text-txt value-display leading-tight truncate">
            {resolved.valueLkr === null ? (
              <span className="text-txt-dim font-normal text-xs">Valuation unavailable</span>
            ) : (
              formatMoney(resolved.valueLkr, displayCurrency, usdLkr)
            )}
          </p>
          <p className="text-2xs text-txt-dim mt-1 truncate">
            {resolved.valueLkr === null
              ? 'Add an estimate'
              : `${valuationMethodLabel(resolved.method)} · ${relativeTime(asset.valuation.updatedAt)}`}
          </p>
        </div>

        {gain !== null && asset.status === 'active' && (
          <div className="text-right shrink-0">
            <p
              className={`text-xs font-semibold tnum leading-tight ${
                gain >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {gain >= 0 ? '+' : ''}
              {formatMoney(gain, displayCurrency, usdLkr)}
            </p>
            {returnPct !== null && (
              <p className="text-[10px] text-txt-dim font-mono mt-0.5">
                {returnPct >= 0 ? '+' : ''}
                {returnPct.toFixed(1)}%
              </p>
            )}
          </div>
        )}
      </div>

      {/* Purchase Cost Footer */}
      {m.purchaseCostLkr != null && (
        <div className="text-2xs text-txt-dim mt-3 pt-2.5 border-t border-ink-800/80 flex items-center justify-between">
          <span className="truncate">
            Paid {formatMoney(m.purchaseCostLkr, displayCurrency, usdLkr)}
          </span>
          {asset.purchase.date && (
            <span className="text-txt-faint shrink-0 ml-2">
              {new Date(asset.purchase.date).getFullYear()}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
