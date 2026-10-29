import { useCallback, useEffect, useEffect as useReactEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  KeyRound,
  Loader2,
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
} from '../lib/insights';
import { buildPortfolioSnapshot } from '../lib/insightsContext';
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
  const { assets, market, loadGeminiKey, hasGeminiKeyStored, pushToast } = useData();
  const [doc, setDoc] = useState<InsightsDoc | null>(null);
  const [period, setPeriod] = useState<ReportPeriod>('7d');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<GeminiError | null>(null);
  const keyConfigured = hasGeminiKeyStored();

  useEffect(() => {
    setDoc(loadLastInsights());
  }, []);

  const history = useMemo<PriceObservation[]>(() => loadPriceHistory(), []);
  const hasObservations = history.length > 0;

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
      const { doc: next } = await generateInsights({ history, period, portfolio, apiKey, model: getSelectedModel() });
      saveLastInsights(next);
      setDoc(next);
      pushToast({ kind: 'success', title: 'AI Insights generated' });
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
  }, [assets, history, loadGeminiKey, market, period, pushToast]);

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
            Gemini analysis grounded in Market Watch observations and your portfolio aggregates. Reports remains a separate feature.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Analysis window"
            className="bg-ink-900 border border-ink-700 rounded-lg text-xs px-2 py-2 text-txt"
            value={period}
            onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
          >
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <Button variant="primary" size="sm" disabled={busy || !hasObservations} onClick={() => void generate()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {doc ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
      </header>

      {!hasObservations && (
        <Card>
          <EmptyState
            icon={<BarChart3 size={22} className="text-txt-dim" />}
            title="No market observations stored yet"
            body="Insights analyse real price observations collected by Market Watch on this device. Open Market Watch, fetch current prices, and generation will unlock."
          />
        </Card>
      )}

      {/* Error state — honest per kind */}
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

      {busy && (
        <Card>
          <div className="flex items-center justify-center gap-3 py-10">
            <Loader2 size={18} className="animate-spin text-accent" />
            <p className="text-xs text-txt-muted">Analysing the last {period} window with Gemini…</p>
          </div>
        </Card>
      )}

      {!busy && doc && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Market overview"
              subtitle={`Model: ${doc.model} · window: ${doc.period}`}
              action={<Badge tone="neutral">{new Date(doc.generatedAt).toLocaleString()}</Badge>}
            />
            <div className="px-5 pb-5">
              <p className="text-xs leading-relaxed text-txt whitespace-pre-line">{doc.marketSummary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {doc.metals.map((m) => <MetalPill key={m.symbol} m={m} />)}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Metals" subtitle="Direction wording reflects Gemini's interpretation of the supplied observations" />
            <div className="px-5 pb-5 space-y-2.5">
              {doc.metals.map((m) => (
                <div key={m.symbol} className="rounded-xl border border-ink-800 bg-ink-900/60 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-txt">
                      {(METAL_META as Record<string, { label?: string; emoji?: string }>)[m.symbol]?.label ?? m.symbol}
                      <span className="text-txt-dim font-mono text-2xs ml-2">{m.symbol}</span>
                    </span>
                    <Badge tone={m.confidence === 'high' ? 'positive' : m.confidence === 'low' ? 'neutral' : 'accent'}>
                      {m.confidence} confidence
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    {(() => { const I = TREND_ICON[m.direction]; return <I size={14} className={`shrink-0 ${TREND_COLOR[m.direction]}`} />; })()}
                    <span className="text-xs text-txt">{m.headline}</span>
                  </div>
                  <p className="text-2xs text-txt-muted mt-1.5 leading-relaxed">{m.comment}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Your portfolio" subtitle="Computed locally by the valuation engine; commentary by Gemini" />
            <div className="px-5 pb-5 space-y-3">
              <InsightLine title="Portfolio summary">{doc.portfolio.summary}</InsightLine>
              <InsightLine title="Allocation">{doc.portfolio.allocationComment}</InsightLine>
              <InsightLine title="Concentration">{doc.portfolio.concentrationNote}</InsightLine>
            </div>
          </Card>

          <div className="grid lg:grid-cols-3 gap-4">
            <ListCard title="Risks" icon={<AlertTriangle size={13} className="text-amber-400" />} items={doc.risks} />
            <ListCard title="Opportunities" icon={<CheckCircle2 size={13} className="text-emerald-400" />} items={doc.opportunities} />
            <ListCard title="Tips" icon={<Sparkles size={13} className="text-accent" />} items={doc.tips} />
          </div>

          <Card>
            <CardHeader title="Limitations & data basis" subtitle="What this analysis was built from — and what it is not" />
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
                <span>Valued: {doc.dataBasis.valuedAssets}</span>
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

function MetalPill({ m }: { m: MetalInsight }) {
  const I = TREND_ICON[m.direction];
  const meta = (METAL_META as Record<string, { label?: string; emoji?: string }>)[m.symbol];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900 px-2.5 py-1 text-2xs text-txt-muted">
      {meta?.emoji} {m.symbol}
      <I size={11} className={TREND_COLOR[m.direction]} />
    </span>
  );
}

function InsightLine({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wider text-txt-dim mb-0.5">{title}</p>
      <p className="text-xs text-txt leading-relaxed">{children}</p>
    </div>
  );
}

function ListCard({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="px-5 pb-5 space-y-1.5">
        {items.length === 0 ? (
          <p className="text-2xs text-txt-dim">None provided.</p>
        ) : (
          items.map((it, i) => (
            <div key={i} className="flex items-start gap-2 text-2xs text-txt-muted leading-relaxed">
              <span className="mt-1 shrink-0">{icon}</span>
              <span>{it}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export const DEFAULT_AI_MODEL = DEFAULT_GEMINI_MODEL;
