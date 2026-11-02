/**
 * AI Insights — a separate Gemini-powered analysis section (distinct from
 * Reports). It reasons over two verified inputs supplied by the app:
 *
 *  1. The market snapshot built from on-device provider observations
 *     (reuses reports.ts buildSnapshot — never model-supplied prices).
 *  2. The user's own portfolio aggregates (computed locally by the
 *     valuation engine — allocation, concentration, per-metal holdings).
 *
 * The model returns a STRUCTURED analysis (native responseSchema, zod
 * re-validated). All numeric values rendered come from local computation
 * only; model output supplies prose classification. Same honesty rules as
 * Reports: no fabricated prices, no guaranteed returns, insufficient data
 * is stated as insufficient.
 */

import { z } from 'zod';
import { buildPortfolioSnapshot, type PortfolioSnapshot } from './insightsContext';
import {
  buildEvidencePack,
  type EvidenceEntry,
  type EvidencePack,
} from './insightsEvidence';
import { buildSnapshot, type ReportPeriod } from './reports';
import {
  GEMINI_API_BASE,
  GeminiError,
  sanitizeModelText,
  type GeminiErrorKind,
} from './gemini';
import { METAL_META, type MetalCode } from './marketWatch';

export type { ReportPeriod };

/* ─────────────── Model selection (Settings → AI Insights / Gemini) ─────────────── */

/** Controlled list of current, verified Gemini model ids (REST API model names). */
export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'] as const;
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash' as const;
export type GeminiModel = (typeof GEMINI_MODELS)[number];

export function isGeminiModel(v: string): v is GeminiModel {
  return (GEMINI_MODELS as readonly string[]).includes(v);
}

const MODEL_KEY = 'vaultfolio.gemini.model.v1';

export function getSelectedModel(): GeminiModel {
  try {
    const v = localStorage.getItem(MODEL_KEY);
    return isGeminiModel(v ?? '') ? (v as GeminiModel) : DEFAULT_GEMINI_MODEL;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function setSelectedModel(model: GeminiModel): void {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    /* non-critical preference */
  }
}

/* ─────────────── Connection probe (Settings → Test connection) ─────────────── */

export type ProbeResult =
  | { ok: true; availableModels: string[] }
  | { ok: false; kind: GeminiErrorKind; message: string };

/**
 * Validate the configured key + model using the keyless-cost Models.list
 * endpoint (GET). Confirms the key works and reports whether the selected
 * model is available to it. Performs no generation and costs no quota.
 */
export async function probeConnection(apiKey: string, model: GeminiModel): Promise<ProbeResult> {
  if (!apiKey || apiKey.trim().length < 20) {
    return { ok: false, kind: 'no_key', message: 'A Gemini API key is required.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${GEMINI_API_BASE}/models`, {
      headers: { 'x-goog-api-key': apiKey.trim() },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new GeminiError('auth', 'The API key was rejected by Google (401/403).');
    }
    if (res.status === 429) {
      throw new GeminiError('quota', 'The Gemini API quota is exhausted (429).');
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        msg = j.error?.message ?? msg;
      } catch { /* keep generic */ }
      throw new GeminiError(res.status === 400 ? 'auth' : 'upstream', msg);
    }
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (body.models ?? []).map((m) => (m.name ?? '').replace(/^models\//, ''));
    return { ok: true, availableModels: names };
  } catch (e) {
    if (e instanceof GeminiError) return { ok: false, kind: e.kind, message: e.message };
    if ((e as Error).name === 'AbortError') {
      return { ok: false, kind: 'timeout', message: 'Connection test timed out.' };
    }
    return { ok: false, kind: 'network', message: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────── Model output schema ─────────────── */

const TREND = ['bullish', 'bearish', 'neutral', 'uncertain'] as const;
const CONFIDENCE = ['low', 'medium', 'high'] as const;

const metalInsightSchema = z.object({
  symbol: z.enum(['XAU', 'XAG', 'XPT', 'XPD', 'XCU']),
  headline: z.string().min(1),
  comment: z.string().min(1),
  direction: z.enum(TREND),
  confidence: z.enum(CONFIDENCE),
});

export const insightsSchema = z.object({
  market_overview: z.string().min(1),
  metals: z.array(metalInsightSchema).max(5),
  portfolio: z.object({
    summary: z.string(),
    allocation_comment: z.string(),
    concentration_note: z.string(),
  }),
  risks: z.array(z.string().min(1)).max(8),
  opportunities: z.array(z.string().min(1)).max(8),
  tips: z.array(z.string().min(1)).max(8),
  limitations: z.array(z.string().min(1)).max(12),
});

export type MetalInsight = z.infer<typeof metalInsightSchema>;
export type InsightsAnalysis = z.infer<typeof insightsSchema>;

/* ─────────────── Insight cards (v2) — structured visual cards ─────────────── */

export const AI_INSIGHT_CATEGORIES = [
  'portfolio_overview',
  'opportunities',
  'risks',
  'asset_performance',
  'market_impact',
  'concentration',
  'valuation_warnings',
  'recommendations',
] as const;
export type AiInsightCategory = (typeof AI_INSIGHT_CATEGORIES)[number];

export const aiCardSchema = z.object({
  category: z.enum(AI_INSIGHT_CATEGORIES),
  headline: z.string().min(1),
  explanation: z.string().min(1),
  indicator: z.enum(['positive', 'negative', 'neutral']),
  evidence_ids: z.array(z.string().min(1)).max(4),
  confidence: z.enum(CONFIDENCE),
});

export const insightsAnalysisV2Schema = z.object({
  market_overview: z.string().min(1),
  metals: z.array(metalInsightSchema).max(5),
  cards: z.array(aiCardSchema).min(2).max(8),
  limitations: z.array(z.string().min(1)).max(10),
});
export type InsightsAnalysisV2 = z.infer<typeof insightsAnalysisV2Schema>;

/** An insight card with its cited evidence RESOLVED from the local pack. */
export interface ResolvedEvidence {
  id: string;
  kind: EvidenceEntry['kind'];
  title: string;
  direction: 'up' | 'down' | 'flat';
  numbers: Array<{ label: string; value: string }>;
  series?: { label: string; unitLabel: string; points: Array<{ x: number; y: number }> };
  coverage: string;
}

export interface AiInsightCard {
  id: string;
  category: AiInsightCategory;
  headline: string;
  explanation: string;
  indicator: 'positive' | 'negative' | 'neutral';
  confidence: 'low' | 'medium' | 'high';
  evidence: ResolvedEvidence[];
}

/* ─────────────── Prompt construction ─────────────── */

function buildInsightsPrompt(
  market: ReturnType<typeof buildSnapshot>,
  portfolio: PortfolioSnapshot,
  pack: EvidencePack,
  previousTitles: string[],
): string {
  const compact = {
    market: market,
    portfolio: {
      asOf: portfolio.asOf,
      total_value_lkr: portfolio.totalValueLkr,
      total_value_usd: portfolio.totalValueUsd,
      active_assets: portfolio.activeAssets,
      fx_rate_lkr_per_usd: portfolio.usdLkr,
      fx_as_of: portfolio.usdLkrAsOf,
      fx_stale: portfolio.usdLkrStale,
      holdings_by_metal: portfolio.metalHoldings,
      allocation_pct: portfolio.allocationPct,
      top_category: portfolio.topCategory,
      notes: portfolio.notes,
    },
    provenance:
      'Market numbers come from Vaultfolio provider observations; portfolio numbers from the local valuation engine. These are the ONLY numeric facts available to you. Never invent prices, exchange rates, or balances beyond this JSON.',
  };
  return `You are a careful metals-and-portfolio analyst producing Vaultfolio's premium AI-INSIGHTS: a curated set of visual INSIGHT CARDS that explain what happened to THIS portfolio, why, and what it may mean.

STRICT RULES:
1. Use ONLY the numeric data in the verified snapshot + VERIFIED EVIDENCE list. Never invent prices, exchange rates, returns, news events, or balances. If a fact is absent, say so.
2. Produce 3 to 8 insight cards. Order them by importance: portfolio_overview first (always include exactly one), then the most significant of: market_impact on the user's actual holdings, asset_performance (biggest movers), concentration, valuation_warnings (stale/missing data),risks, opportunities, and at most one recommendations card.
3. Each card: headline (one specific sentence, not generic), explanation (2-3 sentences: WHAT changed with the cited numbers' direction, WHY (mechanism), and WHAT IT MEANS for the user), indicator (positive/negative/neutral relative to the portfolio), confidence (how real the data basis is), evidence_ids (0-4 ids from VERIFIED EVIDENCE; cite the entries your explanation rests on).
4. Headlines must differ from each other AND rotate vs PREVIOUS ANALYSIS HEADLINES (listed below) — do not repeat them verbatim.
5. NEVER describe unrealised valuation changes as realised profit; never promise, predict, or imply guaranteed returns; no specific trade recommendations; education and framing only.
6. When observation counts are low, coverage fields say so, or the fx rate is stale/missing, say so in the card and use low confidence — data honesty outranks cleverness.
7. Every card must reference its window (period shown in the snapshot).
8. Professional plain language; no markdown inside fields; every explanation self-contained.
9. If the portfolio has no valued assets, produce portfolio_overview saying so plus valuation_warnings cards about missing data instead of inventing analysis.

Markets: last ${market.period} window. Portfolio asOf: ${portfolio.asOf}.

PREVIOUS ANALYSIS HEADLINES (rotate; do not repeat verbatim):
${previousTitles.length > 0 ? previousTitles.map((t) => `- ${t}`).join('\n') : '(first analysis — none)'}

VERIFIED SNAPSHOT:
${JSON.stringify(compact, null, 1)}

VERIFIED EVIDENCE (only these evidence_ids may be cited):
${evidenceDigest(pack)}`;
}

/* ─────────────── Model output parsing (v2) ─────────────── */

function geminiInsightsResponseSchema(): Record<string, unknown> {
  const metalInsight = {
    type: 'OBJECT',
    properties: {
      symbol: { type: 'STRING', enum: ['XAU', 'XAG', 'XPT', 'XPD', 'XCU'] },
      headline: { type: 'STRING' },
      comment: { type: 'STRING' },
      direction: { type: 'STRING', enum: TREND },
      confidence: { type: 'STRING', enum: CONFIDENCE },
    },
    required: ['symbol', 'headline', 'comment', 'direction', 'confidence'],
  };
  const insightCard = {
    type: 'OBJECT',
    properties: {
      category: { type: 'STRING', enum: [...AI_INSIGHT_CATEGORIES] },
      headline: { type: 'STRING' },
      explanation: { type: 'STRING' },
      indicator: { type: 'STRING', enum: ['positive', 'negative', 'neutral'] },
      evidence_ids: { type: 'ARRAY', items: { type: 'STRING' } },
      confidence: { type: 'STRING', enum: CONFIDENCE },
    },
    required: ['category', 'headline', 'explanation', 'indicator', 'evidence_ids'],
  };
  return {
    type: 'OBJECT',
    properties: {
      market_overview: { type: 'STRING' },
      metals: { type: 'ARRAY', items: metalInsight },
      cards: { type: 'ARRAY', items: insightCard },
      limitations: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['market_overview', 'metals', 'cards', 'limitations'],
  };
}

/* ─────────────── Card assembly — model citations resolved against the pack ─────────────── */

/**
 * Deterministic analytics fallback: when the AI provider fails, the same
 * evidence pack renders as neutral summary cards so the page never breaks
 * and never presents stale AI prose as if it were fresh.
 */
export function deterministicFallbackCards(pack: EvidencePack): AiInsightCard[] {
  const priority = [
    'ev_period_perf',
    'ev_net_gain',
    'ev_concentration',
    'ev_valuation_trend',
    'ev_stale_valuations',
    'ev_metal_XAU',
    'ev_metal_XAG',
  ];
  const categoryFor: Record<EvidenceEntry['kind'], AiInsightCategory> = {
    'portfolio-totals': 'portfolio_overview',
    'period-change': 'portfolio_overview',
    'metal-market': 'market_impact',
    allocation: 'concentration',
    holding: 'asset_performance',
    mover: 'asset_performance',
    freshness: 'valuation_warnings',
    'valuation-trend': 'portfolio_overview',
  };
  const byId = new Map(pack.entries.map((e) => [e.id, e] as const));
  const cards: AiInsightCard[] = [
    {
      id: 'fallback-overview',
      category: 'portfolio_overview',
      headline: 'Deterministic on-device analysis (AI unavailable)',
      explanation:
        'These findings are computed locally from your valuation records and stored market observations. Generate with Gemini again for an interpreted, structured analysis.',
      indicator: 'neutral',
      confidence: 'high',
      evidence: [],
    },
  ];
  let used = 0;
  for (const id of priority) {
    const entry = byId.get(id);
    if (!entry || entry.numbers.length < 2) continue;
    used += 1;
    cards.push({
      id: `fallback-${entry.id}`,
      category: categoryFor[entry.kind],
      headline: entry.title,
      explanation: entry.coverage,
      indicator: entry.direction === 'up' ? 'positive' : entry.direction === 'down' ? 'negative' : 'neutral',
      confidence: 'high',
      evidence: [
        {
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          direction: entry.direction,
          numbers: entry.numbers,
          series: entry.series,
          coverage: entry.coverage,
        },
      ],
    });
    if (used >= 4) break;
  }
  return cards;
}

function assembleCards(pack: EvidencePack, raw: InsightsAnalysisV2['cards']): AiInsightCard[] {
  const byId = new Map(pack.entries.map((e) => [e.id, e] as const));
  const cards: AiInsightCard[] = [];
  for (const card of raw) {
    const evidence: ResolvedEvidence[] = [];
    const seen = new Set<string>();
    for (const id of card.evidence_ids) {
      const entry = byId.get(id);
      if (!entry || seen.has(id)) continue;
      seen.add(id);
      evidence.push({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        direction: entry.direction,
        numbers: entry.numbers,
        series: entry.series
          ? { label: entry.series.label, unitLabel: entry.series.unitLabel, points: entry.series.points }
          : undefined,
        coverage: entry.coverage,
      });
    }
    cards.push({
      id: `card-${cards.length + 1}`,
      category: card.category,
      headline: sanitizeModelText(card.headline),
      explanation: sanitizeModelText(card.explanation),
      indicator: card.indicator,
      confidence: card.confidence,
      evidence,
    });
  }
  return cards;
}

/** Compact evidence digest fed to the model — ids, factual one-liners, numbers. */
function evidenceDigest(pack: EvidencePack): string {
  return pack.entries
    .map((e) => {
      const nums = e.numbers.map((n) => `${n.label}: ${n.value}`).join('; ');
      return `- ${e.id} (${e.kind}) :: ${e.title}${nums ? ` :: ${nums}` : ''}${e.coverage ? ` :: coverage: ${e.coverage}` : ''}`;
    })
    .join('\n');
}

/* ─────────────── Insights document ─────────────── */

export interface InsightsDoc {
  generatedAt: string;
  period: ReportPeriod;
  model: GeminiModel;
  marketSummary: string;
  metals: MetalInsight[];
  cards: AiInsightCard[];
  limitations: string[];
  /** What the model actually had to work with. */
  dataBasis: {
    marketPeriod: string;
    observationCounts: Record<MetalCode, number>;
    providers: string[];
    fxRateLkrPerUsd: number | null;
    fxAsOf: string | null;
    portfolioActiveAssets: number;
    valuedAssets: number;
  };
  disclaimer: string;
}

const INSIGHTS_DISCLAIMER =
  'AI-generated interpretation of your locally stored market observations and portfolio aggregates, produced by Gemini. Not financial advice, not a prediction, not a guaranteed return. Verify before acting.';

export function assembleInsightsDoc(
  market: ReturnType<typeof buildSnapshot>,
  portfolio: PortfolioSnapshot,
  pack: EvidencePack,
  analysis: InsightsAnalysisV2,
  model: GeminiModel,
): InsightsDoc {
  const providers = Array.from(
    new Set(market.metals.map((m) => m.provider).filter((p): p is string => Boolean(p))),
  );
  const observationCounts = Object.fromEntries(
    (Object.keys(METAL_META) as MetalCode[]).map((c) => [c, market.metals.find((m) => m.symbol === c)?.observationCount ?? 0]),
  ) as Record<MetalCode, number>;
  const valuedAssets = portfolio.allocationPct.reduce((n, a) => n + (a.percent > 0 ? 1 : 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    period: market.period,
    model,
    marketSummary: sanitizeModelText(analysis.market_overview),
    metals: analysis.metals.map((m) => ({
      symbol: m.symbol,
      headline: sanitizeModelText(m.headline),
      comment: sanitizeModelText(m.comment),
      direction: m.direction,
      confidence: m.confidence,
    })),
    cards: assembleCards(pack, analysis.cards),
    limitations: [
      ...analysis.limitations.map(sanitizeModelText),
      'Interpretations are Gemini output validated for structure; numbers shown in cards come only from the local evidence pack.',
      `Market window: ${market.period}. Observations grow only while fetching runs on this device.`,
    ],
    dataBasis: {
      marketPeriod: market.period,
      observationCounts,
      providers,
      fxRateLkrPerUsd: portfolio.usdLkr,
      fxAsOf: portfolio.usdLkrAsOf,
      portfolioActiveAssets: portfolio.activeAssets,
      valuedAssets,
    },
    disclaimer: INSIGHTS_DISCLAIMER,
  };
}

/* ─────────────── Generation call ─────────────── */

export async function generateInsights(args: {
  history: import('./marketWatch').PriceObservation[];
  period: ReportPeriod;
  portfolio: PortfolioSnapshot;
  /** Assets + records feed the deterministic evidence pack. */
  assets?: import('./types').Asset[];
  records?: import('./types').ValuationRecord[];
  market?: import('./types').MarketSnapshot | null;
  /** Headlines of the last generated analysis, for rotation. */
  previousTitles?: string[];
  apiKey: string;
  model?: GeminiModel;
}): Promise<{ doc: InsightsDoc; rawText: string }> {
  const model = args.model ?? getSelectedModel();
  const market = buildSnapshot(args.history, args.period);
  const pack = buildEvidencePack({
    assets: args.assets ?? [],
    records: args.records ?? [],
    market: args.market ?? null,
    history: args.history,
    period: args.period,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey.trim() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildInsightsPrompt(market, args.portfolio, pack, args.previousTitles ?? []) }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: geminiInsightsResponseSchema(),
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw await geminiHttpError(res);
    }

    const body = (await res.json()) as import('./gemini').GeminiApiResponse;
    const blockReason = body.promptFeedback?.blockReason;
    const candidate = body.candidates?.[0];
    if (blockReason && (!candidate || !candidate.content?.parts?.some((p) => p.text))) {
      throw new GeminiError('blocked', `Gemini blocked this request (${blockReason}).`);
    }
    const rawText = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!rawText.trim()) {
      throw new GeminiError('empty', 'Gemini returned an empty Insights response.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new GeminiError('invalid_json', 'Gemini output was not valid JSON.');
    }
    const validated = insightsAnalysisV2Schema.safeParse(parsed);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new GeminiError('schema', `Insights failed validation at ${issue.path.join('.')}: ${issue.message}`);
    }

    return { doc: assembleInsightsDoc(market, args.portfolio, pack, validated.data, model), rawText };
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if ((e as Error).name === 'AbortError') throw new GeminiError('timeout', 'Gemini request timed out (60s).');
    throw new GeminiError('network', `Gemini request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function geminiHttpError(res: Response): Promise<GeminiError> {
  let message = `Gemini API returned HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    message = j.error?.message ?? message;
  } catch { /* non-JSON body */ }
  if (res.status === 429) return new GeminiError('quota', message);
  if (res.status === 401 || res.status === 403) return new GeminiError('auth', message);
  if (res.status === 404) return new GeminiError('model', `Model unavailable: ${message}`);
  if (res.status === 400 && /api key/i.test(message)) return new GeminiError('auth', message);
  return new GeminiError('upstream', message);
}

/* ─────────────── Last-doc persistence ─────────────── */

const DOC_KEY = 'vaultfolio.aiinsights.v2';

export function loadLastInsights(): InsightsDoc | null {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'generatedAt' in (parsed as object)) {
      return parsed as InsightsDoc;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastInsights(doc: InsightsDoc): void {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch {
    /* storage full — regenerate is cheap */
  }
}

export function clearLastInsights(): void {
  try {
    localStorage.removeItem(DOC_KEY);
  } catch {
    /* noop */
  }
}