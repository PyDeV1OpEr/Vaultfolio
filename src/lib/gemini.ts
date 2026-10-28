import { z } from 'zod';
import { METAL_META, type MetalCode } from './marketWatch';

/**
 * Gemini report analysis — Phase 4 integration.
 *
 * Role boundaries (enforced in code, not just documented):
 *  - Gemini NEVER supplies market prices. The app builds a compact snapshot
 *    of its own provider-sourced observations and sends it as context.
 *  - Gemini returns a STRUCTURED analysis (native `responseSchema` JSON mode,
 *    not a "please return JSON" prompt) which is validated with zod before use.
 *  - Numeric values in the rendered report are re-assembled from the app's
 *    snapshot, never taken from model output (see reports.ts assembleReport).
 *  - Model text is rendered as React text nodes (no HTML injection surface)
 *    and is additionally sanitized of control characters before display.
 *
 * Key handling: the API key is supplied by the caller (user-configured,
 * stored encrypted under the vault DEK — see src/lib/credentials.ts). It is
 * sent via the `x-goog-api-key` header so it never appears in any URL that
 * could be logged.
 */

/* ─────────────────────────── Model / endpoint ─────────────────────────── */

export const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const REQUEST_TIMEOUT_MS = 60_000;

/* ─────────────────────────── Types ─────────────────────────── */

export type ReportPeriod = '24h' | '7d' | '30d' | '90d';

export type GeminiErrorKind =
  | 'no_key'
  | 'auth'       // 401/403 — key rejected
  | 'quota'      // 429 — rate limited or quota exhausted
  | 'request'    // 400 — malformed request (our bug or bad key format)
  | 'model'      // 404 — model unavailable for this key
  | 'upstream'   // 5xx
  | 'blocked'    // safety block on prompt or response
  | 'empty'      // 200 but no usable candidate
  | 'invalid_json'
  | 'schema'     // parsed JSON failed validation
  | 'timeout'
  | 'network';

export class GeminiError extends Error {
  kind: GeminiErrorKind;
  retryAfterMs: number | null;
  constructor(kind: GeminiErrorKind, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

/* ─────────────────────────── Snapshot schema (what we send) ─────────────────────────── */

export interface MetalSnapshot {
  symbol: MetalCode;
  metal: string;
  hasData: boolean;
  /** Latest verified provider observation, if any (may predate the window) */
  latestPrice: number | null;
  currency: 'USD';
  unit: string;
  quoteType: string | null;
  provider: string | null;
  providerTimestamp: string | null;
  observationCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  /** Change across the requested window, computed from REAL observations only */
  periodChange: {
    startPrice: number;
    endPrice: number;
    abs: number;
    pct: number | null;
    fromTime: string;
    toTime: string;
  } | null;
  /** Explicit honest note when coverage is thin for the window */
  coverageNote: string | null;
}

export interface MarketSnapshot {
  period: ReportPeriod;
  asOf: string;
  metals: MetalSnapshot[];
}

/* ─────────────────────────── Model output schema ─────────────────────────── */

const TREND = ['bullish', 'bearish', 'neutral', 'uncertain'] as const;
const CONFIDENCE = ['low', 'medium', 'high'] as const;
const RECOMMENDATION = ['hold', 'monitor', 'research_further', 'insufficient_data'] as const;
const DATA_QUALITY = ['verified', 'delayed', 'incomplete', 'stale'] as const;

const metalAnalysisSchema = z.object({
  symbol: z.enum(['XAU', 'XAG', 'XPT', 'XPD', 'XCU']),
  trend: z.enum(TREND),
  outlook: z.string().min(1),
  confidence: z.enum(CONFIDENCE),
  supporting_evidence: z.array(z.string().min(1)).max(10),
  risks: z.array(z.string().min(1)).max(10),
  recommendation: z.enum(RECOMMENDATION),
  reasoning_summary: z.string().min(1),
  data_quality: z.enum(DATA_QUALITY),
});

export const reportAnalysisSchema = z.object({
  market_summary: z.string().min(1),
  metals: z.array(metalAnalysisSchema).min(1).max(5),
  limitations: z.array(z.string().min(1)).max(15),
});

export type MetalAnalysis = z.infer<typeof metalAnalysisSchema>;
export type ReportAnalysis = z.infer<typeof reportAnalysisSchema>;

/* ─────────────────────────── Native structured-output schema ─────────────────────────── */

/**
 * Gemini `responseSchema` equivalent of the zod types (OpenAPI subset).
 * Enum constraints are declared in the schema itself so constrained values
 * are generated inside the model, then re-validated locally with zod.
 */
function geminiResponseSchema(): Record<string, unknown> {
  const metalAnalysis = {
    type: 'OBJECT',
    properties: {
      symbol: { type: 'STRING', enum: ['XAU', 'XAG', 'XPT', 'XPD', 'XCU'] },
      trend: { type: 'STRING', enum: TREND },
      outlook: { type: 'STRING' },
      confidence: { type: 'STRING', enum: CONFIDENCE },
      supporting_evidence: { type: 'ARRAY', items: { type: 'STRING' } },
      risks: { type: 'ARRAY', items: { type: 'STRING' } },
      recommendation: { type: 'STRING', enum: RECOMMENDATION },
      reasoning_summary: { type: 'STRING' },
      data_quality: { type: 'STRING', enum: DATA_QUALITY },
    },
    required: [
      'symbol', 'trend', 'outlook', 'confidence', 'supporting_evidence',
      'risks', 'recommendation', 'reasoning_summary', 'data_quality',
    ],
  };

  return {
    type: 'OBJECT',
    properties: {
      market_summary: { type: 'STRING' },
      metals: { type: 'ARRAY', items: metalAnalysis },
      limitations: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['market_summary', 'metals', 'limitations'],
  };
}

/* ─────────────────────────── Prompt construction ─────────────────────────── */

const PERIOD_HOURS: Record<ReportPeriod, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
};

/**
 * Build the analysis prompt. The snapshot is embedded verbatim as JSON so
 * every number Gemini reasons over is an app-verified value; the instructions
 * explicitly forbid inventing prices, news, or events that are not in the data.
 */
export function buildReportPrompt(snapshot: MarketSnapshot): string {
  const windowHours = PERIOD_HOURS[snapshot.period];

  // Compact snapshot: omit computation-only fields the model does not need.
  const compact = {
    period: snapshot.period,
    period_window_hours: windowHours,
    data_provenance:
      'Prices and period changes below were computed by Vaultfolio from real provider observations stored on the user’s device (GoldAPI.io and/or Goldsafe.io spot quotes, USD). They are the ONLY numeric market facts available to you.',
    metals: snapshot.metals.map((m) => ({
      symbol: m.symbol,
      metal: m.metal,
      price_usd: m.latestPrice,
      unit: m.unit,
      quote_type: m.quoteType,
      provider: m.provider,
      provider_timestamp: m.providerTimestamp,
      observation_count: m.observationCount,
      first_observed_at: m.firstObservedAt,
      last_observed_at: m.lastObservedAt,
      window_change: m.periodChange
        ? {
            from_price: m.periodChange.startPrice,
            to_price: m.periodChange.endPrice,
            abs: m.periodChange.abs,
            pct: m.periodChange.pct,
            from_time: m.periodChange.fromTime,
            to_time: m.periodChange.toTime,
          }
        : null,
      coverage_note: m.coverageNote,
    })),
  };

  return `You are a careful metals-market analyst writing a structured report for Vaultfolio, a personal physical-asset tracker.

STRICT RULES:
1. Use ONLY the numeric data in the JSON snapshot below. Never invent prices, indices, news events, macroeconomic data, or analyst opinions. If the data does not contain something, say so instead of guessing.
2. Base every trend/evidence statement on the actual numbers in the snapshot or general market-structure reasoning that you clearly label as interpretation. Distinguish DATA-GROUNDED evidence from INTERPRETATION in your wording.
3. Where observation counts are low or a coverage_note is present, treat the data as thin: use confidence "low" and recommendation "insufficient_data" when the window is too small to support a view.
4. Recommendations must be conditional and labelled as informational. Never promise future outcomes ("will fall", "will rise"). Use "hold", "monitor", "research_further", or "insufficient_data" only.
5. Cover every metal in the snapshot. Metals with hasData=false or no window_change should get recommendation "insufficient_data" and data_quality "stale" or "incomplete".
6. Do not include any numeric price figures in your output that are not directly derivable from the snapshot.
7. Keep evidence/risks concise (one sentence each, max 6 items per list). Write in clear, professional language. No markdown headings inside string fields.
8. Mention data freshness limitations in "limitations" (e.g., spot quotes may be delayed; observations accumulate at the user's configured fetch schedule).

Report period: the last ${windowHours} hours (period "${snapshot.period}").
Data as of: ${snapshot.asOf}.

Market snapshot (single source of truth):
${JSON.stringify(compact, null, 1)}`;
}

/* ─────────────────────────── Text sanitation ─────────────────────────── */

/** Strip control characters and zero-width chars from model text before display. */
export function sanitizeModelText(s: string): string {
  if (typeof s !== 'string') return '';
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\n{4,}/g, '\n\n\n');
}

/* ─────────────────────────── API call ─────────────────────────── */

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }>; role?: string };
  finishReason?: string;
}
interface GeminiApiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Call Gemini once for the whole report (never per metal) and return the
 * schema-validated analysis. Throws GeminiError with a precise kind for
 * every failure mode so the UI can render honest, actionable states.
 */
export async function runGeminiReport(
  snapshot: MarketSnapshot,
  apiKey: string,
): Promise<{ analysis: ReportAnalysis; rawText: string }> {
  if (!apiKey || apiKey.trim().length < 20) {
    throw new GeminiError('no_key', 'A Gemini API key is required to generate reports.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildReportPrompt(snapshot) }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: geminiResponseSchema(),
        },
        safetySettings: undefined,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let apiMessage = `Gemini API returned HTTP ${res.status}`;
      let status = '';
      try {
        const errBody = (await res.json()) as GeminiApiResponse;
        apiMessage = errBody.error?.message ?? apiMessage;
        status = errBody.error?.status ?? '';
      } catch {
        /* body not JSON: keep generic message */
      }

      if (res.status === 429) {
        const raHeader = res.headers.get('retry-after');
        const retrySecs = raHeader ? Number(raHeader) : null;
        const retryAfterMs =
          retrySecs !== null && Number.isFinite(retrySecs) && retrySecs >= 0
            ? Math.min(retrySecs * 1000, 24 * 60 * 60 * 1000)
            : null;
        throw new GeminiError(
          'quota',
          `Gemini quota/rate limit: ${apiMessage}`,
          retryAfterMs,
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new GeminiError('auth', `Gemini rejected the API key: ${apiMessage}`);
      }
      if (res.status === 400) {
        // Google uses 400 for a malformed key too — surface that as an auth problem.
        if (apiMessage.toLowerCase().includes('api key not valid')) {
          throw new GeminiError('auth', apiMessage);
        }
        throw new GeminiError('request', `Gemini rejected the request: ${apiMessage}`);
      }
      if (res.status === 404) {
        throw new GeminiError('model', `Gemini model unavailable (${GEMINI_MODEL}): ${apiMessage}`);
      }
      throw new GeminiError('upstream', apiMessage);
    }

    const body = (await res.json()) as GeminiApiResponse;

    const blockReason = body.promptFeedback?.blockReason;
    const candidate = body.candidates?.[0];
    if (blockReason && (!candidate || !candidate.content?.parts?.some((p) => p.text))) {
      throw new GeminiError('blocked', `Gemini blocked this request (${blockReason}).`);
    }
    const finishReason = candidate?.finishReason;
    const rawText = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!rawText.trim()) {
      if (finishReason && finishReason !== 'STOP') {
        throw new GeminiError(
          'blocked',
          `Gemini produced no content (finishReason: ${finishReason}).`,
        );
      }
      throw new GeminiError('empty', 'Gemini returned an empty response.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      throw new GeminiError(
        'invalid_json',
        `Gemini output was not valid JSON (${(e as Error).message.slice(0, 80)}).`,
      );
    }

    const validated = reportAnalysisSchema.safeParse(parsed);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new GeminiError(
        'schema',
        `Gemini output failed validation at ${issue.path.join('.')}: ${issue.message}`,
      );
    }

    return { analysis: validated.data, rawText };
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if ((e as Error).name === 'AbortError') {
      throw new GeminiError('timeout', `Gemini request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw new GeminiError('network', `Gemini request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Convenience: friendly explanation for UI display, per error kind. */
export function geminiErrorExplanation(kind: GeminiErrorKind): string {
  switch (kind) {
    case 'no_key': return 'No Gemini API key is configured. Add one in Settings → Gemini AI.';
    case 'auth': return 'The configured Gemini key was rejected. Check or replace it in Settings.';
    case 'quota': return 'The Gemini API quota was hit. Wait a moment and try again — your key is fine.';
    case 'request': return 'The report request was rejected (likely a temporary API schema mismatch). Try regenerating.';
    case 'model': return `The configured model (${GEMINI_MODEL}) is not available for this key.`;
    case 'upstream': return 'Google’s Gemini service had a temporary problem. Try again shortly.';
    case 'blocked': return 'Gemini’s safety systems declined this report. Try regenerating or adjust the period.';
    case 'empty': return 'Gemini returned an empty report. Try regenerating.';
    case 'invalid_json': return 'Gemini produced malformed output. The report was not saved. Try regenerating.';
    case 'schema': return 'Gemini’s analysis did not match the required report structure. The report was not saved.';
    case 'timeout': return 'The Gemini request timed out. Try regenerating.';
    case 'network': return 'Network error while contacting Gemini. Check your connection and try again.';
  }
}
