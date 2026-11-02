import { describe, it, expect } from 'vitest';
import {
  DOC_MAX_SIZE_BYTES,
  validateDocFile,
  docCategoryLabel,
  isKnownCategory,
  newDocumentId,
  mergeDocumentPatch,
  expiryStatus,
  daysUntilExpiry,
  expiryHuman,
  fileHumanSize,
} from './documents';
import type { DocumentRecord } from './types';

const day = 24 * 60 * 60 * 1000;

describe('validateDocFile', () => {
  const MB = 1024 * 1024;
  it.each([
    ['statement.pdf', 'application/pdf', 1200, true],
    ['scan.jpg', 'image/jpeg', 2 * MB, true],
    ['photo.png', 'image/png', 800, true],
    ['photo.webp', 'image/webp', 800, true],
  ])('accepts supported type %s', (name, type, size, ok) => {
    expect(validateDocFile({ name, type, size }).ok).toBe(ok);
  });

  it('rejects unsupported types without a fake pass', () => {
    const v = validateDocFile({ name: 'macro.docx', type: 'application/msword', size: 100 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Unsupported file type/);
  });

  it('rejects empty and oversize files', () => {
    expect(validateDocFile({ name: 'a.pdf', type: 'application/pdf', size: 0 }).ok).toBe(false);
    expect(
      validateDocFile({ name: 'big.pdf', type: 'application/pdf', size: DOC_MAX_SIZE_BYTES + 1 }).ok,
    ).toBe(false);
  });

  it('rejects missing names', () => {
    expect(validateDocFile({ name: '', type: 'application/pdf', size: 10 }).ok).toBe(false);
    expect(validateDocFile({ name: 'x'.repeat(200), type: 'application/pdf', size: 10 }).ok).toBe(false);
  });
});

describe('categories', () => {
  it('maps known ids to friendly labels and passes custom names through', () => {
    expect(docCategoryLabel('gold_certificate')).toBe('Gold certificate');
    expect(docCategoryLabel('My dealer receipt')).toBe('My dealer receipt');
    expect(isKnownCategory('vehicle_insurance')).toBe(true);
    expect(isKnownCategory('third-party-scan')).toBe(false);
  });
});

describe('mergeDocumentPatch', () => {
  const base: DocumentRecord = {
    id: 'd1',
    userId: 'u1',
    name: 'Deed',
    category: 'property_deed',
    assetId: null,
    fileName: 'deed.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    addedAt: '2026-01-01T00:00:00.000Z',
    issuedAt: null,
    expiresAt: null,
    description: null,
  };

  it('applies provided fields and normalises empties to null', () => {
    const next = mergeDocumentPatch(base, { name: '  Land deed  ', assetId: 'a9', description: '' });
    expect(next.name).toBe('Land deed');
    expect(next.assetId).toBe('a9');
    expect(next.description).toBeNull();
  });

  it('never lets a patch blank the name or category', () => {
    expect(() => mergeDocumentPatch(base, { name: '   ' })).toThrow();
    // A blank category falls back to the generic bucket rather than erroring.
    expect(mergeDocumentPatch(base, { category: ' ' }).category).toBe('other');
    expect(mergeDocumentPatch(base, { category: 'purchase_receipt' }).category).toBe('purchase_receipt');
  });

  it('leaves provenance fields untouched', () => {
    const next = mergeDocumentPatch(base, { name: 'Renamed' });
    expect(next.id).toBe(base.id);
    expect(next.userId).toBe(base.userId);
    expect(next.addedAt).toBe(base.addedAt);
    expect(next.fileName).toBe(base.fileName);
    expect(next.sizeBytes).toBe(base.sizeBytes);
  });
});

describe('expiry tracking', () => {
  const now = new Date('2026-11-02T12:00:00.000Z');

  it('returns null for unset or invalid dates', () => {
    expect(expiryStatus(null, now.getTime())).toBeNull();
    expect(expiryStatus('not-a-date', now.getTime())).toBeNull();
  });

  it('classifies expired / expiring / valid windows', () => {
    const t = now.getTime();
    expect(expiryStatus('2026-11-01', t)).toBe('expired');
    expect(expiryStatus('2026-11-04', t)).toBe('expiring'); // inside 30-day window
    expect(expiryStatus('2027-05-01', t)).toBe('valid');
  });

  it('counts days remaining using the full expiry day', () => {
    const t = now.getTime();
    expect(daysUntilExpiry('2026-11-02', t)).toBe(1); // expires end of same local day
    expect(daysUntilExpiry('2026-11-09', t)).toBe(8);
  });

  it('renders human wording for expired and future dates', () => {
    const t = now.getTime();
    expect(expiryHuman('expired', '2026-10-02', t)).toMatch(/Expired 30 day\(s\) ago/);
    expect(expiryHuman('expiring', '2026-11-04', t)).toMatch(/Expires in 3 day\(s\)/);
  });
});

describe('misc', () => {
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newDocumentId()));
    expect(ids.size).toBe(20);
  });

  it('formats human sizes', () => {
    expect(fileHumanSize(512)).toBe('512 B');
    expect(fileHumanSize(2048)).toBe('2.0 KB');
    expect(fileHumanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
