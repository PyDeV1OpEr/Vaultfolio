import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Download,
  FileText,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { Button, Card, Badge, EmptyState, Modal, SkeletonCard } from '../components/ui';
import { formatDateTime, relativeTime } from '../lib/money';
import { loadPriceHistory } from '../lib/marketWatch';
import {
  generateReport,
  listReports,
  addReport,
  deleteReport,
  type StoredReport,
} from '../lib/reports';
import {
  geminiErrorExplanation,
  sanitizeModelText,
  type GeminiError,
  type ReportPeriod,
} from '../lib/gemini';

const PERIODS: ReportPeriod[] = ['24h', '7d', '30d', '90d'];

const PERIOD_LABEL: Record<ReportPeriod, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

type ReportMetal = StoredReport['metals'][number];

function trendBadge(trend: ReportMetal['trend']) {
  switch (trend) {
    case 'bullish': return { tone: 'positive' as const, icon: <TrendingUp size={11} /> };
    case 'bearish': return { tone: 'negative' as const, icon: <TrendingDown size={11} /> };
    case 'neutral': return { tone: 'accent' as const, icon: <Minus size={11} /> };
    case 'uncertain': return { tone: 'warning' as const, icon: <AlertTriangle size={11} /> };
    default: return null;
  }
}

function recommendationTone(rec: ReportMetal['recommendation']) {
  switch (rec) {
    case 'hold': return 'accent' as const;
    case 'monitor': return 'warning' as const;
    default: return 'neutral' as const;
  }
}

function fmtUsd(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v) || v <= 0) return '—';
  const digits = v < 10 ? 4 : 2;
  const suffix = unit === 'pound' ? ' /lb' : ' /t oz';
  return `USD ${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

const METAL_NAMES: Record<ReportMetal['symbol'], string> = {
  XAU: 'Gold', XAG: 'Silver', XPT: 'Platinum', XPD: 'Palladium', XCU: 'Copper',
};

function formatRetry(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

function coveredSymbols(r: StoredReport | null): string {
  if (!r) return '';
  return r.metals.filter((m) => m.hasData).map((m) => m.symbol).join(', ');
}

export function ReportsScreen() {
  const { loadGeminiKey, hasGeminiKeyStored, pushToast } = useData();

  const [historyList, setHistoryList] = useState<StoredReport[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [period, setPeriod] = useState<ReportPeriod>('24h');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<GeminiError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StoredReport | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);

  const keyConfigured = hasGeminiKeyStored();

  const refreshList = useCallback(() => {
    setHistoryList(listReports());
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const active = useMemo(
    () => historyList.find((r) => r.reportId === activeId) ?? historyList[0] ?? null,
    [historyList, activeId],
  );

  const generate = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setKeyMissing(false);
    try {
      const history = loadPriceHistory();
      const apiKey = await loadGeminiKey();
      if (!apiKey) {
        setKeyMissing(true);
        return;
      }
      const { report, metalsWithInsufficientData } = await generateReport(history, period, apiKey);
      addReport(report);
      refreshList();
      setActiveId(report.reportId);
      if (metalsWithInsufficientData > 0) {
        pushToast({
          kind: 'info',
          title: 'Report ready — with gaps',
          body: `${metalsWithInsufficientData} metal${metalsWithInsufficientData === 1 ? '' : 's'} had insufficient ${period} data and are marked incomplete.`,
        });
      } else {
        pushToast({ kind: 'success', title: 'Report ready', body: `AI analysis for the last ${PERIOD_LABEL[period]} was saved locally.` });
      }
    } catch (e) {
      const candidate = e as Partial<GeminiError> & Error;
      if (typeof candidate.kind === 'string') {
        setErr(candidate as GeminiError);
      } else {
        setErr({ name: 'Error', kind: 'network', message: candidate.message ?? 'Unexpected error', retryAfterMs: null } as GeminiError);
      }
    } finally {
      setBusy(false);
    }
  }, [loadGeminiKey, period, pushToast, refreshList]);

  const exportJson = useCallback((r: StoredReport) => {
    try {
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vaultfolio-report-${r.period}-${r.createdAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      pushToast({ kind: 'error', title: 'Export failed', body: 'Could not create the JSON export file.' });
    }
  }, [pushToast]);

  if (keyMissing || (!keyConfigured && historyList.length === 0)) {
    return (
      <div className="max-w-2xl mx-auto pt-6 space-y-6 animate-fadeUp">
        <ReportHeader busy={false} />
        <Card elevated>
          <EmptyState
            icon={<KeyRound size={24} className="text-warning" />}
            title="Configure your Gemini API key"
            body="Reports use your own Gemini API key — it is stored encrypted (envelope encryption, your vault DEK or passphrase) and never leaves this device. Create a free key at aistudio.google.com, then configure it in Settings."
            action={
              <Link to="/settings">
                <Button variant="primary"><KeyRound size={14} /> Open Settings → Gemini AI</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeUp">
      <ReportHeader busy={busy} />

      {/* Period selector + generate */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Report period">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={`px-3.5 h-8 rounded-lg text-xs font-medium transition-all duration-120 border ${
                  period === p
                    ? 'bg-accent text-white border-accent shadow-btn-primary'
                    : 'bg-ink-800/60 text-txt-muted hover:text-txt border-ink-700 hover:bg-ink-750'
                }`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!keyConfigured}
            onClick={() => void generate()}
          >
            <Sparkles size={14} /> {busy ? 'Analysing…' : 'Generate report'}
          </Button>
        </div>
        <p className="text-2xs text-txt-dim mt-3 flex items-center gap-1.5">
          <ShieldCheck size={11} className="text-emerald-400 shrink-0" />
          <span>
            Analysis is grounded only in provider prices stored on this device
            {active ? ` (covered: ${coveredSymbols(active) || 'none yet'})` : ''}.
            Longer windows become meaningful as Market Watch history accrues — gaps are labelled, never filled.
          </span>
        </p>
      </Card>

      {/* Error */}
      {err && (
        <Card className="p-4 border-negative/30 bg-negative-soft/40">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-negative mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-negative leading-tight">Report not generated</p>
              <p className="text-xs text-txt-muted mt-1 leading-relaxed break-words">
                {geminiErrorExplanation(err.kind)}
                {err.message && <span className="block text-2xs text-txt-dim mt-1">{sanitizeModelText(err.message)}</span>}
              </p>
              {err.retryAfterMs !== null && (
                <p className="text-2xs text-warning mt-1.5">Google suggests retrying in about {formatRetry(err.retryAfterMs)}.</p>
              )}
            </div>
            <Button size="xs" variant="ghost" onClick={() => void generate()}><RefreshCw size={12} /> Retry</Button>
          </div>
        </Card>
      )}

      {busy && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      )}

      {/* History list */}
      {historyList.length > 0 && (
        <section aria-label="Report history">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2.5 px-1">
            Saved reports ({historyList.length})
          </h2>
          <div className="space-y-2">
            {historyList.map((r) => (
              <Card key={r.reportId} className={r.reportId === (active?.reportId ?? '') ? 'border-accent/40' : ''}>
                <div className="flex flex-wrap items-center gap-2.5 py-2">
                  <Badge tone="neutral">{r.period}</Badge>
                  <span className="text-xs text-txt font-medium">{formatDateTime(r.createdAt)}</span>
                  <span className="text-2xs text-txt-dim">data as of {r.dataAsOf ? formatDateTime(r.dataAsOf) : '—'}</span>
                  {r.metals.some((m) => m.incomplete) && <Badge tone="warning">partial data</Badge>}
                  <div className="flex-1" />
                  <Button size="xs" variant="ghost" onClick={() => { setActiveId(r.reportId); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>View</Button>
                  <Button size="xs" variant="ghost" aria-label={`Export report from ${r.createdAt}`} onClick={() => exportJson(r)}><Download size={12} /> Export</Button>
                  <Button size="xs" variant="danger" aria-label={`Delete report from ${r.createdAt}`} onClick={() => setConfirmDelete(r)}><Trash2 size={12} /></Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {!busy && historyList.length === 0 && (
        <Card elevated>
          <EmptyState
            icon={<FileText size={24} className="text-accent" />}
            title="No reports yet"
            body={`Generate a report for the last ${PERIOD_LABEL[period]} to see Gemini's structured analysis of each metal, grounded in the observations Market Watch has stored locally.`}
          />
        </Card>
      )}

      {/* Active report */}
      {active && <FullReport r={active} onExport={() => exportJson(active)} />}

      {/* Delete confirm */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this report?"
      >
        {confirmDelete && (
          <>
            <p className="text-xs text-txt-muted">
              Report from <span className="text-txt font-medium">{formatDateTime(confirmDelete.createdAt)}</span> ({confirmDelete.period}) will be permanently removed from this device.
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  deleteReport(confirmDelete.reportId);
                  setConfirmDelete(null);
                  refreshList();
                  pushToast({ kind: 'success', title: 'Report deleted' });
                }}
              >
                Delete
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function ReportHeader({ busy }: { busy: boolean }) {
  return (
    <header className="pb-2 border-b border-ink-800/80">
      <div className="flex items-center gap-2">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-txt">AI Market Reports</h1>
        {busy && <Loader2 size={16} className="animate-spin text-accent" />}
      </div>
      <p className="text-xs text-txt-muted mt-0.5">
        Structured Gemini analysis grounded in your locally stored provider data. Informational only — not financial advice.
      </p>
    </header>
  );
}

function EvidenceList({ label, items, icon }: { label: string; items: string[]; icon: ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-txt-dim mb-1 flex items-center gap-1">{icon} {label}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-2xs text-txt-muted leading-relaxed">• {sanitizeModelText(it)}</li>
        ))}
      </ul>
    </div>
  );
}

function FullReport({ r, onExport }: { r: StoredReport; onExport: () => void }) {
  return (
    <div className="space-y-4">
      {/* Timestamp strip: generation time vs provider data time are deliberately distinct */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-2xs uppercase tracking-wider text-txt-dim">Generated {relativeTime(r.createdAt)}</p>
            <p className="text-xs text-txt font-medium">{formatDateTime(r.createdAt)}</p>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wider text-txt-dim">Provider data as of</p>
            <p className="text-xs text-txt font-medium">{r.dataAsOf ? formatDateTime(r.dataAsOf) : '—'}</p>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wider text-txt-dim">Window</p>
            <p className="text-xs text-txt font-medium">{PERIOD_LABEL[r.period]}</p>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wider text-txt-dim">Sources</p>
            <p className="text-xs text-txt font-medium">{r.sources.map((s) => s.name).join(', ') || '—'}</p>
          </div>
          <div className="flex-1" />
          <Button size="xs" variant="secondary" onClick={onExport}><Download size={12} /> Export JSON</Button>
        </div>
      </Card>

      {/* Market summary */}
      <Card elevated className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-txt flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-accent" /> Market summary
        </h2>
        <p className="text-sm text-txt-muted leading-relaxed whitespace-pre-line">{sanitizeModelText(r.marketSummary)}</p>
      </Card>

      {/* Metal cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {r.metals.map((m) => {
          const tb = trendBadge(m.trend);
          return (
            <Card key={m.symbol} className="p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-txt">{METAL_NAMES[m.symbol] ?? m.metal}</span>
                <Badge tone="neutral">{m.symbol}</Badge>
                {tb && <Badge tone={tb.tone}>{tb.icon} {m.trend}</Badge>}
                {m.confidence && <Badge tone="neutral">conf: {m.confidence}</Badge>}
                {m.incomplete && <Badge tone="warning">incomplete</Badge>}
              </div>
              <p className="text-base font-semibold text-txt tnum">{fmtUsd(m.latestPrice, m.unit)}</p>
              <p className="text-2xs text-txt-dim mt-0.5">
                {m.periodChange
                  ? `${m.periodChange.abs >= 0 ? '+' : ''}${m.periodChange.abs.toFixed(2)} USD (${m.periodChange.pct !== null ? `${m.periodChange.pct >= 0 ? '+' : ''}${m.periodChange.pct.toFixed(2)}%` : 'n/a'}) across ${PERIOD_LABEL[r.period]} — computed from stored observations`
                  : 'No trend computable for this window from stored data'}
              </p>
              {m.coverageNote && (
                <p className="text-2xs text-warning mt-1.5 leading-relaxed">{sanitizeModelText(m.coverageNote)}</p>
              )}
              {m.trend !== 'no-analysis' ? (
                <div className="mt-3 space-y-3">
                  {m.outlook && <p className="text-xs text-txt-muted leading-relaxed">{sanitizeModelText(m.outlook)}</p>}
                  <EvidenceList label="Evidence (from supplied data)" items={m.supportingEvidence} icon={<ShieldCheck size={11} className="text-emerald-400" />} />
                  <EvidenceList label="Risks" items={m.risks} icon={<AlertTriangle size={11} className="text-warning" />} />
                  {m.reasoningSummary && (
                    <p className="text-2xs text-txt-dim leading-relaxed border-t border-ink-800 pt-2">{sanitizeModelText(m.reasoningSummary)}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge tone={recommendationTone(m.recommendation)}>
                      {m.recommendation === 'no-analysis' ? 'no analysis' : m.recommendation.replace(/_/g, ' ')}
                    </Badge>
                    <Badge tone={m.dataQuality === 'verified' ? 'positive' : m.dataQuality === 'stale' ? 'warning' : 'neutral'}>
                      data: {m.dataQuality ?? 'unknown'}
                    </Badge>
                  </div>
                </div>
              ) : (
                <p className="text-2xs text-txt-dim mt-3">
                  Gemini did not analyse this metal for this report. Prices shown are still the app's verified snapshot.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {/* Limitations & disclaimer */}
      <Card className="p-4">
        <h3 className="text-xs font-semibold text-txt mb-2 flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-warning" /> Limitations
        </h3>
        <ul className="text-2xs text-txt-muted list-disc pl-4 space-y-1 leading-relaxed">
          {r.limitations.map((l, i) => <li key={i}>{sanitizeModelText(l)}</li>)}
        </ul>
        <p className="text-2xs text-txt-dim mt-3 italic leading-relaxed">{r.disclaimer}</p>
      </Card>
    </div>
  );
}
