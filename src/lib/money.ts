import type { CurrencyCode } from './types';

/**
 * Money & format utilities, centralized. All internal amounts are LKR;
 * display conversion happens only here so no page duplicates math.
 */

export const SUPPORTED_CURRENCIES: { code: CurrencyCode; name: string; symbol: string }[] = [
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'LKR' },
  { code: 'USD', name: 'US Dollar', symbol: 'USD' },
];

export function formatNumber(value: number, locale = 'en-US', maxFraction = 2): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: maxFraction,
  }).format(value);
}

/** Display an LKR amount, optionally converted to the display currency. */
export function formatMoney(
  lkr: number | null | undefined,
  displayCurrency: CurrencyCode,
  usdLkr: number | null | undefined,
  locale = 'en-US',
): string {
  if (lkr === null || lkr === undefined || Number.isNaN(lkr)) return '—';
  let value = lkr;
  let prefix = 'LKR ';
  if (displayCurrency === 'USD') {
    value = toUsd(lkr, usdLkr);
    prefix = 'USD ';
  }
  const compact = Math.abs(value) >= 10_000_000 ? compactFormat(value) : formatNumber(Math.round(value * 100) / 100, locale, Math.abs(value) < 1000 && !Number.isInteger(value) ? 2 : 0);
  return `${prefix}${compact}`.replace(/^(\w+) -/, '-$1 ');
}

/** Compact display for tight card spaces: 1.65M, 42.5K etc. */
export function compactFormat(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
}

export function toUsd(lkr: number, usdLkr: number | null | undefined): number {
  if (!usdLkr || usdLkr <= 0) return lkr; // No rate configured: show LKR amount under USD label would be wrong; callers should guard.
  return lkr / usdLkr;
}

export function formatPercent(value: number | null | undefined, locale = 'en-US'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value * 100) + '%';
}

export function formatDate(iso: string | null | undefined, locale = 'en-US'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function formatDateTime(iso: string | null | undefined, locale = 'en-US'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function isStale(isoDate: string | null | undefined, staleAfterDays = 90): boolean {
  if (!isoDate) return true;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return true;
  return Date.now() - then > staleAfterDays * 86_400_000;
}

/** Safe numeric parse for form inputs: '' and garbage become null. */
export function parseNum(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
