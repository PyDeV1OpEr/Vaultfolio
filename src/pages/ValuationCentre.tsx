import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  Ban,
  BadgeCheck,
  ChevronRight,
  CircleDollarSign,
  Clock,
  History,
  Info,
  PencilLine,
  Sparkles,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  Search,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Textarea } from '../components/ui';
import { CATEGORY_LABEL, categoryMeta } from '../lib/categories';
import { resolveAssetValuation } from '../lib/valuation';
import { formatMoney, formatDateTime, formatPercent, parseNum } from '../lib/money';
import type { Asset, AssetCategory, CurrencyCode, MarketSnapshot, ValuationMethod, ValuationRecord } from '../lib/types';
import {
  CADENCE_OPTIONS,
  VALUATION_NEED_LABEL,
  appraiseBlurb,
  classifyValuationNeed,
  latestRecordValue,
  metalsAppraisal,
  movementSincePrevious,
  questionsForAsset,
  reassessmentDue,
  type AppraisalQuestion,
  type ValuationNeed,
} from '../lib/appraisal';
import { runGeminiAppraisal, type AppraisalPayload, type ValidatedAppraisal } from '../lib/aiValuation';
import { geminiErrorExplanation, type GeminiError } from '../lib/gemini';

/* ═══════════════════════════ small shared pieces ═══════════════════════════ */

const QUESTION_LABEL: Record<string, string> = {
  reference: 'Reference number',
  serial: 'Serial number (private, on-device)',
  condition: 'Condition',
  box_and_papers: 'Box and papers included',
  service_history: 'Complete service history',
  extra_accessories: 'Extra accessories',
  sell_market: 'Expected resale market',
  district: 'District',
  city: 'City / village',
  extent: 'Land extent',
  road_access: 'Road access',
  usage: 'Intended usage',
  utilities: 'Electricity and water',
  nearby: 'Nearby developments',
  year: 'Manufacturing year',
  mileage: 'Mileage (km)',
  engine_cc: 'Engine capacity',
  fuel: 'Fuel type',
  variant: 'Exact model & variant',
  service_records: 'Service history',
  accident_history: 'Accident history',
  owners: 'Previous owners',
  import_status: 'Import status',
  gem_type: 'Gem type',
  gem_weight: 'Carat weight',
  cut: 'Cut quality',
  colour: 'Colour',
  clarity: 'Clarity',
  certification: 'Certification',
  gem_origin: 'Verified origin',
  material: 'Metal / material',
  craftsmanship: 'Craftsmanship basis',
  craftsmanship_facts: 'Workmanship details',
  premium_input: 'Collectible premium (%)',
  other_kind: 'Item kind',
  description: 'Maker / age / provenance',
};

const questionLabel = (id: string) => QUESTION_LABEL[id] ?? id.replace(/_/g, ' ');

function detailsOf(asset: Asset): { key: string; value: string }[] {
  const a = asset.attributes as unknown as Record<string, unknown>;
  const out: { key: string; value: string }[] = [];
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '' || v === false) return;
    if (typeof v === 'boolean') out.push({ key: questionLabel(k), value: 'Yes' });
    else out.push({ key: questionLabel(k), value: String(v) });
  };
  push('quantity', asset.quantity);
  push('reference', a.reference);
  push('condition', a.condition);
  push('box_and_papers', a.boxAndPapers);
  push('brand', a.brand);
  push('model', a.model);
  push('metal', a.metal);
  if (typeof a.weight === 'number') push('weight', `${a.weight} ${a.weightUnit ?? 'g'}`);
  push('purity', a.purity);
  push('gemstoneType', a.gemstoneType);
  push('district', a.district);
  push('city', a.city);
  push('sizePerches', a.sizePerches ? `${a.sizePerches} perches` : undefined);
  push('make', a.make);
  push('year', a.year);
  return out;
}

function detailsLabelOf(key: string): string {
  // `detailsOf` keys are already human labels; passthrough.
  return key;
}

function detailsText(asset: Asset): string {
  return detailsOf(asset).map((d) => `${detailsLabelOf(d.key)}: ${d.value}`).join('; ');
}

function questionAnswerText(answers: Record<string, string>): string {
  return Object.entries(answers)
    .filter(([, v]) => v.trim() !== '')
    .map(([k, v]) => `${questionLabel(k)}: ${v}`)
    .join('; ') || '(none)';
}

/* ═══════════════════════════ page ═══════════════════════════ */

export function ValuationCentrePage() {
  const {
    assets, records, settings, market, valuationPrefs, setCadence, adapter, hasGeminiKeyStored,
  } = useData();
  const usdLkr = market?.usdLkr ?? null;
  const display = settings.displayCurrency;

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<AssetCategory | 'all'>('all');
  const [pickerMode, setPickerMode] = useState<'ai' | 'manual' | null>(null);
  const [aiFlowAsset, setAiFlowAsset] = useState<Asset | null>(null);
  const [manualFlowAsset, setManualFlowAsset] = useState<Asset | null>(null);
  const [historyAsset, setHistoryAsset] = useState<Asset | null>(null);

  const active = useMemo(() => assets.filter((a) => a.status === 'active'), [assets]);

  const lastRecordByAsset = useMemo(() => {
    const m = new Map<string, ValuationRecord>();
    for (const r of records) {
      const prev = m.get(r.assetId);
      if (!prev || new Date(r.recordedAt) > new Date(prev.recordedAt)) m.set(r.assetId, r);
    }
    return m;
  }, [records]);

  const searchLower = search.toLowerCase().trim();

  const rows = useMemo(
    () =>
      active.map((a) => {
        const last = lastRecordByAsset.get(a.id) ?? null;
        const need = classifyValuationNeed(a, last?.recordedAt ?? null);
        const alsoDue = reassessmentDue(last?.recordedAt ?? null, valuationPrefs.cadence);
        const resolved = resolveAssetValuation(a, market);
        return { asset: a, last, need, attention: need !== 'fresh' || alsoDue, valueLkr: resolved.valueLkr, resolved };
      }),
    [active, lastRecordByAsset, valuationPrefs.cadence, market],
  );

  const attentionList = useMemo(
    () =>
      rows
        .filter((e) => e.attention)
        .filter((e) => e.asset.name.toLowerCase().includes(searchLower))
        .filter((e) => catFilter === 'all' || e.asset.category === catFilter)
        .sort((a, b) => {
          const rank: Record<ValuationNeed, number> = { needs_first: 0, info_changed: 1, reassess_due: 2, fresh: 3 };
          return rank[a.need] - rank[b.need];
        }),
    [rows, searchLower, catFilter],
  );

  const recentList = useMemo(
    () =>
      records
        .filter((r) => r.valueLkr != null && Number.isFinite(r.valueLkr))
        .map((r) => ({ record: r, asset: assets.find((a) => a.id === r.assetId) }))
        .filter((x) => x.asset && x.asset.name.toLowerCase().includes(searchLower))
        .filter((x) => catFilter === 'all' || x.asset!.category === catFilter)
        .sort((a, b) => new Date(b.record.recordedAt).getTime() - new Date(a.record.recordedAt).getTime())
        .slice(0, 10),
    [records, assets, searchLower, catFilter],
  );

  const geminiReady = hasGeminiKeyStored();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Valuation Centre</h1>
          <p className="text-xs text-txt-muted mt-1 max-w-xl leading-relaxed">
            Estimate, record and reassess what your physical assets may be worth. AI appraisals are grounded in
            your own facts; metal values are computed from Market Watch; every saved figure is one you approve.
          </p>
        </div>
        <div className="w-52">
          <Field label="Reassess automatically">
            <Select value={valuationPrefs.cadence} onChange={(e) => setCadence(e.target.value as typeof valuationPrefs.cadence)}>
              {CADENCE_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </header>

      <div className="grid sm:grid-cols-2 gap-3">
        <ActionTile
          icon={<Sparkles size={18} className="text-accent" />}
          title="AI Valuation"
          body={geminiReady
            ? 'Guided appraisal: questions matched to what your asset record is missing, then a low/expected/high range with evidence and confidence.'
            : 'Uses the Gemini key from Settings → Gemini AI. Without one, only manual and metal valuations are available.'}
          onClick={() => setPickerMode('ai')}
        />
        <ActionTile
          icon={<CircleDollarSign size={18} className="text-accent" />}
          title="Manual Valuation"
          body="Enter your own estimated value with currency, valuation date and a note. Recorded as owner-entered."
          onClick={() => setPickerMode('manual')}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Input placeholder="Search assets…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 pl-8" />
          <Search size={15} className="absolute left-2.5 top-2.5 text-txt-dim" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={catFilter === 'all'} onClick={() => setCatFilter('all')}>All</FilterChip>
          {(Object.keys(CATEGORY_LABEL) as AssetCategory[]).map((c) => (
            <FilterChip key={c} active={catFilter === c} onClick={() => setCatFilter(c)}>
              {categoryMeta(c).shortLabel}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Needs valuation */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-sm font-semibold tracking-tight">Needs valuation or reassessment</h2>
          <Badge tone={bw(attentionList.length ? 'warn' : 'ok')}>{attentionList.length}</Badge>
        </div>
        {attentionList.length === 0 ? (
          <Card className="p-1">
            <EmptyState
              size="sm"
              icon={<BadgeCheck size={22} className="text-emerald-400" />}
              title="Everything is freshly valued"
              body="Nothing needs a first valuation, reassessment, or follow-up after edits. Overview stays the portfolio dashboard — this list is purely the appraisal inbox."
            />
          </Card>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {attentionList.map((e) => (
              <AttentionCard
                key={e.asset.id}
                entry={e}
                usdLkr={usdLkr}
                display={display}
                onAi={() => setAiFlowAsset(e.asset)}
                onManual={() => setManualFlowAsset(e.asset)}
                onHistory={() => setHistoryAsset(e.asset)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recently valued */}
      <section>
        <h2 className="text-sm font-semibold tracking-tight mb-2.5">Recently valued</h2>
        {recentList.length === 0 ? (
          <Card className="p-1">
            <EmptyState
              size="sm"
              icon={<Clock size={22} />}
              title="No approved valuations yet"
              body="Appraised and approved valuations appear here as a permanent, append-only timeline."
            />
          </Card>
        ) : (
          <div className="space-y-1.5">
            {recentList.map(({ record: r, asset }) => {
              const prev = latestRecordValue(records, r.assetId);
              return (
                <button
                  key={r.id}
                  onClick={() => asset && setHistoryAsset(asset)}
                  className="w-full text-left flex items-center gap-3 rounded-xl border border-ink-700/80 bg-ink-900/70 hover:bg-ink-850 px-4 py-3 transition-colors"
                >
                  <ProvenanceTile record={r} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{asset?.name ?? 'Unknown asset'}</p>
                    <p className="text-2xs text-txt-dim truncate">{r.sourceLabel} · {formatDateTime(r.recordedAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tnum">{formatMoney(r.valueLkr ?? 0, display, usdLkr)}</p>
                    {r.confidence && <Badge tone={bw(r.confidence === 'high' ? 'ok' : r.confidence === 'medium' ? 'info' : 'warn')}>{r.confidence} confidence</Badge>}
                  </div>
                  <ChevronRight size={15} className="text-txt-dim shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Modals */}
      <AssetPickerModal open={pickerMode !== null} mode={pickerMode} assets={active} onClose={() => setPickerMode(null)} onPicked={(a) => { setPickerMode(null); if (pickerMode === 'ai') setAiFlowAsset(a); else setManualFlowAsset(a); }} />
      {aiFlowAsset && (
        <AiFlow
          asset={aiFlowAsset}
          records={records}
          market={market}
          usdLkr={usdLkr}
          onClose={() => setAiFlowAsset(null)}
        />
      )}
      {manualFlowAsset && <ManualFlow asset={manualFlowAsset} usdLkr={usdLkr} onClose={() => setManualFlowAsset(null)} />}
      {historyAsset && <HistoryModal asset={historyAsset} usdLkr={usdLkr} display={display} records={records} onClose={() => setHistoryAsset(null)} />}
    </div>
  );
}

/* ═══════════════════════════ subcomponents ═══════════════════════════ */

function ActionTile({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left group rounded-2xl border border-ink-700/80 bg-grad-card px-5 py-4 hover:border-accent/40 transition-colors shadow-elev-1 hover:shadow-elev-2">
      <div className="flex items-center gap-2.5 mb-1.5">
        {icon}
        <span className="text-sm font-semibold tracking-tight">{title}</span>
        <ChevronRight size={15} className="ml-auto text-txt-dim group-hover:text-accent transition-colors" />
      </div>
      <p className="text-2xs text-txt-muted leading-relaxed">{body}</p>
    </button>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-2xs font-medium border transition-colors ${
        active ? 'bg-accent/15 text-accent border-accent/30' : 'border-ink-700 text-txt-muted hover:text-txt hover:border-ink-650'
      }`}
    >
      {children}
    </button>
  );
}

const NEED_TONE: Record<ValuationNeed, string> = {
  needs_first: 'danger',
  info_changed: 'warn',
  reassess_due: 'info',
  fresh: 'ok',
};
/* UI-kit BadgeTone uses 'positive'/'accent'/'warning'; map appraisal tones onto it. */
const TONE: Record<string, 'accent' | 'positive' | 'warning' | 'negative'> = {
  ok: 'positive',
  info: 'accent',
  warn: 'warning',
  danger: 'negative',
};
const bw = (t: string) => TONE[t] ?? ('neutral' as const);

function AttentionCard({
  entry, usdLkr, display, onAi, onManual, onHistory,
}: {
  entry: { asset: Asset; need: ValuationNeed; valueLkr: number | null; last: ValuationRecord | null };
  usdLkr: number | null;
  display: CurrencyCode;
  onAi: () => void;
  onManual: () => void;
  onHistory: () => void;
}) {
  const meta = categoryMeta(entry.asset.category);
  return (
    <Card className="p-4 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{entry.asset.name}</p>
          <p className="text-2xs text-txt-dim">{meta.label} · last valued: {entry.last ? formatDateTime(entry.last.recordedAt) : 'never'}</p>
        </div>
        <Badge tone={bw(NEED_TONE[entry.need])}>{VALUATION_NEED_LABEL[entry.need]}</Badge>
      </div>
      <p className="text-sm font-medium tnum">
        {entry.valueLkr == null ? <span className="text-txt-dim font-normal">No estimated value</span> : formatMoney(entry.valueLkr, display, usdLkr)}
      </p>
      <p className="text-2xs text-txt-muted leading-relaxed">{appraiseBlurb(entry.asset.category)}</p>
      <div className="mt-auto grid grid-cols-3 gap-1.5">
        <Button size="sm" variant="secondary" onClick={onHistory} aria-label={`History for ${entry.asset.name}`}>
          <History size={13} /> History
        </Button>
        <Button size="sm" variant="ghost" onClick={onManual} aria-label={`Manual valuation for ${entry.asset.name}`}>
          <PencilLine size={13} /> Manual
        </Button>
        <Button size="sm" variant="primary" onClick={onAi} aria-label={`AI valuation for ${entry.asset.name}`}>
          <Sparkles size={13} /> AI
        </Button>
      </div>
    </Card>
  );
}

function ProvenanceTile({ record }: { record: ValuationRecord }) {
  const tone = record.provenance === 'ai_appraisal' ? TONE.info : record.provenance === 'manual' ? TONE.warn : TONE.ok;
  const label = record.provenance === 'ai_appraisal' ? 'AI' : record.provenance === 'manual' ? 'Owner' : 'Market';
  const icon = record.provenance === 'ai_appraisal' ? <Sparkles size={13} /> : record.provenance === 'manual' ? <PencilLine size={13} /> : <TrendingUp size={13} />;
  return <Badge tone={bw(tone)}>{icon} {label}</Badge>;
}

function AssetPickerModal({
  open, mode, assets, onClose, onPicked,
}: {
  open: boolean;
  mode: 'ai' | 'manual' | null;
  assets: Asset[];
  onClose: () => void;
  onPicked: (a: Asset) => void;
}) {
  const [q, setQ] = useState('');
  if (!open) return null;
  const filtered = assets.filter((a) => a.name.toLowerCase().includes(q.toLowerCase().trim()));
  return (
    <Modal open onClose={onClose} title={mode === 'ai' ? 'Choose an asset for an AI appraisal' : 'Choose an asset for a manual valuation'}>
      <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" autoFocus />
      {filtered.length === 0 ? (
        <div className="py-8">
          <EmptyState
            size="sm"
            icon={<Ban size={22} />}
            title={assets.length === 0 ? 'No active assets yet' : 'No matches'}
            body={assets.length === 0 ? 'Add an asset first — the Valuation Centre links every appraisal to a real record in My Assets.' : 'Try a different search.'}
            action={assets.length === 0 ? <Link to="/add"><Button size="sm" variant="primary">Add an asset</Button></Link> : undefined}
          />
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[52vh] overflow-y-auto">
          {filtered.map((a) => (
            <button key={a.id} onClick={() => onPicked(a)} className="w-full text-left flex items-center gap-3 rounded-xl border border-ink-700/70 bg-ink-875 hover:bg-ink-800 px-4 py-3 transition-colors">
              <span className="w-8 h-8 rounded-lg bg-ink-700/50 flex items-center justify-center shrink-0">{(() => { const I = categoryMeta(a.category).icon; return <I size={15} className="text-txt-muted" />; })()}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{a.name}</p>
                <p className="text-2xs text-txt-dim truncate">{categoryMeta(a.category).label}</p>
              </div>
              <ChevronRight size={15} className="ml-auto text-txt-dim shrink-0" />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ═══════════════════════════ AI valuation flow ═══════════════════════════ */

type AiStep = 'question' | 'metals' | 'generating' | 'report';

function AiFlow({
  asset, records, market, usdLkr, onClose,
}: {
  asset: Asset;
  records: ValuationRecord[];
  market: MarketSnapshot | null;
  usdLkr: number | null;
  onClose: () => void;
}) {
  const { recordValuation, loadGeminiKey } = useData();
  const display = useData((s) => s.settings.displayCurrency);

  const questions = useMemo(() => questionsForAsset(asset), [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const existingQuestions = questions.filter((q) => q.id !== 'premium_input' && q.id !== 'craftsmanship_facts');
  const isMetal = asset.category === 'gold_silver';
  const metalsAttrs = asset.attributes as import('../lib/types').GoldSilverAttrs;

  const [step, setStep] = useState<AiStep>(isMetal ? 'metals' : 'question');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [premiumPct, setPremiumPct] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidatedAppraisal | null>(null);
  const [metals, setMetals] = useState<null | ReturnType<typeof metalsAppraisal>>(null);

  useEffect(() => {
    if (isMetal && market) setMetals(metalsAppraisal(metalsAttrs, market, { premiumPct: parseNum(premiumPct) ?? undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMetal, market, premiumPct]);

  const answered = questions.filter((q) => (answers[q.id] ?? '').trim() !== '');
  const skipped = questions.filter((q) => (answers[q.id] ?? '').trim() === '');

  async function generate() {
    setError(null);
    setStep('generating');
    try {
      const key = await loadGeminiKey();
      if (!key) throw { kind: 'no_key' } as GeminiError;
      const payload: AppraisalPayload = {
        categoryLabel: asset.category === 'watches' ? 'Luxury watch'
          : asset.category === 'land_property' ? 'Land / property'
          : asset.category === 'cars' ? 'Car'
          : asset.category === 'motorcycles' ? 'Motorcycle'
          : asset.category === 'gems_jewelry' ? 'Gemstone / jewellery'
          : asset.category === 'gold_silver' ? 'Fine metal'
          : 'Other valuables',
        assetName: asset.name,
        facts: detailsOf(asset).map((d) => ({ key: detailsLabelOf(d.key), value: d.value })),
        answers: answered.map((q) => ({ key: questionLabel(q.id), value: answers[q.id] })),
        skippedQuestionLabels: skipped.map((q) => questionLabel(q.id)),
        marketContext: [],
        hasVerifiedMarketData: false,
        originalCurrency: display,
        purchasePrice:
          asset.purchase.priceLkr != null && Number.isFinite(asset.purchase.priceLkr)
            ? formatMoney(asset.purchase.priceLkr, display, usdLkr) + (asset.purchase.date ? ` (purchased ${asset.purchase.date})` : '')
            : null,
      };
      const appraisal = await runGeminiAppraisal(payload, key);
      setResult(appraisal);
      setStep('report');
    } catch (e) {
      const ge = e as GeminiError;
      setError(ge?.message ? geminiErrorExplanation(ge.kind ?? 'network') + ' ' + ge.message : 'Something went wrong generating the appraisal.');
      setStep('question');
    }
  }

  const approvedNote = (r: ValidatedAppraisal | null, skipped: AppraisalQuestion[]) =>
    r
      ? [
          `Methodology: ${r.sanitizedOutput.methodology}`,
          `Explanation: ${r.sanitizedOutput.explanation}`,
          r.sanitizedOutput.missing_information_impact ? `Missing information: ${r.sanitizedOutput.missing_information_impact}` : '',
          r.sanitizedOutput.positive_factors.length ? `For: ${r.sanitizedOutput.positive_factors.join('; ')}` : '',
          r.sanitizedOutput.negative_factors.length ? `Against: ${r.sanitizedOutput.negative_factors.join('; ')}` : '',
          skipped.length ? `Skipped questions: ${skipped.map((q) => questionLabel(q.id)).join(', ')}` : '',
        ].filter(Boolean).join(' | ')
      : '';

  async function approveAi() {
    if (!result) return;
    const ratio = result.expected_estimate_original / (result.high_estimate_original || 1);
    const valueLkr = display === 'USD' && usdLkr && usdLkr > 0
      ? result.expected_estimate_original * usdLkr
      : result.expected_estimate_original;
    const ok = await recordValuation({
      assetId: asset.id,
      valueLkr,
      method: 'indicative',
      sourceLabel: `AI appraisal (${ratioText(result.confidence)})`,
      confidence: result.confidence,
      note: approvedNote(result, skipped),
      extras: {
        provenance: 'ai_appraisal',
        lowLkr: display === 'USD' ? result.low_estimate_original * (usdLkr ?? 1) : result.low_estimate_original,
        highLkr: display === 'USD' ? result.high_estimate_original * (usdLkr ?? 1) : result.high_estimate_original,
        explanation: result.sanitizedOutput.explanation,
        positives: result.sanitizedOutput.positive_factors,
        negatives: result.sanitizedOutput.negative_factors,
        evidence: result.sanitizedOutput.evidence.map((ev) => ({
          description: ev.detail ? `${ev.description} (${ev.detail})` : ev.description,
          sourceKind: ev.source_kind,
          isAskingPrice: ev.listed_or_sold === 'ask',
        })),
      },
    });
    if (ok) onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={<> <span className="text-accent font-semibold">AI valuation</span> — {asset.name}</>}
      width="max-w-2xl"
      footer={
        <div className="flex gap-2 w-full justify-end">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      {step === 'metals' && (
        <MetalsPanel
          metals={metals}
          market={market}
          usdLkr={usdLkr}
          display={display}
          premiumInput={premiumPct}
          onPremiumInput={setPremiumPct}
          onClose={onClose}
        />
      )}
      {step === 'question' && (
        <div className="space-y-4">
          <Card className="p-3.5 bg-ink-875">
            <p className="text-2xs font-semibold text-txt-dim uppercase tracking-wider mb-1.5">What the app already knows</p>
            <p className="text-xs leading-relaxed text-txt-muted">{detailsText(asset) || 'Only the name and category — the questions below fill the rest.'}</p>
          </Card>
          <p className="text-xs text-txt-muted leading-relaxed">
            These questions match what the record is missing for a <b>{asset.category.replace('_', ' ')}</b>. Answer the ones
            you can; skipping just changes the confidence shown — never blocks you.
          </p>
          {existingQuestions.map((q) => (
            <QuestionField key={q.id} q={q} value={answers[q.id] ?? ''} onChange={(v) => setAnswers((s) => ({ ...s, [q.id]: v }))} />
          ))}
          {!existingQuestions.length && (
            <Card className="p-3.5 bg-ink-875">
              <p className="text-xs text-txt-muted leading-relaxed">
                The record is already detailed — no additional questions for this category. You can go straight to the estimate.
              </p>
            </Card>
          )}
          {error && <InlineError error={error} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={() => void generate()}>
              <Sparkles size={14} /> Generate appraisal
            </Button>
          </div>
        </div>
      )}
      {step === 'generating' && (
        <div className="py-10 text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <p className="text-xs text-txt-muted">Building the appraisal from your facts… (never invents your asset's measurements)</p>
        </div>
      )}
      {step === 'report' && result && (
        <AppraisalReport result={result} usdLkr={usdLkr} display={display} onApprove={approveAi} onClose={onClose} />
      )}
    </Modal>
  );
}

function ratioText(conf: 'low' | 'medium' | 'high'): string {
  return conf;
}

interface MetalsPanelProps {
  metals: ReturnType<typeof metalsAppraisal>;
  market: MarketSnapshot | null;
  usdLkr: number | null;
  display: CurrencyCode;
  premiumInput: string;
  onPremiumInput: (v: string) => void;
  onClose: () => void;
}

function MetalsPanel({ metals, market, usdLkr, display, premiumInput, onPremiumInput, onClose }: MetalsPanelProps) {
  const { recordValuation, assets } = useData();
  const [stateful, setStateful] = useState('saving');
  if (!market) {
    return (
      <div className="text-center py-8">
        <Info size={20} className="text-txt-dim mx-auto mb-2" />
        <p className="text-xs text-txt-muted">Market data is still loading. Wait for the Market Watch snapshot to arrive, then retry.</p>
      </div>
    );
  }
  if (!metals) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-txt-muted">No Market Watch observation is available for this metal yet on this device.</p>
        <p className="text-2xs text-txt-dim mt-1">Open Market Watch to collect one, then return here. Metal values only use real observations — nothing is invented.</p>
      </div>
    );
  }
  const assetId = (metals as never as { assetId: string }).assetId;
  const approve = async () => {
    if (!metals) return;
    await recordValuation({
      assetId: assetId as never as string,
      valueLkr: metals.expectedLkr,
      method: 'calculated',
      sourceLabel: `Market Watch fine-metal value${metals.premiumPct ? ` · ${metals.premiumPct}% premium input` : ''}`,
      confidence: metals.confidence,
      note: metals.explanation,
      extras: { provenance: 'market', lowLkr: metals.lowLkr, highLkr: metals.highLkr, explanation: metals.explanation },
    });
    onClose();
  };
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div>
          <p className="text-2xs font-semibold text-txt-dim uppercase tracking-wider">Fine-metal value (computed, not modelled)</p>
          <p className="text-xl font-semibold tnum mt-0.5">{formatMoney(metals.expectedLkr, display, usdLkr)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-ink-875 border border-ink-700/60 p-2.5">
            <p className="text-2xs text-txt-dim">Low (after typical dealer spread)</p>
            <p className="font-semibold tnum mt-0.5">{formatMoney(metals.lowLkr, display, usdLkr)}</p>
          </div>
          <div className="rounded-lg bg-ink-875 border border-ink-700/60 p-2.5">
            <p className="text-2xs text-txt-dim">High (with your premium input)</p>
            <p className="font-semibold tnum mt-0.5">{formatMoney(metals.highLkr, display, usdLkr)}</p>
          </div>
        </div>
        <Field label="Collectible premium (optional % of fine value)">
          <Input value={premiumInput} onChange={(e) => onPremiumInput(e.target.value)} placeholder="Leave empty for pure content value" inputMode="decimal" />
        </Field>
        <p className="text-2xs text-txt-dim leading-relaxed">
          Derived from the same Market Watch observations the Insights page uses — {metals.confidence} confidence. Real
          resale proceeds are typically below fine-metal value after spreads and test deductions.
        </p>
      </Card>
      <p className="text-2xs text-txt-dim leading-relaxed">{metals.explanation}</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        <Button size="sm" variant="primary" onClick={() => void approve()}>
          <ThumbsUp size={14} /> Approve &amp; save
        </Button>
      </div>
    </div>
  );
}

function QuestionField({ q, value, onChange }: { q: AppraisalQuestion; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="text-xs font-medium">{q.label} <span className="text-2xs text-txt-dim">(optional)</span></p>
      <p className="text-2xs text-txt-dim mt-0.5 mb-1.5 leading-relaxed">{q.why}</p>
      {q.kind === 'choice' ? (
        <div className="flex flex-wrap gap-1.5">
          {q.options?.map((o) => (
            <FilterChip key={o} active={value === o} onClick={() => onChange(value === o ? '' : o)}>{o}</FilterChip>
          ))}
        </div>
      ) : q.kind === 'boolean' ? (
        <div className="flex gap-1.5">
          <FilterChip active={value === 'Yes'} onClick={() => onChange(value === 'Yes' ? '' : 'Yes')}>Yes</FilterChip>
          <FilterChip active={value === 'No'} onClick={() => onChange(value === 'No' ? '' : 'No')}>No</FilterChip>
        </div>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={q.placeholder ?? (q.kind === 'number' ? `Enter number${q.unit ? ` in ${q.unit}` : ''}` : 'Type your answer')}
          inputMode={q.kind === 'number' ? 'decimal' : undefined}
        />
      )}
    </div>
  );
}

function InlineError({ error }: { error: string }) {
  return (
    <Card className="p-3 border-rose-500/40 bg-rose-500/5">
      <p className="text-xs text-rose-300 leading-relaxed">{error}</p>
    </Card>
  );
}

function AppraisalReport({
  result, usdLkr, display, onApprove, onClose,
}: {
  result: ValidatedAppraisal;
  usdLkr: number | null;
  display: CurrencyCode;
  onApprove: () => void | Promise<void>;
  onClose: () => void;
}) {
  const toDisplay = (n: number) => formatMoney(display === 'USD' && usdLkr && usdLkr > 0 ? n * usdLkr : n, display, usdLkr);
  const low = toDisplay(result.low_estimate_original);
  const expected = toDisplay(result.expected_estimate_original);
  const high = toDisplay(result.high_estimate_original);
  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-2xs font-semibold text-txt-dim uppercase tracking-wider">Estimated market value</p>
          <Badge tone={bw(result.confidence === 'high' ? 'ok' : result.confidence === 'medium' ? 'info' : 'warn')}>{result.confidence} confidence{result.clamped ? ' · range clamped' : ''}</Badge>
        </div>
        <p className="text-2xl font-semibold tnum">{expected}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-ink-875 border border-ink-700/60 p-2.5"><p className="text-2xs text-txt-dim">Low estimate</p><p className="font-semibold tnum mt-0.5">{low}</p></div>
          <div className="rounded-lg bg-ink-875 border border-ink-700/60 p-2.5"><p className="text-2xs text-txt-dim">High estimate</p><p className="font-semibold tnum mt-0.5">{high}</p></div>
        </div>
        <p className="text-2xs text-txt-dim leading-relaxed">{result.sanitizedOutput.methodology}</p>
      </Card>

      {result.sanitizedOutput.evidence.length > 0 && (
        <Card className="p-4">
          <p className="text-2xs font-semibold text-txt-dim uppercase tracking-wider mb-2">Market evidence</p>
          <div className="space-y-1.5">
            {result.sanitizedOutput.evidence.map((ev, i) => (
              <p key={i} className="text-xs text-txt-muted leading-relaxed">
                <Badge tone={bw(ev.source_kind === 'verified' ? 'ok' : 'warn')}>{ev.source_kind === 'model_knowledge' ? 'pattern, unverified' : ev.source_kind === 'user_supplied' ? 'your input' : 'verified'}</Badge>{' '}
                {ev.description}{ev.listed_or_sold === 'ask' ? ' (asking price)' : ev.listed_or_sold === 'sale' ? ' (completed sale)' : ''}
              </p>
            ))}
          </div>
        </Card>
      )}

      {(result.sanitizedOutput.positive_factors.length > 0 || result.sanitizedOutput.negative_factors.length > 0) && (
        <Card className="p-4 space-y-2.5">
          <p className="text-2xs font-semibold text-txt-dim uppercase tracking-wider">Value factors</p>
          {result.sanitizedOutput.positive_factors.map((f, i) => (
            <p key={`p${i}`} className="text-xs text-emerald-300 flex items-start gap-1.5"><TrendingUp size={13} className="mt-0.5 shrink-0" />{f}</p>
          ))}
          {result.sanitizedOutput.negative_factors.map((f, i) => (
            <p key={`n${i}`} className="text-xs text-rose-300 flex items-start gap-1.5"><TrendingDown size={13} className="mt-0.5 shrink-0" />{f}</p>
          ))}
        </Card>
      )}

      <Card className="p-4">
        <p className="text-2xs font-semibold text-txt-dim uppercase tracking-wider mb-1.5">AI explanation</p>
        <p className="text-xs text-txt-muted leading-relaxed">{result.sanitizedOutput.explanation}</p>
        {result.sanitizedOutput.missing_information_impact && (
          <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/25 p-2.5">
            <p className="text-2xs text-amber-300 leading-relaxed"><b>Skipped information:</b> {result.sanitizedOutput.missing_information_impact}</p>
          </div>
        )}
      </Card>

      <Card className="p-3 bg-ink-875">
        <p className="text-2xs text-txt-dim leading-relaxed">
          An AI appraisal is an opinion over your facts — a professional appraisal replaces it for certificates, legal or insurance purposes.
        </p>
      </Card>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onClose}>Reject</Button>
        <Button size="sm" variant="primary" onClick={() => void onApprove()}>
          <ThumbsUp size={14} /> Approve &amp; save
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════ manual flow ═══════════════════════════ */

function ManualFlow({ asset, usdLkr, onClose }: { asset: Asset; usdLkr: number | null; onClose: () => void }) {
  const { recordValuation, settings, market } = useData();
  const display = settings.displayCurrency;
  const [currency, setCurrency] = useState<CurrencyCode>(display);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const currentValue = resolveAssetValuation(asset, market).valueLkr;

  const amountNum = parseNum(amount);
  const toLkr = (n: number) => (currency === 'USD' ? n * (usdLkr ?? 0) : n);
  const existingSameCurrency =
    currency === 'LKR' ? asset.purchase.priceLkr : asset.purchase.currency === 'USD' ? (asset.purchase.priceOriginal ?? null) : null;

  const save = async () => {
    if (!amountNum || amountNum <= 0) return setError('Enter a positive estimated value.');
    if (currency === 'USD' && (!usdLkr || usdLkr <= 0)) return setError('USD entry needs a current LKR/USD rate; use the market refresh or switch to LKR.');
    const ok = await recordValuation({
      assetId: asset.id,
      valueLkr: toLkr(amountNum),
      method: 'user',
      sourceLabel: 'Owner-entered value',
      confidence: 'medium',
      note: note.trim() || null,
      effectiveAt: date ? `${date}T12:00:00.000Z` : undefined,
      extras: { provenance: 'manual' },
    });
    if (ok) onClose();
  };

  return (
    <Modal open onClose={onClose} title={<>Manual valuation — {asset.name}</>}>
      <div className="space-y-4">
        <Card className="p-3 bg-ink-875">
          <p className="text-2xs text-txt-dim leading-relaxed">
            Current estimate: {currentValue == null ? 'none' : formatMoney(currentValue, display, usdLkr)} · purchase
            price: {asset.purchase.priceLkr == null ? 'not recorded' : formatMoney(existingSameCurrency != null && currency === 'USD' ? existingSameCurrency * (usdLkr ?? 1) : (asset.purchase.priceLkr ?? 0), display, usdLkr)} — the purchase price stays untouched.
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              <option value="LKR">LKR — Sri Lankan Rupee</option>
              <option value="USD">USD — US Dollar</option>
            </Select>
          </Field>
          <Field label="Estimated value">
            <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0" autoFocus />
          </Field>
        </div>
        <Field label="Valuation date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
        </Field>
        <Field label="Note (optional)">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this value — receipt, catalogue, dealer quote…" />
        </Field>
        {error && <InlineError error={error} />}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => void save()}>
            <ThumbsUp size={14} /> Save valuation
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════ history modal ═══════════════════════════ */

function HistoryModal({
  asset, records, usdLkr, display, onClose,
}: {
  asset: Asset;
  records: ValuationRecord[];
  usdLkr: number | null;
  display: CurrencyCode;
  onClose: () => void;
}) {
  const timeline = useMemo(
    () =>
      records
        .filter((r) => r.assetId === asset.id && r.valueLkr != null && Number.isFinite(r.valueLkr))
        .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()),
    [records, asset.id],
  );
  const latest = timeline[0] ?? null;
  const previous = timeline[1] ?? null;
  const movement = latest && previous
    ? movementSincePrevious(latest.valueLkr!, previous.valueLkr ?? null, previous.recordedAt)
    : movementSincePrevious(latest?.valueLkr ?? 0, asset.purchase.priceLkr ?? null, asset.purchase.date ?? null);
  const purchase = asset.purchase.priceLkr;
  return (
    <Modal open onClose={onClose} title={<>Valuation history — {asset.name}</>} width="max-w-2xl">
      {timeline.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<History size={22} />}
          title="No valuation timeline yet"
          body="Approved AI appraisals and manual valuations build an append-only history that is never overwritten."
        />
      ) : (
        <div className="space-y-4">
          {(movement ?? null) && (
            <Card className="p-4 flex items-center gap-3">
              {movement!.absChange >= 0
                ? <TrendingUp size={18} className="text-emerald-400 shrink-0" />
                : <TrendingDown size={18} className="text-rose-400 shrink-0" />}
              <div>
                <p className="text-sm font-semibold tnum">
                  {movement!.absChange >= 0 ? '+' : ''}{formatMoney(movement!.absChange, display, usdLkr)}
                  {movement!.pctChange != null && ` (${formatPercent(movement!.pctChange)})`}
                </p>
                <p className="text-2xs text-txt-dim">Estimated change since {previous ? 'the previous valuation' : 'purchase'} — never a realised result.</p>
              </div>
            </Card>
          )}
          <div className="relative border-l border-ink-700/80 pl-5 space-y-4">
            {timeline.map((r) => (
              <div key={r.id} className="relative">
                <span className="absolute -left-[27px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent/60 border border-accent" />
                <p className="text-sm font-semibold tnum">{formatMoney(r.valueLkr ?? 0, display, usdLkr)}</p>
                <p className="text-2xs text-txt-dim">{formatDateTime(r.recordedAt)} · {r.sourceLabel}</p>
                {r.provenance && <Badge tone={bw(r.provenance === 'ai_appraisal' ? 'info' : r.provenance === 'manual' ? 'warn' : 'ok')}>{r.provenance === 'ai_appraisal' ? 'AI appraisal' : r.provenance === 'manual' ? 'Owner-entered' : 'Market'}</Badge>}
                {r.explanation && <p className="text-2xs text-txt-muted mt-1 leading-relaxed">{r.explanation}</p>}
                {(r.lowLkr != null || r.highLkr != null) && (
                  <p className="text-2xs text-txt-dim mt-0.5">
                    Range: {r.lowLkr != null ? formatMoney(r.lowLkr, display, usdLkr) : '—'} – {r.highLkr != null ? formatMoney(r.highLkr, display, usdLkr) : '—'}
                  </p>
                )}
                {r.evidence && r.evidence.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {r.evidence.map((e, i) => (
                      <p key={i} className="text-2xs text-txt-dim leading-relaxed">
                        <Badge tone={bw(e.sourceKind === 'verified' ? 'ok' : 'warn')}>{e.sourceKind === 'model_knowledge' ? 'unverified pattern' : e.sourceKind === 'user_supplied' ? 'your input' : 'verified'}</Badge>{' '}
                        {e.description}{e.isAskingPrice ? ' (asking)' : ''}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Card className="p-3 bg-ink-875">
            <p className="text-2xs text-txt-dim leading-relaxed">
              {purchase != null && Number.isFinite(purchase)
                ? `Purchase price on record: ${formatMoney(purchase, display, usdLkr)}${asset.purchase.date ? ` (${asset.purchase.date})` : ''}. It is never overwritten by estimates.`
                : 'No purchase price is recorded for this asset.'}
            </p>
          </Card>
        </div>
      )}
    </Modal>
  );
}
