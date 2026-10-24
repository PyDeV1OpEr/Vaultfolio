import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { Asset, MarketSnapshot, CurrencyCode } from '../lib/types';
import { categoryMeta } from '../lib/categories';
import { assetMetrics, resolveAssetValuation, valuationMethodLabel } from '../lib/valuation';
import { formatMoney, relativeTime } from '../lib/money';

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
  const resolved = resolveAssetValuation(asset, market);
  const m = assetMetrics(asset, market);
  const gain = m.unrealizedGainLkr;

  return (
    <Link
      to={`/portfolio/${asset.id}`}
      className={`group block bg-ink-900 border border-ink-700 rounded-xl p-4 hover:border-ink-600 hover:bg-ink-850 transition-colors ${
        asset.status === 'sold' ? 'opacity-75' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-10 h-10 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center shrink-0 ${
            asset.category === 'gold_silver' ? 'text-amber-300' : 'text-accent'
          }`}
        >
          <Icon size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-txt truncate">{asset.name}</p>
          <p className="text-[11px] text-txt-muted mt-0.5">
            {meta.label}
            {asset.status !== 'active' && ` · ${asset.status.charAt(0).toUpperCase()}${asset.status.slice(1)}`}
          </p>
        </div>
        <ChevronRight size={16} className="text-txt-dim group-hover:text-accent transition-colors shrink-0 mt-1" />
      </div>

      <div className="mt-3.5 flex items-end justify-between gap-2">
        <div>
          <p className="text-lg font-semibold tnum leading-tight">
            {resolved.valueLkr === null ? (
              <span className="text-txt-dim font-normal text-sm">Valuation unavailable</span>
            ) : (
              formatMoney(resolved.valueLkr, displayCurrency, usdLkr)
            )}
          </p>
          <p className="text-[11px] text-txt-dim mt-1">
            {resolved.valueLkr === null
              ? 'Add an estimate'
              : `${valuationMethodLabel(resolved.method)} · ${relativeTime(asset.valuation.updatedAt)}`}
          </p>
        </div>
        {gain !== null && asset.status === 'active' && (
          <div className="text-right shrink-0">
            <p
              className={`text-[12px] font-medium tnum ${gain >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {gain >= 0 ? '+' : ''}
              {formatMoney(gain, displayCurrency, usdLkr)}
            </p>
            <p className="text-[11px] text-txt-dim">est. total gain</p>
          </div>
        )}
      </div>

      {m.purchaseCostLkr != null && (
        <p className="text-[11px] text-txt-dim mt-2.5 pt-2.5 border-t border-ink-800">
          Purchased for {formatMoney(m.purchaseCostLkr, displayCurrency, usdLkr)}
          {asset.purchase.date ? ` · ${new Date(asset.purchase.date).getFullYear()}` : ''}
        </p>
      )}
    </Link>
  );
}
