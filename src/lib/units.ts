import {
  GRAMS_PER_OZT,
  GRAMS_PER_TOLA,
  SQFT_PER_PERCH,
  SQM_PER_PERCH,
} from './types';

/**
 * Unit conversion utilities, centralized so no page duplicates math.
 */

export type MetalWeightUnit = 'g' | 'kg' | 'ozt' | 'tola';

export const METAL_WEIGHT_UNITS: { value: MetalWeightUnit; label: string }[] = [
  { value: 'g', label: 'grams (g)' },
  { value: 'kg', label: 'kilograms (kg)' },
  { value: 'ozt', label: 'troy ounces (oz t)' },
  { value: 'tola', label: 'tolas (SL juwelery standard)' },
];

export function toGrams(weight: number, unit: MetalWeightUnit): number {
  switch (unit) {
    case 'g':
      return weight;
    case 'kg':
      return weight * 1000;
    case 'ozt':
      return weight * GRAMS_PER_OZT;
    case 'tola':
      return weight * GRAMS_PER_TOLA;
    default:
      return weight;
  }
}

/**
 * Purity resolution. Supports gold karat strings (24k, 22K…), plain
 * fractions (.999, 0.9167) and named silver finenesses.
 */
export function purityFraction(purity: string): number | null {
  const p = (purity || '').toLowerCase().trim();
  if (!p) return null;
  const karat = p.match(/^(\d+(?:\.\d+)?)\s*k(?:arat)?$/);
  if (karat) return Math.min(24, Math.max(0, parseFloat(karat[1]))) / 24;
  const decimal = p.match(/^(0?\.\d+)$/); // .999 or 0.999
  if (decimal) return parseFloat(decimal[1]);
  const named: Record<string, number> = {
    fine: 1,
    '999.9': 0.999,
    '999': 0.999,
    britannia: 0.958,
    sterling: 0.925,
    '958': 0.958,
    '925': 0.925,
    '900': 0.9,
    '830': 0.83,
    '800': 0.8,
  };
  if (named[p] !== undefined) return named[p];
  const millesimal = p.match(/^\d{3}$/); // "916" style millesimal gold
  if (millesimal) {
    const n = parseInt(p, 10);
    if (n >= 80 && n <= 1000) return n / 1000;
  }
  const explicit = p.match(/^(\d{1,4})\s*\/\s*1000$/);
  if (explicit) return parseInt(explicit[1], 10) / 1000;
  return null;
}

export const GOLD_KARATS = ['24k', '22k', '21k', '18k', '14k', '9k'] as const;
export const SILVER_FINENESS = ['999.9', '999', '958', '925', '900'] as const;

/* ---- Land area ---- */
export type AreaUnit = 'perch' | 'sqft' | 'sqm';

export const AREA_UNITS: { value: AreaUnit; label: string }[] = [
  { value: 'perch', label: 'perches (Sri Lanka)' },
  { value: 'sqft', label: 'square feet (sq ft)' },
  { value: 'sqm', label: 'square meters (sq m)' },
];

export function perchesFromSqft(sqft: number): number {
  return sqft / SQFT_PER_PERCH;
}
export function sqftFromPerches(perches: number): number {
  return perches * SQFT_PER_PERCH;
}
export function sqmFromPerches(perches: number): number {
  return perches * SQM_PER_PERCH;
}
export function perchesFromSqm(sqm: number): number {
  return sqm / SQM_PER_PERCH;
}

export function formatArea(attrs: {
  sizePerches?: number | null;
  sizeSqft?: number | null;
  sizeSqm?: number | null;
}): string {
  const parts: string[] = [];
  if (attrs.sizePerches) parts.push(`${attrs.sizePerches} perches`);
  if (attrs.sizeSqft) parts.push(`${attrs.sizeSqft} sq ft`);
  if (attrs.sizeSqm) parts.push(`${attrs.sizeSqm} sq m`);
  return parts.join(' · ') || '—';
}
