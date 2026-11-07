import { useCallback, useEffect, useEffect as useReactEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  PieChart as PieIcon,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { loadPriceHistory, type PriceObservation } from '../lib/marketWatch';
import {
  generateInsights,
  loadLastInsights,
  saveLastInsights,
  clearLastInsights,
  getSelectedModel,
  DEFAULT_GEMINI_MODEL,
  type InsightsDoc,
  type ReportPeriod,
  type MetalInsight,
  type AiInsightCard,
  type AiInsightCategory,
  deterministicFallbackCards,
} from '../lib/insights';
import { buildPortfolioSnapshot } from '../lib/insightsContext';
import { buildEvidencePack } from '../lib/insightsEvidence';
import { geminiErrorExplanation, type GeminiError } from '../lib/gemini';
import { METAL_META } from '../lib/marketWatch';
import { Badge, Button, Card, CardHeader, EmptyState } from '../components/ui';

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const TREND_ICON = {
  bullish: TrendingUp,
  bearish: TrendingDown,
  neutral: Minus,
  uncertain: AlertTriangle,
} as const;

const TREND_COLOR = {
  bullish: 'text-emerald-400',
  bearish: 'text-rose-400',
  neutral: 'text-txt-muted',
  uncertain: 'text-amber-400',
} as const;

export function AiInsights() {
  const { assets, records, market, loadGeminiKey, hasGeminiKeyStored, pushToast } = useData();
  const [doc, setDoc] = useState<InsightsDoc | null>(null);
  const [period, setPeriod] = useState<ReportPeriod>('7d');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<GeminiError | null>(null);
  const keyConfigured = hasGeminiKeyStored();

  useEffect(() => {
    setDoc(loadLastInsights());
  }, []);

  const history = useMemo<PriceObservation[]>(() => loadPriceHistory(), []);

  /* Deterministic evidence pack — drives fallback cards when AI is unavailable. */
  const pack = useMemo(
    () => buildEvidencePack({ assets, records, market, history, period }),
    [assets, records, market, history, period],
  );
  const fallbackCards = useMemo(() => deterministicFallbackCards(pack), [pack]);

  const generate = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const apiKey = await loadGeminiKey();
      if (!apiKey) {
        pushToast({ kind: 'error', title: 'No Gemini key', body: 'Configure it in Settings → Gemini AI.' });
        return;
      }
      const portfolio = buildPortfolioSnapshot(assets, market);
      const previousTitles = loadLastInsights()?.cards.map((c) => c.headline).slice(-6) ?? [];
      const { doc: next } = await generateInsights({
        history,
        period,
        portfolio,
        assets,
        records,
        market,
        previousTitles,
        apiKey,
        model: getSelectedModel(),
      });
      saveLastInsights(next);
      setDoc(next);
      pushToast({ kind: 'success', title: 'AI Insights generated', body: `${next.cards.length} insight cards.` });
    } catch (e) {
      const candidate = e as Partial<GeminiError> & Error;
      setErr(
        candidate.kind
          ? (candidate as GeminiError)
          : ({ name: 'Error', kind: 'network', message: candidate.message ?? 'Unexpected error', retryAfterMs: null } as unknown as GeminiError),
      );
    } finally {
      setBusy(false);
    }
  }, [assets, history, loadGeminiKey, market, period, pushToast, records]);

  const clearCache = () => {
    clearLastInsights();
    setDoc(null);
    setErr(null);
  };

  if (!keyConfigured) {
    return (
      <div className="max-w-xl mx-auto pt-10 animate-fadeUp">
        <Card elevated>
          <EmptyState
            icon={<KeyRound size={24} className="text-accent" />}
            title="AI Insights needs your Gemini API key"
            body="Insights use your own key, stored encrypted on this device. Open Settings → Gemini AI to paste and save the key. A free key is available at aistudio.google.com."
          />
          <div className="flex justify-center pb-5 -mt-2">
            <Button variant="primary"><KeyRound size={14} /> Open Settings → Gemini AI</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeUp">
      <header className="pb-2 border-b border-ink-800/80 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-txt flex items-center gap-2">
            <Sparkles size={20} className="text-accent" /> AI Insights
          </h1>
          <p className="text-xs text-txt-muted mt-0.5">
            Structured analysis grounded in your portfolio records and Market Watch observations — every number in a card comes from on-device computation, never the model.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Analysis window"
            className="bg-ink-900 border border-ink-700 rounded-xl text-xs px-3 py-2 text-txt focus:outline-none focus:border-accent"
            value={period}
            onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
          >
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || (history.length === 0 && assets.length === 0)}
            onClick={() => void generate()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {doc ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
      </header>

      {/* Error state — honest per kind, with deterministic fallback beneath */}
      {err && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold text-rose-300">Could not generate insights ({err.kind})</p>
              <p className="text-txt-muted mt-1">{err.message}</p>
              <p className="text-2xs text-txt-dim mt-1">{geminiErrorExplanation(err.kind)}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Loading skeletons */}
      {busy && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="px-5 pb-5 pt-4 space-y-2.5">
                <div className="h-2.5 w-40 rounded bg-ink-800" />
                <div className="h-2 w-full rounded bg-ink-800/80" />
                <div className="h-2 w-5/6 rounded bg-ink-800/70" />
                <div className="h-2 w-2/3 rounded bg-ink-800/60" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {!busy && !doc && err && (
        <div className="space-y-4">
          <p className="text-2xs text-txt-dim">Showing the deterministic on-device analysis instead of a failed AI generation — no stale AI text is presented as fresh:</p>
          <div className="grid gap-4 xl:grid-cols-2">
            {fallbackCards.map((c) => <InsightCard key={c.id} c={c} generatedAt={pack.asOf} />)}
          </div>
        </div>
      )}

      {!busy && doc && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Market overview"
              subtitle={`Model: ${doc.model} · window: ${doc.period}`}
              action={<Badge tone="neutral">Generated {new Date(doc.generatedAt).toLocaleString()}</Badge>}
            />
            <div className="px-5 pb-5">
              <p className="text-xs leading-relaxed text-txt whitespace-pre-line">{doc.marketSummary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {doc.metals.map((m) => <MetalPill key={m.symbol} m={m} />)}
              </div>
            </div>
          </Card>

          {/* Structured insight cards */}
          <div className="grid gap-4 xl:grid-cols-2">
            {doc.cards.map((c) => <InsightCard key={c.id} c={c} generatedAt={doc.generatedAt} />)}
          </div>

          <Card>
            <CardHeader title="Limitations &amp; data basis" subtitle="What this analysis was built from — and what it is not" />
            <div className="px-5 pb-5 space-y-1.5">
              {doc.limitations.map((l, i) => (
                <p key={i} className="text-2xs text-txt-muted leading-relaxed">• {l}</p>
              ))}
              <div className="mt-3 pt-3 border-t border-ink-800 grid grid-cols-2 sm:grid-cols-3 gap-2 text-2xs text-txt-dim">
                <span>Observations: {Object.values(doc.dataBasis.observationCounts).reduce((a, b) => a + b, 0)}</span>
                <span>Providers: {doc.dataBasis.providers.join(', ') || 'none'}</span>
                <span>FX: {doc.dataBasis.fxRateLkrPerUsd ? `1 USD = ${doc.dataBasis.fxRateLkrPerUsd} LKR` : 'unavailable'}</span>
                <span>FX as of: {doc.dataBasis.fxAsOf ? new Date(doc.dataBasis.fxAsOf).toLocaleString() : '—'}</span>
                <span>Active assets: {doc.dataBasis.portfolioActiveAssets}</span>
                <span>Evidence pack: {fmtDate(pack.asOf)}</span>
              </div>
            </div>
          </Card>

          <Card className="border-amber-500/20 bg-amber-500/5">
            <div className="flex items-start gap-3 p-4">
              <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-2xs text-amber-300/90 leading-relaxed">{doc.disclaimer}</p>
            </div>
          </Card>

          <button onClick={clearCache} className="text-2xs text-txt-dim hover:text-txt-muted underline-offset-2 hover:underline mx-auto block">
            Clear locally cached insights document
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────── Insight card rendering ─────────────── */

const CATEGORY_META: Record<AiInsightCategory, { label: string; icon: React.ReactNode; iconClass: string }> = {
  portfolio_overview: { label: 'Portfolio Overview', icon: <LayoutDashboard size={13} />, iconClass: 'text-accent' },
  opportunities: { label: 'Opportunities', icon: <TrendingUp size={13} />, iconClass: 'text-emerald-400' },
  risks: { label: 'Risks', icon: <AlertTriangle size={13} />, iconClass: 'text-rose-400' },
  asset_performance: { label: 'Asset Performance', icon: <Award size={13} />, iconClass: 'text-accent' },
  market_impact: { label: 'Market Impact', icon: <Activity size={13} />, iconClass: 'text-amber-400' },
  concentration: { label: 'Concentration', icon: <PieIcon size={13} />, iconClass: 'text-accent' },
  valuation_warnings: { label: 'Valuation Warnings', icon: <Clock size={13} />, iconClass: 'text-amber-400' },
  recommendations: { label: 'Recommendations', icon: <Lightbulb size={13} />, iconClass: 'text-emerald-400' },
};

function InsightCard({ c, generatedAt }: { c: AiInsightCard; generatedAt: string }) {
  const meta = CATEGORY_META[c.category];
  const indicatorColor = c.indicator === 'positive' ? 'text-emerald-400' : c.indicator === 'negative' ? 'text-rose-400' : 'text-txt-muted';
  const border = c.indicator === 'positive' ? 'border-l-emerald-500/70' : c.indicator === 'negative' ? 'border-l-rose-500/70' : 'border-l-ink-700';

  return (
    <Card className={`border-l-2 ${border}`}>
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={`inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider ${meta.iconClass}`}>
            {meta.icon} {meta.label}
          </span>
          <div className="flex items-center gap-1.5">
            <Badge tone={c.confidence === 'high' ? 'positive' : c.confidence === 'medium' ? 'accent' : 'neutral'}>
              {c.confidence} confidence
            </Badge>
            {c.indicator === 'positive' ? <ArrowUpRight size={15} className="text-emerald-400" /> :
              c.indicator === 'negative' ? <ArrowDownRight size={15} className="text-rose-400" /> :
              <Minus size={15} className="text-txt-dim" />}
          </div>
        </div>

        <h3 className={`text-sm font-semibold text-txt leading-snug ${indicatorColor === 'text-txt-muted' ? 'text-txt' : indicatorColor}`}>
          {c.headline}
        </h3>
        <p className="text-xs text-txt-muted mt-1.5 leading-relaxed">{c.explanation}</p>

        {/* Evidence — numbers computed locally, attached at assembly; never model-typed */}
        {c.evidence.length > 0 && (
          <div className="mt-3 space-y-2.5">
            {c.evidence.map((ev) => (
              <div key={ev.id} className="rounded-lg border border-ink-800 bg-ink-900/60 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-txt-dim mb-1.5">Evidence · {ev.title}</p>
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                  {ev.numbers.map((n) => (
                    <div key={n.label} className="flex items-baseline justify-between gap-2 text-2xs">
                      <span className="text-txt-muted truncate">{n.label}</span>
                      <span className={`tnum font-medium ${ev.direction === 'up' ? 'text-emerald-400' : ev.direction === 'down' ? 'text-rose-400' : 'text-txt'}`}>
                        {n.value}
                      </span>
                    </div>
                  ))}
                </div>
                {ev.series && <Sparkline points={ev.series.points} label={ev.series.label} unitLabel={ev.series.unitLabel} />}
                {ev.coverage && <p className="text-2xs text-txt-dim mt-1.5 leading-relaxed">{ev.coverage}</p>}
              </div>
            ))}
          </div>
        )}

        <p className="text-2xs text-txt-dim/70 mt-2.5">Generated {fmtDate(generatedAt)} · {c.id}</p>
      </div>
    </Card>
  );
}

function Sparkline({ points, label, unitLabel }: { points: Array<{ x: number; y: number }>; label: string; unitLabel: string }) {
  const w = 260;
  const h = 52;
  const pts = useMemo(() => {
    if (points.length < 2) return '';
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const sx = (x: number) => ((x - x0) / Math.max(1, x1 - x0)) * (w - 8) + 4;
    const sy = (y: number) => h - 6 - ((y - y0) / Math.max(1, y1 - y0)) * (h - 12);
    return points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  }, [points]);
  if (!pts) return null;
  const first = points[0].y;
  const last = points[points.length - 1].y;
  const stroke = last >= first ? '#34d399' : '#fb7185';
  return (
    <div className="mt-2.5">
      <p className="text-2xs text-txt-dim mb-1">{label} · {unitLabel}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} role="img" aria-label={`${label} trend`}>
        <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className="text-2xs text-txt-dim/70">
        {points.length} point{points.length === 1 ? '' : 's'} from real stored recording{points.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function MetalPill({ m }: { m: MetalInsight }) {
  const I = TREND_ICON[m.direction];
  const meta = (METAL_META as Record<string, { label?: string }>)[m.symbol];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 text-2xs text-txt-muted">
      <span className="w-1.5 h-1.5 rounded-full bg-accent/70" />
      <span className="font-medium text-txt">{m.symbol}</span>
      {meta?.label && <span className="text-txt-dim">({meta.label})</span>}
      <I size={11} className={TREND_COLOR[m.direction]} />
    </span>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const DEFAULT_AI_MODEL = DEFAULT_GEMINI_MODEL;
