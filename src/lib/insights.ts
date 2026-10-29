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

/* ─────────────── Prompt construction ─────────────── */

function buildInsightsPrompt(
  market: ReturnType<typeof buildSnapshot>,
  portfolio: PortfolioSnapshot,
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

  return `You are a careful metals-and-portfolio analyst writing a structured INSIGHTS brief for Vaultfolio, a personal physical-asset tracker.

STRICT RULES:
1. Use ONLY the numeric data in the JSON snapshot. Never invent prices, exchange rates, historical returns, news events, or portfolio balances. If something is absent, say so.
2. Distinguish DATA-GROUNDED statements from general interpretation and label interpretation in your wording. Confidence must match how thin the data is.
3. When observation counts are low or coverage_note fields are present, say so and use confidence "low" or "uncertain".
4. NEVER promise or predict guaranteed returns. Do not say any asset "will" rise or fall. Comments on direction are conditional and informational.
5. Do NOT recommend specific trades. Education and framing only.
6. Address the portfolio sections specifically (allocation, concentration) using only the supplied aggregates; if the portfolio has no valued assets, say the portfolio section cannot be assessed.
7. Every insight must mention or imply which data window it is based on (period values are in the snapshot).
8. Keep list items to one sentence each. Professional, plain language. No markdown inside fields.
9. When the FX rate is stale or missing from portfolio.fx, note that LKR conversions may be misleading.

Markets: last ${market.period} window. Portfolio asOf: ${portfolio.asOf}.

Verified snapshot:
${JSON.stringify(compact, null, 1)}`;
}

/* ─────────────── Model output parsing ─────────────── */

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
  return {
    type: 'OBJECT',
    properties: {
      market_overview: { type: 'STRING' },
      metals: { type: 'ARRAY', items: metalInsight },
      portfolio: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING' },
          allocation_comment: { type: 'STRING' },
          concentration_note: { type: 'STRING' },
        },
        required: ['summary', 'allocation_comment', 'concentration_note'],
      },
      risks: { type: 'ARRAY', items: { type: 'STRING' } },
      opportunities: { type: 'ARRAY', items: { type: 'STRING' } },
      tips: { type: 'ARRAY', items: { type: 'STRING' } },
      limitations: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['market_overview', 'metals', 'portfolio', 'risks', 'opportunities', 'tips', 'limitations'],
  };
}

/* ─────────────── Insights document ─────────────── */

export interface InsightsDoc {
  generatedAt: string;
  period: ReportPeriod;
  model: GeminiModel;
  marketSummary: string;
  metals: MetalInsight[];
  portfolio: { summary: string; allocationComment: string; concentrationNote: string };
  risks: string[];
  opportunities: string[];
  tips: string[];
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
  analysis: InsightsAnalysis,
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
    portfolio: {
      summary: sanitizeModelText(analysis.portfolio.summary),
      allocationComment: sanitizeModelText(analysis.portfolio.allocation_comment),
      concentrationNote: sanitizeModelText(analysis.portfolio.concentration_note),
    },
    risks: analysis.risks.map(sanitizeModelText),
    opportunities: analysis.opportunities.map(sanitizeModelText),
    tips: analysis.tips.map(sanitizeModelText),
    limitations: [
      ...analysis.limitations.map(sanitizeModelText),
      'Interpretations are Gemini output validated for structure, not audited for accuracy.',
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
  apiKey: string;
  model?: GeminiModel;
}): Promise<{ doc: InsightsDoc; rawText: string }> {
  const model = args.model ?? getSelectedModel();
  const market = buildSnapshot(args.history, args.period);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey.trim() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildInsightsPrompt(market, args.portfolio) }] }],
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
    const validated = insightsSchema.safeParse(parsed);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new GeminiError('schema', `Insights failed validation at ${issue.path.join('.')}: ${issue.message}`);
    }

    return { doc: assembleInsightsDoc(market, args.portfolio, validated.data, model), rawText };
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

const DOC_KEY = 'vaultfolio.aiinsights.v1';

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