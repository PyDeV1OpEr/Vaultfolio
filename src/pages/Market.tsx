import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Database, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { useData } from '../store/dataStore';
import { assetMetrics, resolveAssetValuation } from '../lib/valuation';
import { categoryMeta } from '../lib/categories';
import { formatDateTime, formatMoney, parseNum, relativeTime, isStale } from '../lib/money';
import { DEMO_MARKET } from '../lib/market';
import { Badge, Button, Card, CardHeader, Field, Input } from '../components/ui';

export function MarketPage() {
  const { market, marketLoading, refreshMarket, overrides, setOverride, assets, records, settings } = useData();
  const [goldOv, setGoldOv] = useState(overrides.gold_per_gram != null ? String(overrides.gold_per_gram) : '');
  const [silverOv, setSilverOv] = useState(overrides.silver_per_gram != null ? String(overrides.silver_per_gram) : '');
  const [fxOv, setFxOv] = useState(overrides.usd_lkr != null ? String(overrides.usd_lkr) : '');

  const lastRecord = records[0];

  const staleAssets = useMemo(() => {
    return assets
      .filter((a) => a.status === 'active')
      .map((a) => {
        const resolved = resolveAssetValuation(a, market);
        const staleness = isStale(a.valuation.updatedAt, 180);
        return { a, resolved, staleness };
      })
      .filter((x) => x.resolved.valueLkr === null || x.staleness)
      .sort((x, y) => Number(y.staleness) - Number(x.staleness) || a_name(x, y));
    function a_name(x: { a: { name: string } }, y: { a: { name: string } }) {
      return x.a.name.localeCompare(y.a.name);
    }
  }, [assets, market]);

  const recentUpdates = useMemo(
    () =>
      [...records]
        .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
        .slice(0, 6)
        .map((r) => ({ ...r, asset: assets.find((a) => a.id === r.assetId) })),
    [records, assets],
  );
  const valueOf = (id: string) => resolveAssetValuation(assets.find((a) => a.id === id) as any, market).valueLkr;
  const pctOfPortfolio = (a: any) => {
    const s = assetMetrics(a, market);
    return s.currentValueLkr;
  };
  void pctOfPortfolio;
  void valueOf;

  const isDemo = market?.isDemo ?? true;

  return (
    <div className="max-w-5xl space-y-5 animate-fadeUp">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold">Market &amp; Valuations</h1>
          <p className="text-sm text-txt-muted mt-1">
            Transparent pricing inputs — every asset page states exactly where its value came from.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refreshMarket()}>
          <RefreshCw size={15} className={marketLoading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </header>

      {/* Source status */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-start gap-3">
            <Database size={17} className="text-accent mt-0.5" />
            <div className="text-[13px]">
              <p className="font-medium flex items-center gap-2">
                {market?.sourceLabel ?? 'No source'}
                {isDemo ? (
                  <Badge tone="demo">Demo placeholder</Badge>
                ) : (
                  <Badge tone="accent">{market?.isLive ? 'Live' : 'Cached'}</Badge>
                )}
              </p>
              <p className="text-txt-muted mt-1">
                {isDemo ? (
                  <>
                    No market-data provider is configured. Values below are <strong>demo placeholders</strong> ({DEMO_MARKET.asOf}) —
                    not real Sri Lankan market prices. Set <code className="text-accent">VITE_METALS_API_URL</code> or use manual
                    overrides for real pricing.
                  </>
                ) : (
                  <>Updated {market?.asOf ? formatDateTime(market.asOf) : '—'} ({relativeTime(market?.asOf)}). Provider: {market?.sourceLabel}.</>
                )}
              </p>
            </div>
          </div>
          {lastRecord && (
            <p className="text-[11px] text-txt-dim">
              Latest recorded asset valuation: {formatDateTime(lastRecord.recordedAt)}
            </p>
          )}
        </div>
      </Card>

      {/* Prices */}
      <div className="grid md:grid-cols-3 gap-3.5">
        <PriceCard
          title="Gold (24k)"
          value={market?.goldPerGramLkr}
          unit="LKR / gram"
          note={isDemo ? 'Demo placeholder' : market?.sourceLabel ?? ''}
          manual={overrides.gold_per_gram}
        />
        <PriceCard
          title="Silver (fine)"
          value={market?.silverPerGramLkr}
          unit="LKR / gram"
          note={isDemo ? 'Demo placeholder' : market?.sourceLabel ?? ''}
          manual={overrides.silver_per_gram}
        />
        <PriceCard
          title="Exchange rate"
          value={market?.usdLkr}
          unit="LKR / USD"
          note={isDemo ? 'Demo placeholder — conversions to USD rough' : market?.sourceLabel ?? ''}
          manual={overrides.usd_lkr}
        />
      </div>
      {isDemo && (
        <Card className="p-4 flex gap-3">
          <ShieldAlert size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-txt-muted">
            <strong className="text-amber-400">Reality note:</strong> an indicative market price is not the
            price a Sri Lankan dealer will actually pay. Bullion dealers apply spreads, and jewelry resales
            trade near fine-metal value only.
          </p>
        </Card>
      )}

      {/* Manual overrides */}
      <Card>
        <CardHeader
          title="Manual price overrides"
          subtitle="Enter a real quote you verified (e.g. today's dealer rate). Overrides persist locally and label themselves as manual."
        />
        <div className="px-5 pb-5 grid sm:grid-cols-3 gap-3 items-end">
          <Field label="Gold — LKR / gram">
            <Input inputMode="decimal" value={goldOv} onChange={(e) => setGoldOv(e.target.value)} placeholder="e.g. 26450" />
          </Field>
          <Field label="Silver — LKR / gram">
            <Input inputMode="decimal" value={silverOv} onChange={(e) => setSilverOv(e.target.value)} placeholder="e.g. 108" />
          </Field>
          <Field label="USD → LKR rate">
            <Input inputMode="decimal" value={fxOv} onChange={(e) => setFxOv(e.target.value)} placeholder="e.g. 297.50" />
          </Field>
        </div>
        <div className="px-5 pb-5 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              if (goldOv) setOverride('gold_per_gram', parseNum(goldOv) ?? -1);
              if (silverOv) setOverride('silver_per_gram', parseNum(silverOv) ?? -1);
              if (fxOv) setOverride('usd_lkr', parseNum(fxOv) ?? -1);
            }}
          >
            <Save size={14} /> Apply overrides
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOverride('gold_per_gram', null);
              setOverride('silver_per_gram', null);
              setOverride('usd_lkr', null);
              setGoldOv('');
              setSilverOv('');
              setFxOv('');
            }}
          >
            Clear overrides
          </Button>
        </div>
      </Card>

      {/* Assets needing attention */}
      <Card>
        <CardHeader
          title="Assets with missing or stale valuations"
          subtitle="Untouched for 6+ months, or never valued. Stale numbers shouldn't be silently trusted."
        />
        {staleAssets.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-txt-muted">Every active asset has a recent valuation. 👍</p>
        ) : (
          <ul className="px-5 pb-5 divide-y divide-ink-800">
            {staleAssets.map(({ a, resolved, staleness }) => {
              const Meta = categoryMeta(a.category);
              return (
                <li key={a.id} className="py-3 flex items-center gap-3">
                  <Meta.icon size={16} className="text-txt-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/portfolio/${a.id}`} className="text-[13px] font-medium hover:text-accent truncate block">
                      {a.name}
                    </Link>
                    <p className="text-[11px] text-txt-dim">
                      {resolved.valueLkr === null
                        ? 'No valuation recorded'
                        : `Last updated ${relativeTime(a.valuation.updatedAt)} (${formatDateTime(a.valuation.updatedAt)})`}
                    </p>
                  </div>
                  {resolved.valueLkr === null ? (
                    <Badge tone="warning">Missing</Badge>
                  ) : staleness ? (
                    <Badge tone="warning">Stale</Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Recent valuation updates */}
      <Card>
        <CardHeader title="Recent valuation updates" subtitle={recentUpdates.length ? 'Recorded events across your portfolio' : 'Nothing recorded yet'} />
        {recentUpdates.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-txt-muted">Update a valuation from any asset page to start the record.</p>
        ) : (
          <ul className="px-5 pb-5 divide-y divide-ink-800">
            {recentUpdates.map((r) => (
              <li key={r.id} className="py-3 flex items-center gap-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <Link to={`/portfolio/${r.asset?.id ?? ''}`} className="font-medium hover:text-accent truncate block" style={{ display: 'block' }}>
                    {r.asset?.name ?? 'Deleted asset'}
                  </Link>
                  <p className="text-[11px] text-txt-dim">{r.sourceLabel} · {relativeTime(r.recordedAt)}</p>
                </div>
                <p className="tnum text-right">
                  {r.valueLkr === null ? '—' : formatMoney(r.valueLkr, settings.displayCurrency, market?.usdLkr)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {staleAssets.length > 0 && assets.length > 6 && (
        <div className="flex items-center gap-2 text-[11px] text-txt-dim">
          <CircleAlert size={12} /> {staleAssets.length} of {assets.length} assets need valuation attention.
        </div>
      )}
    </div>
  );
}

function PriceCard({
  title,
  value,
  unit,
  note,
  manual,
}: {
  title: string;
  value: number | null | undefined;
  unit: string;
  note: string;
  manual?: number;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-txt-muted">{title}</p>
        {manual != null && <Badge tone="accent">Manual</Badge>}
      </div>
      <p className="text-lg xl:text-xl font-semibold tnum mt-2">
        {value == null ? '—' : marketFmt(value)} <span className="text-[11px] text-txt-dim font-normal">{unit}</span>
      </p>
      <p className="text-[11px] text-txt-dim mt-1 leading-snug">{note}</p>
    </Card>
  );
}

const marketFmt = (v: number) =>
  v % 1 === 0 ? v.toLocaleString('en-US') : v.toFixed(2);
