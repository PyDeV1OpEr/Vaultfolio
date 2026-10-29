import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  BarChart2,
  Info,
  ChevronRight,
  Zap,
  Settings2,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useData } from '../store/dataStore';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  IconButton,
} from '../components/ui';
import {
  type MetalCode,
  type PriceObservation,
  type MarketWatchSettings,
  type FreshnessStatus,
  METAL_META,
  loadPriceHistory,
  savePriceHistory,
  loadMarketWatchSettings,
  saveMarketWatchSettings,
  mergeObservations,
  observationsForMetal,
  filterByRange,
  rangeChange,
  fetchLatestPrices,
  freshnessStatus,
  freshnessLabel,
  usdPerOztToLkrPerGram,
  formatObservationPrice,
  credentialStatus,
  msUntilNextFetch,
  scheduleDescription,
  estimateMonthlyRequests,
  providerLabel,
} from '../lib/marketWatch';
import { formatDateTime, relativeTime } from '../lib/money';

/* ─────────────────────────── Constants ─────────────────────────── */

const ALL_METALS: MetalCode[] = ['XAU', 'XAG', 'XPT', 'XPD', 'XCU'];

const RANGE_LABELS: Record<MarketWatchSettings['selectedRange'], string> = {
  '1h': '1H',
  '12h': '12H',
  '24h': '24H',
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  all: 'All',
};

const METAL_COLORS: Record<MetalCode, string> = {
  XAU: '#fbbf24', // amber
  XAG: '#e2e8f0', // slate-100
  XPT: '#7dd3fc', // sky-300
  XPD: '#a78bfa', // violet
  XCU: '#fb923c', // orange
};

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#0e131c',
  borderColor: '#232d40',
  borderRadius: '10px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  fontSize: '12px',
  color: '#f2f5fa',
  padding: '8px 12px',
};

/* ─────────────────────────── Top-level page ─────────────────────────── */

export function MarketWatchPage() {
  const { market } = useData();

  const [history, setHistory] = useState<PriceObservation[]>(() => loadPriceHistory());
  const [settings, setSettings] = useState<MarketWatchSettings>(() => loadMarketWatchSettings());
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchResult, setLastFetchResult] = useState<{
    added: number;
    fallback: boolean;
    providerLabel: string;
  } | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const schedulerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const creds = useMemo(() => credentialStatus(), []);

  /* ── Persist settings ── */
  const updateSettings = useCallback((patch: Partial<MarketWatchSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveMarketWatchSettings(next);
      return next;
    });
  }, []);

  /* ── Manual/auto fetch ── */
  const doFetch = useCallback(
    async (isManual = false) => {
      if (fetchState === 'loading') return;
      if (isManual && Date.now() < cooldownUntil) return;

      setFetchState('loading');
      setFetchError(null);

      try {
        const result = await fetchLatestPrices(ALL_METALS);
        const now = new Date().toISOString();

        // Merge with existing history (deduplication is inside mergeObservations)
        const merged = mergeObservations(history, result.observations);
        savePriceHistory(merged);
        setHistory(merged);

        const newCount = merged.length - history.length;
        const provLabel = result.providerUsed === 'goldapi' ? 'GoldAPI.io' : 'gold-api.com (keyless fallback)';

        setLastFetchResult({ added: newCount, fallback: result.fallbackUsed, providerLabel: provLabel });
        updateSettings({ lastFetchAt: now });
        setFetchState('success');
        setTimeout(() => setFetchState('idle'), 3000);

        if (isManual) {
          setCooldownUntil(Date.now() + 60_000); // 60-second manual refresh cooldown
        }
      } catch (err) {
        setFetchError((err as Error).message);
        setFetchState('error');
        setTimeout(() => setFetchState('idle'), 8000);
      }
    },
    [fetchState, cooldownUntil, history, updateSettings],
  );

  /* ── Auto-scheduler ── */
  useEffect(() => {
    if (!settings.autoFetchEnabled || !creds.anyConfigured) return;

    const schedule = () => {
      const ms = msUntilNextFetch(settings);
      if (ms === 0 || ms === Infinity) {
        if (ms === 0) void doFetch(false);
        return;
      }
      schedulerRef.current = setTimeout(() => {
        void doFetch(false);
        schedule();
      }, ms);
    };

    schedule();

    return () => {
      if (schedulerRef.current) clearTimeout(schedulerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoFetchEnabled, settings.fetchesPerDay, settings.lastFetchAt, creds.anyConfigured]);

  /* ── Derived current metal data ── */
  const metalObs = useMemo(
    () => observationsForMetal(history, settings.selectedMetal),
    [history, settings.selectedMetal],
  );

  const rangeObs = useMemo(
    () => filterByRange(metalObs, settings.selectedRange),
    [metalObs, settings.selectedRange],
  );

  const latest = metalObs.length > 0 ? metalObs[metalObs.length - 1] : null;
  const secondLatest = metalObs.length > 1 ? metalObs[metalObs.length - 2] : null;
  const freshness = freshnessStatus(latest);

  // USD/LKR from the existing market store (separately sourced FX rate)
  const usdLkr = market?.usdLkr ?? null;

  /* ── Change, computed from REAL observations in the selected window first ── */
  const rangeChangeInfo = useMemo(() => rangeChange(rangeObs), [rangeObs]);

  const computedChange = useMemo(() => {
    // Preferred: end-to-end change across the selected time range (real data points)
    if (rangeChangeInfo) {
      return { abs: rangeChangeInfo.abs, pct: rangeChangeInfo.pct };
    }
    // Fallback: provider-supplied previous-session change
    if (latest?.change !== null && latest?.change !== undefined) {
      return { abs: latest.change, pct: latest.changePct ?? null };
    }
    if (latest && secondLatest && secondLatest.providerId === latest.providerId) {
      const abs = latest.price - secondLatest.price;
      const pct = secondLatest.price > 0 ? (abs / secondLatest.price) * 100 : null;
      return { abs, pct };
    }
    return null;
  }, [rangeChangeInfo, latest, secondLatest]);

  return (
    <div className="max-w-5xl space-y-5 animate-fadeUp">
      {/* ── Page header ── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold flex items-center gap-2.5">
            <BarChart2 size={20} className="text-accent shrink-0" />
            Market Watch
          </h1>
          <p className="text-sm text-txt-muted mt-1">
            International spot prices — USD denominated, for reference only. Not Sri Lankan dealer quotes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton
            state={fetchState}
            cooldownUntil={cooldownUntil}
            credConfigured={creds.anyConfigured}
            onClick={() => void doFetch(true)}
          />
        </div>
      </header>

      {/* ── Credentials notice ── */}
      {!creds.anyConfigured && <CredentialsNotice />}

      {/* ── Metal selector strip ── */}
      <MetalSelector
        selected={settings.selectedMetal}
        history={history}
        onChange={(m) => updateSettings({ selectedMetal: m })}
      />

      {/* ── Price summary card ── */}
      <PriceSummaryCard
        metal={settings.selectedMetal}
        latest={latest}
        freshness={freshness}
        change={computedChange}
        usdLkr={usdLkr}
        usdLkrSource={market?.sourceLabel ?? null}
        rangeCount={rangeObs.length}
        selectedRange={settings.selectedRange}
      />

      {/* ── Timeline chart ── */}
      <Card>
        <CardHeader
          title={`${METAL_META[settings.selectedMetal].label} Price History (USD/${METAL_META[settings.selectedMetal].displayUnit})`}
          subtitle={
            rangeObs.length > 0
              ? `${rangeObs.length} data point${rangeObs.length === 1 ? '' : 's'} for this range`
              : 'No data yet for this range'
          }
          action={
            <RangeSelector
              value={settings.selectedRange}
              onChange={(r) => updateSettings({ selectedRange: r })}
            />
          }
        />
        <div className="px-5 pb-5">
          <PriceChart
            observations={rangeObs}
            metal={settings.selectedMetal}
            range={settings.selectedRange}
          />
        </div>
      </Card>

      {/* ── Provider status + fetch result ── */}
      {(fetchState === 'error' || fetchState === 'success' || lastFetchResult) && (
        <FetchResultBanner
          state={fetchState}
          error={fetchError}
          result={lastFetchResult}
        />
      )}

      {/* ── Coverage + status grid ── */}
      <MetalCoverageGrid history={history} />

      {/* ── Schedule & request budget ── */}
      <ScheduleCard
        settings={settings}
        credConfigured={creds.anyConfigured}
        onUpdate={updateSettings}
      />

      {/* ── Disclaimer ── */}
      <Disclaimer usdLkrSource={market?.sourceLabel} />
    </div>
  );
}

/* ─────────────────────────── Sub-components ─────────────────────────── */

function RefreshButton({
  state,
  cooldownUntil,
  credConfigured,
  onClick,
}: {
  state: string;
  cooldownUntil: number;
  credConfigured: boolean;
  onClick: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  const cooldownSec = Math.ceil((cooldownUntil - now) / 1000);
  const inCooldown = cooldownUntil > now;

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={state === 'loading' || inCooldown || !credConfigured}
      onClick={onClick}
      title={!credConfigured ? 'API credentials not configured' : undefined}
    >
      <RefreshCw size={14} className={state === 'loading' ? 'animate-spin' : ''} />
      {state === 'loading'
        ? 'Fetching…'
        : inCooldown
        ? `Wait ${cooldownSec}s`
        : 'Refresh'}
    </Button>
  );
}

function CredentialsNotice() {
  return (
    <Card className="p-4 flex gap-3 border-accent/25 bg-accent-soft/20">
      <AlertTriangle size={16} className="text-accent shrink-0 mt-0.5" />
      <div className="text-xs text-txt-muted space-y-1">
        <p className="font-semibold text-txt">Live prices refresh via the keyless gold-api.com fallback</p>
        <p>
          All five metals (gold, silver, platinum, palladium, copper) are fetched without a key.
          Optionally set{' '}
          <code className="bg-ink-800 px-1 rounded text-accent">VITE_GOLDAPI_KEY</code> in your{' '}
          <code className="bg-ink-800 px-1 rounded text-accent">.env.local</code> to add GoldAPI.io as a primary
          source for gold, silver, platinum, and palladium.
        </p>
        <p className="text-txt-dim">
          Copper is quoted against the COMEX HG continuous contract (USD per pound), mapped to XCU.
        </p>
      </div>
    </Card>
  );
}

function MetalSelector({
  selected,
  history,
  onChange,
}: {
  selected: MetalCode;
  history: PriceObservation[];
  onChange: (m: MetalCode) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {ALL_METALS.map((metal) => {
        const meta = METAL_META[metal];
        const obs = observationsForMetal(history, metal);
        const latest = obs.length > 0 ? obs[obs.length - 1] : null;
        const isActive = metal === selected;
        const color = METAL_COLORS[metal];

        return (
          <button
            key={metal}
            onClick={() => onChange(metal)}
            className={`
              flex flex-col items-start gap-0.5 px-3.5 py-2.5 rounded-xl border transition-all duration-120
              ${
                isActive
                  ? 'bg-ink-850 border-ink-600 shadow-elev-1'
                  : 'bg-ink-900 border-ink-700 hover:bg-ink-850 hover:border-ink-650'
              }
            `}
          >
            {/* Metal code + indicator */}
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className={`text-xs font-semibold ${isActive ? 'text-txt' : 'text-txt-muted'}`}>
                {metal}
              </span>
            </div>

            {/* Label */}
            <p className={`text-2xs ${isActive ? 'text-txt-muted' : 'text-txt-dim'}`}>
              {meta.label}
            </p>

            {/* Latest price */}
            {latest ? (
              <p className="text-xs font-medium tnum text-txt mt-0.5">
                ${latest.price.toFixed(2)}
              </p>
            ) : (
              <p className="text-2xs text-txt-dim mt-0.5">No data</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PriceSummaryCard({
  metal,
  latest,
  freshness,
  change,
  usdLkr,
  usdLkrSource,
  rangeCount,
  selectedRange,
}: {
  metal: MetalCode;
  latest: PriceObservation | null;
  freshness: FreshnessStatus;
  change: { abs: number; pct: number | null } | null;
  usdLkr: number | null;
  usdLkrSource: string | null;
  rangeCount: number;
  selectedRange: MarketWatchSettings['selectedRange'];
}) {
  const meta = METAL_META[metal];
  const color = METAL_COLORS[metal];
  const status = freshnessLabel(freshness);

  const freshnessConfig: Record<FreshnessStatus, { label: string; tone: 'positive' | 'warning' | 'negative' | 'neutral'; icon: typeof Wifi }> = {
    live: { label: 'Live', tone: 'positive', icon: Wifi },
    recent: { label: 'Recent', tone: 'accent' as any, icon: Wifi },
    stale: { label: 'Stale', tone: 'warning', icon: Clock },
    offline: { label: 'Offline', tone: 'negative', icon: WifiOff },
  };
  const fc = freshnessConfig[freshness];
  const FreshIcon = fc.icon;

  const formatted = latest ? formatObservationPrice(latest) : null;
  const lkrPerGram = latest ? usdPerOztToLkrPerGram(latest.price, usdLkr) : null;

  return (
    <Card elevated className="p-5">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Left: main price */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-sm font-semibold text-txt">{meta.label}</span>
            <span className="text-xs text-txt-dim">{metal}</span>
            <Badge tone={fc.tone as any}>
              <FreshIcon size={10} />
              {status}
            </Badge>
          </div>

          {latest ? (
            <>
              <p className="text-3xl font-semibold tnum text-txt leading-tight">
                ${latest.price.toFixed(2)}
              </p>
              <p className="text-xs text-txt-muted mt-0.5">
                USD per {meta.displayUnit} · {latest.quoteType} · {latest.exchangeLabel}
              </p>

              {/* Per-gram price */}
              {latest.pricePerGramUsd != null && (
                <p className="text-xs text-txt-dim mt-1 tnum">
                  ${latest.pricePerGramUsd.toFixed(4)} / gram (USD)
                </p>
              )}
            </>
          ) : (
            <p className="text-2xl text-txt-dim font-medium">—</p>
          )}

          {/* LKR conversion */}
          {lkrPerGram && usdLkr && (
            <div className="mt-3 p-2.5 rounded-lg bg-ink-850 border border-ink-700 inline-flex flex-col gap-0.5">
              <p className="text-2xs text-txt-dim">Indicative LKR conversion (not dealer price)</p>
              <p className="text-sm font-semibold tnum text-txt">
                LKR {lkrPerGram.toFixed(2)} / gram
              </p>
              <p className="text-2xs text-txt-dim">
                Rate: 1 USD = LKR {usdLkr.toFixed(2)} · Source: {usdLkrSource ?? 'Manual override'}
              </p>
            </div>
          )}
        </div>

        {/* Right: metadata + change */}
        <div className="sm:text-right space-y-3 shrink-0">
          {/* Change */}
          {change !== null ? (
            <div className="flex sm:flex-col sm:items-end items-center gap-2">
              <ChangeIndicator abs={change.abs} pct={change.pct} />
            </div>
          ) : (
            <p className="text-xs text-txt-dim">Change not available</p>
          )}

          {/* Timestamps */}
          {latest && (
            <div className="space-y-1 text-2xs text-txt-dim">
              <div className="flex sm:justify-end items-center gap-1">
                <Clock size={10} />
                <span>Provider: {formatDateTime(latest.providerTimestamp)}</span>
              </div>
              <div className="flex sm:justify-end items-center gap-1">
                <RefreshCw size={10} />
                <span>Retrieved: {relativeTime(latest.retrievedAt)}</span>
              </div>
              <p className="text-txt-dim">
                Provider: {providerLabel(latest.providerId)}
              </p>
              <p className="text-txt-dim">
                Chart: {rangeCount} point{rangeCount === 1 ? '' : 's'} ({RANGE_LABELS[selectedRange]})
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ChangeIndicator({ abs, pct }: { abs: number; pct: number | null }) {
  const isPositive = abs >= 0;
  const Icon = isPositive ? TrendingUp : abs < 0 ? TrendingDown : Minus;
  const color = isPositive ? 'text-positive' : 'text-negative';

  return (
    <div className={`flex items-center gap-1.5 ${color}`}>
      <Icon size={14} />
      <span className="text-sm font-semibold tnum">
        {isPositive ? '+' : ''}{abs.toFixed(2)}
      </span>
      {pct !== null && (
        <span className="text-xs opacity-80">
          ({isPositive ? '+' : ''}{pct.toFixed(2)}%)
        </span>
      )}
    </div>
  );
}

function RangeSelector({
  value,
  onChange,
}: {
  value: MarketWatchSettings['selectedRange'];
  onChange: (r: MarketWatchSettings['selectedRange']) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {(Object.keys(RANGE_LABELS) as MarketWatchSettings['selectedRange'][]).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`
            px-2 py-1 text-2xs font-medium rounded-md transition-all duration-80
            ${value === r
              ? 'bg-accent/20 text-accent border border-accent/30'
              : 'text-txt-dim hover:text-txt-muted hover:bg-ink-800'}
          `}
        >
          {RANGE_LABELS[r]}
        </button>
      ))}
    </div>
  );
}

function PriceChart({
  observations,
  metal,
  range,
}: {
  observations: PriceObservation[];
  metal: MetalCode;
  range: MarketWatchSettings['selectedRange'];
}) {
  const color = METAL_COLORS[metal];

  if (observations.length === 0) {
    return (
      <div className="h-[260px] flex flex-col items-center justify-center gap-3 text-center">
        <BarChart2 size={32} className="text-txt-dim opacity-40" />
        <div>
          <p className="text-sm font-medium text-txt-muted">No price history yet</p>
          <p className="text-xs text-txt-dim mt-1 max-w-xs">
            Refresh to fetch the first data points. History will accumulate over time based on your fetch schedule.
          </p>
        </div>
      </div>
    );
  }

  if (observations.length < 2) {
    return (
      <div className="space-y-3">
        <div className="h-[200px] flex flex-col items-center justify-center gap-2 text-center border border-dashed border-ink-700 rounded-xl">
          <p className="text-xs text-txt-muted">Only 1 data point available for {RANGE_LABELS[range]}</p>
          <p className="text-2xs text-txt-dim">More history will accumulate with each scheduled fetch.</p>
        </div>
        <SinglePointSummary obs={observations[0]} color={color} />
      </div>
    );
  }

  const chartData = observations.map((o) => ({
    time: o.retrievedAt,
    price: o.price,
    provider: o.providerId,
    fresh: o.providerFresh,
  }));

  const prices = chartData.map((d) => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const padding = (maxP - minP) * 0.08 || maxP * 0.02;

  const gradId = `priceGrad-${metal}`;

  const formatXTick = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    if (range === '24h') {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="h-[280px] w-full" role="img" aria-label={`${METAL_META[metal].label} price history chart`}>
      <ResponsiveContainer>
        <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.22} />
              <stop offset="95%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1a2232" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="time"
            tickFormatter={formatXTick}
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#232d40' }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minP - padding, maxP + padding]}
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          />
          <RechartsTooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            itemStyle={{ color: '#f2f5fa' }}
            labelFormatter={(iso: string) => {
              const d = new Date(iso);
              return Number.isNaN(d.getTime())
                ? iso
                : d.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
            }}
            formatter={(v: number, _: string, item: any) => [
              `$${v.toFixed(4)} USD / ${METAL_META[metal].displayUnit}`,
              `${item.payload?.fresh ? '✓' : '⚠'} ${providerLabel(String(item.payload?.provider ?? ''))}`,
            ]}
          />
          {/* Reference line at the most recent price for visual anchor */}
          <ReferenceLine
            y={chartData[chartData.length - 1]?.price}
            stroke={color}
            strokeDasharray="4 4"
            strokeOpacity={0.35}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={2.5}
            fillOpacity={1}
            fill={`url(#${gradId})`}
            isAnimationActive={true}
            animationDuration={600}
            dot={observations.length <= 10}
            activeDot={{ r: 4, strokeWidth: 0, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SinglePointSummary({ obs, color }: { obs: PriceObservation; color: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-ink-850 border border-ink-700 text-xs">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div>
        <p className="font-semibold text-txt tnum">${obs.price.toFixed(4)}</p>
        <p className="text-txt-dim">{formatDateTime(obs.retrievedAt)}</p>
      </div>
    </div>
  );
}

function FetchResultBanner({
  state,
  error,
  result,
}: {
  state: string;
  error: string | null;
  result: { added: number; fallback: boolean; providerLabel: string } | null;
}) {
  if (state === 'error' && error) {
    return (
      <Card className="p-3.5 flex items-center gap-3 border-negative/30 bg-negative-soft/20">
        <AlertTriangle size={15} className="text-negative shrink-0" />
        <p className="text-xs text-txt-muted">
          <span className="font-medium text-negative">Fetch failed: </span>
          {error}
        </p>
      </Card>
    );
  }

  if (state === 'success' && result) {
    return (
      <Card className="p-3.5 flex items-center gap-3 border-positive/25 bg-positive-soft/10">
        <Zap size={15} className="text-positive shrink-0" />
        <p className="text-xs text-txt-muted">
          <span className="font-medium text-txt">Fetch complete.</span>{' '}
          {result.added > 0 ? `+${result.added} new observation${result.added === 1 ? '' : 's'}` : 'No new data'}
          {result.fallback && (
            <span className="ml-1 text-txt-dim">(primary + fallback provider used)</span>
          )}
          {' '}· {result.providerLabel}
        </p>
      </Card>
    );
  }

  return null;
}

function MetalCoverageGrid({ history }: { history: PriceObservation[] }) {
  return (
    <Card>
      <CardHeader title="Instrument Coverage" subtitle="Latest observed price per instrument across all history" />
      <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {ALL_METALS.map((metal) => {
          const obs = observationsForMetal(history, metal);
          const latest = obs.length > 0 ? obs[obs.length - 1] : null;
          const freshness = freshnessStatus(latest);
          const color = METAL_COLORS[metal];
          const meta = METAL_META[metal];

          const supportedByAny = metal !== 'XCU'; // XCU not supported by either provider yet

          return (
            <div
              key={metal}
              className="rounded-lg border border-ink-700 bg-ink-850 p-3 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs font-semibold text-txt">{metal}</span>
                </div>
                {!supportedByAny ? (
                  <Badge tone="neutral">N/A</Badge>
                ) : latest ? (
                  <Badge
                    tone={freshness === 'live' || freshness === 'recent' ? 'positive' : freshness === 'stale' ? 'warning' : 'neutral'}
                  >
                    {freshnessLabel(freshness)}
                  </Badge>
                ) : (
                  <Badge tone="neutral">No data</Badge>
                )}
              </div>
              <p className="text-2xs text-txt-dim">{meta.label}</p>
              {latest ? (
                <>
                  <p className="text-sm font-semibold tnum text-txt">${latest.price.toFixed(2)}</p>
                  <p className="text-2xs text-txt-dim tnum">{relativeTime(latest.retrievedAt)}</p>
                </>
              ) : !supportedByAny ? (
                <p className="text-2xs text-txt-dim">Not supported by configured providers</p>
              ) : (
                <p className="text-2xs text-txt-dim">Awaiting first fetch</p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ScheduleCard({
  settings,
  credConfigured,
  onUpdate,
}: {
  settings: MarketWatchSettings;
  credConfigured: boolean;
  onUpdate: (patch: Partial<MarketWatchSettings>) => void;
}) {
  const metals: MetalCode[] = ['XAU', 'XAG', 'XPT', 'XPD'];
  const budget = estimateMonthlyRequests(settings.fetchesPerDay, metals);
  const desc = scheduleDescription(settings);

  return (
    <Card>
      <CardHeader
        title="Fetch Schedule & Request Budget"
        subtitle={`${desc} — estimated monthly API usage`}
        action={<Settings2 size={14} className="text-txt-dim mt-0.5" />}
      />
      <div className="px-5 pb-5 space-y-4">
        {/* Schedule toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-txt-muted">Auto-fetch:</span>
          <button
            onClick={() => onUpdate({ autoFetchEnabled: !settings.autoFetchEnabled })}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-all duration-120 ${
              settings.autoFetchEnabled
                ? 'bg-accent/15 text-accent border-accent/30'
                : 'bg-ink-800 text-txt-muted border-ink-700 hover:border-ink-650'
            }`}
          >
            {settings.autoFetchEnabled ? 'Enabled' : 'Disabled'}
          </button>

          {settings.autoFetchEnabled && (
            <>
              <span className="text-xs text-txt-dim">Frequency:</span>
              {[1, 2, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => onUpdate({ fetchesPerDay: n })}
                  className={`text-xs px-2 py-1 rounded-md border transition-all duration-80 ${
                    settings.fetchesPerDay === n
                      ? 'bg-accent/15 text-accent border-accent/30'
                      : 'bg-ink-800 text-txt-dim border-ink-700 hover:text-txt-muted hover:border-ink-650'
                  }`}
                >
                  {n}×/day
                </button>
              ))}
            </>
          )}
        </div>

        {/* Request budget breakdown */}
        <div className="grid sm:grid-cols-3 gap-3">
          <BudgetStat
            label="GoldAPI.io requests/month"
            value={budget.goldapiRequests}
            note="XAU, XAG, XPT, XPD — 1 req/metal/run"
          />
          <BudgetStat
            label="gold-api.com requests/month"
            value={budget.goldapicomRequests}
            note="Keyless fallback: copper (HG) and any metal GoldAPI.io does not supply"
          />
          <BudgetStat
            label="Total requests/month"
            value={budget.totalRequests}
            note={`At ${settings.fetchesPerDay}× per day, 30 days`}
            highlight
          />
        </div>

        {settings.lastFetchAt && (
          <p className="text-2xs text-txt-dim flex items-center gap-1.5">
            <Clock size={10} />
            Last successful fetch: {formatDateTime(settings.lastFetchAt)} ({relativeTime(settings.lastFetchAt)})
          </p>
        )}

        {!credConfigured && (
          <p className="text-2xs text-warning flex items-center gap-1">
            <AlertTriangle size={10} />
            Auto-fetch is inactive until API credentials are configured.
          </p>
        )}
      </div>
    </Card>
  );
}

function BudgetStat({
  label,
  value,
  note,
  highlight = false,
}: {
  label: string;
  value: number;
  note: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-accent/20 bg-accent-soft/30' : 'border-ink-700 bg-ink-850'}`}>
      <p className="text-2xs text-txt-dim mb-1">{label}</p>
      <p className={`text-lg font-semibold tnum ${highlight ? 'text-accent' : 'text-txt'}`}>{value}</p>
      <p className="text-2xs text-txt-dim mt-0.5 leading-relaxed">{note}</p>
    </div>
  );
}

function Disclaimer({ usdLkrSource }: { usdLkrSource?: string | null }) {
  return (
    <Card className="p-4 flex gap-3 bg-ink-900/60">
      <Info size={15} className="text-txt-dim shrink-0 mt-0.5" />
      <div className="text-2xs text-txt-dim space-y-1 leading-relaxed">
        <p className="font-medium text-txt-muted">Important — read before using these prices</p>
        <p>
          Prices displayed are international wholesale spot/futures quotes in USD, typically from FOREXCOM or exchange
          aggregators. They are <strong>not</strong> Sri Lankan dealer buy or sell prices. Actual local dealer prices
          vary significantly based on import duties, dealer margins, supply, and form factor (coins vs bars vs jewelry).
        </p>
        {usdLkrSource && (
          <p>
            LKR conversions use the exchange rate from <em>{usdLkrSource}</em> and are shown for
            reference only. This is a USD spot rate, not the rate a money changer or bank will quote you.
          </p>
        )}
        <p>
          Vaultfolio's asset valuations are user-entered and are <strong>never</strong> automatically overwritten
          by market watch prices. Manual override prices in Settings &gt; Market &amp; Valuations remain independent.
        </p>
      </div>
    </Card>
  );
}
