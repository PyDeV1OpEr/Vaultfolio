import { z } from 'zod';
import {
  GEMINI_MODEL,
  GeminiError,
  sanitizeModelText,
  type GeminiErrorKind,
} from './gemini';

/**
 * Valuation Centre — AI appraisal.
 *
 * Role boundaries (same discipline as reports/insights, adapted to single
 * asset appraisals):
 *  - The app builds a compact, verified payload: asset facts, the user's
 *    follow-up answers, and (for metals) deterministic MarketWatch numbers.
 *  - The model returns an OPINION + range, structured by a native JSON
 *    schema, and references market patterns from its broad knowledge of the
 *    relevant market. Every evidence line the model produces is labelled
 *    'model_knowledge' (never presented as a verified transaction) unless
 *    the entry is user_supplied.
 *  - The application clamps the range: expected ∈ [low, high]; all three
 *    converted to LKR app-side so the model never prices the vault's currency.
 */

const EVIDENCE_KINDS = ['verified', 'model_knowledge', 'user_supplied'] as const;
const CONFIDENCE = ['low', 'medium', 'high'] as const;

export interface AppraisalFact {
  key: string;
  value: string;
}

export interface AppraisalPayload {
  categoryLabel: string; // "Luxury watch", "Land in Sri Lanka", …
  assetName: string;
  facts: AppraisalFact[]; // asset record facts the app already knows
  answers: AppraisalFact[]; // user-supplied follow-up answers
  skippedQuestionLabels: string[]; // asked but unanswered
  /** Deterministic market context lines (metals: MarketWatch-derived). */
  marketContext: string[];
  /** Whether the app has verified numeric market data to back any number. */
  hasVerifiedMarketData: boolean;
  originalCurrency: 'LKR' | 'USD';
  purchasePrice: string | null; // display string, never re-derived numbers
}

const evidenceSchema = z.object({
  description: z.string().min(4).max(240),
  source_kind: z.enum(EVIDENCE_KINDS),
  listed_or_sold: z.enum(['ask', 'sale', 'n/a']).default('n/a'),
  detail: z.string().max(240).optional().nullable(),
});

export const appraisalOutputSchema = z.object({
  low_estimate_original: z.number().positive(),
  expected_estimate_original: z.number().positive(),
  high_estimate_original: z.number().positive(),
  confidence: z.enum(CONFIDENCE),
  methodology: z.string().min(10).max(600),
  evidence: z.array(evidenceSchema).min(0).max(8),
  positive_factors: z.array(z.string().min(3).max(160)).max(6).default([]),
  negative_factors: z.array(z.string().min(3).max(160)).max(6).default([]),
  explanation: z.string().min(20).max(900),
  missing_information_impact: z.string().max(400).default(''),
  insufficient_for_estimate: z.boolean(),
});

export type AppraisalOutput = z.infer<typeof appraisalOutputSchema>;

export interface ValidatedAppraisal extends AppraisalOutput {
  /** Post-clamp ordering guarantees (all three positive, low ≤ expected ≤ high). */
  clamped: boolean;
  sanitizedOutput: {
    methodology: string;
    explanation: string;
    missing_information_impact: string;
    evidence: z.infer<typeof evidenceSchema>[];
    positive_factors: string[];
    negative_factors: string[];
  };
}

function geminiRequestSchema(): Record<string, unknown> {
  const evidence = {
    type: 'OBJECT',
    properties: {
      description: { type: 'STRING' },
      source_kind: { type: 'STRING', enum: EVIDENCE_KINDS },
      listed_or_sold: { type: 'STRING', enum: ['ask', 'sale', 'n/a'] },
      detail: { type: 'STRING' },
    },
    required: ['description', 'source_kind', 'listed_or_sold'],
  };
  return {
    type: 'OBJECT',
    properties: {
      low_estimate_original: { type: 'NUMBER' },
      expected_estimate_original: { type: 'NUMBER' },
      high_estimate_original: { type: 'NUMBER' },
      confidence: { type: 'STRING', enum: CONFIDENCE },
      methodology: { type: 'STRING' },
      evidence: { type: 'ARRAY', items: evidence },
      positive_factors: { type: 'ARRAY', items: { type: 'STRING' } },
      negative_factors: { type: 'ARRAY', items: { type: 'STRING' } },
      explanation: { type: 'STRING' },
      missing_information_impact: { type: 'STRING' },
      insufficient_for_estimate: { type: 'BOOLEAN' },
    },
    required: [
      'low_estimate_original', 'expected_estimate_original', 'high_estimate_original',
      'confidence', 'methodology', 'evidence', 'positive_factors', 'negative_factors',
      'explanation', 'missing_information_impact', 'insufficient_for_estimate',
    ],
  };
}

const CATEGORY_RULES: Record<string, string> = {
  'Luxury watch': 'Distinguish ADVERTISED ASKING prices from completed sale patterns in your reasoning. Never treat listings as guaranteed resale proceeds.',
  'Land': 'Reason about the surrounding-market value per unit of land (perches where relevant), access, frontage and infrastructure. State that you cannot verify deeds, boundaries or title.',
  'Vehicle': 'Depreciate by age and mileage band for the make/model/variant, adjust for condition and accident history. Never quote an estimated price as an official market price.',
  'Gemstone': 'Do NOT authenticate the gem. Colour/clarity/certification presence affect confidence; uncertified stones must reduce confidence explicitly.',
  'Fine metal': 'NO model estimate is needed for raw content; the app computed it. Only comment on premium/resale context. Do not output an estimate range that disagrees with the app-computed content value unless the user supplied extra premium evidence.',
  'Other': 'Base the estimate on the described provenance, maker/era and comparably noted patterns. Flag unverified provenance explicitly.',
};

export function buildAppraisalPrompt(payload: AppraisalPayload): string {
  const categoryRule = CATEGORY_RULES[payload.categoryLabel] ?? CATEGORY_RULES['Other'];
  return `You are a careful appraiser for Vaultfolio, a personal physical-asset tracker. Estimate the current realistic market value of ONE asset.

STRICT RULES:
1. Use ONLY the facts in the payload. Never invent measurements, certificates, serials, or market data events that are not there.
2. Your numeric range is an OPINION built on broad knowledge of typical market patterns for the described asset. Every evidence line you list that is not user-supplied must use source_kind "model_knowledge" — describe the pattern in words (no URLs you cannot verify, no fake document numbers).
3. If the supplied information is too thin to responsibly produce even a wide range, set insufficient_for_estimate=true, keep the range wide, use confidence "low", and explain exactly what missing fact drives the width.
4. Estimates are in ${payload.originalCurrency}. low ≤ expected ≤ high must hold (you will be clamped anyway if violated).
5. Never promise resale proceeds; distinguish asking vs completed-sale evidence patterns; never label your estimate as an appraisal substitute for a professional valuation.
6. Skipped questions below were unknown to the user; mention the most valuation-relevant skips in missing_information_impact rather than penalising twice.
7. Keep each evidence/factor line to one clear sentence.

CATEGORY-SPECIFIC GUIDANCE:
${categoryRule}

ASSET:
name: ${payload.assetName}
category: ${payload.categoryLabel}
purchase price (recorded by owner, for context only — never set the estimate equal to it mechanically): ${payload.purchasePrice ?? 'not recorded'}

KNOWN FACTS (from the asset record):
${payload.facts.map((f) => `- ${f.key}: ${f.value}`).join('\n') || '- (none beyond the name)'}

FOLLOW-UP ANSWERS (user supplied in this session):
${payload.answers.map((f) => `- ${f.key}: ${f.value}`).join('\n') || '- (none)'}

ASKED BUT SKIPPED:
${payload.skippedQuestionLabels.join('; ') || '(nothing skipped)'}

VERIFIED MARKET CONTEXT computed by the app (only for metals; trust these numbers over your priors):
${payload.marketContext.join('\n') || '(none available)'}
has_verified_market_data: ${payload.hasVerifiedMarketData}`;

}

/* ─────────────────────────── API call ─────────────────────────── */

const REQUEST_TIMEOUT_MS = 60_000;

export async function runGeminiAppraisal(
  payload: AppraisalPayload,
  apiKey: string,
): Promise<ValidatedAppraisal> {
  if (!apiKey || apiKey.trim().length < 20) {
    throw new GeminiError('no_key', 'A Gemini API key is required to provide an AI valuation.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildAppraisalPrompt(payload) }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: geminiRequestSchema(),
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let apiMessage = `Gemini API returned HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: { message?: string } };
        apiMessage = errBody.error?.message ?? apiMessage;
      } catch { /* not json */ }
      if (res.status === 429) throw new GeminiError('quota', `Gemini quota/rate limit: ${apiMessage}`);
      if (res.status === 401 || res.status === 403) throw new GeminiError('auth', `Gemini rejected the API key: ${apiMessage}`);
      if (res.status === 404) throw new GeminiError('model', `Gemini model unavailable (${GEMINI_MODEL})`);
      throw new GeminiError('upstream', apiMessage);
    }
    const text = await readCandidateText(res);
    const parsed = parseAndValidate(text);
    return parsed;
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if ((e as Error).name === 'AbortError') throw new GeminiError('timeout', 'The Gemini request timed out.');
    throw new GeminiError('network', `Gemini request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── Validation helpers ─────────────────────────── */

interface GeminiBody {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

async function readCandidateText(res: Response): Promise<string> {
  const body = (await res.json()) as GeminiBody;
  const blockReason = body.promptFeedback?.blockReason;
  const candidate = body.candidates?.[0];
  if (blockReason && !candidate?.content?.parts?.some((p) => p.text)) {
    throw new GeminiError('blocked', `Gemini blocked this appraisal (${blockReason}).`);
  }
  const raw = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!raw.trim()) {
    const reason = candidate?.finishReason;
    throw new GeminiError('empty', reason && reason !== 'STOP' ? `Gemini produced no content (finishReason: ${reason}).` : 'Gemini returned an empty appraisal.');
  }
  return raw;
}

/** Exposed for unit tests: raw model text → validated, clamped, sanitised appraisal. */
export function parseAndValidate(rawText: string): ValidatedAppraisal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    throw new GeminiError('invalid_json', `Gemini output was not valid JSON (${(e as Error).message.slice(0, 80)}).`);
  }
  const validated = appraisalOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    throw new GeminiError('schema', `Gemini appraisal failed validation at ${issue.path.join('.')}: ${issue.message}`);
  }
  let clamped = false;
  let out = validated.data;
  // Clamp ordering: low ≤ expected ≤ high, all positive.
  let low = out.low_estimate_original;
  let expected = out.expected_estimate_original;
  let high = out.high_estimate_original;
  if (!(low > 0) || !(high > 0) || !(expected > 0)) {
    throw new GeminiError('schema', 'Gemini appraisal produced a non-positive estimate.');
  }
  if (high < expected) { high = expected; clamped = true; }
  if (low > expected) { low = expected; clamped = true; }
  if (high < low) { high = low; clamped = true; }
  out = {
    ...out,
    low_estimate_original: low,
    expected_estimate_original: expected,
    high_estimate_original: high,
  };
  const sanitized = {
    methodology: sanitizeModelText(out.methodology),
    explanation: sanitizeModelText(out.explanation),
    missing_information_impact: sanitizeModelText(out.missing_information_impact ?? ''),
    evidence: out.evidence,
    positive_factors: out.positive_factors.map(sanitizeModelText),
    negative_factors: out.negative_factors.map(sanitizeModelText),
  };
  return { ...out, clamped, sanitizedOutput: sanitized };
}

export { type GeminiErrorKind };
