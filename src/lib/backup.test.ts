import { describe, expect, it } from 'vitest';
import type { Asset, ValuationRecord } from './types';
import { buildBackup, parseBackup, type BackupFile } from './backup';

/** Flip a bit inside a base64 payload without Node's Buffer. */
function flipBit(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  bytes[bytes.length - 1] ^= 0xff;
  let outBin = '';
  for (const b of bytes) outBin += String.fromCharCode(b);
  return btoa(outBin);
}

const asset = (over: Partial<Asset> = {}): Asset =>
  ({
    id: 'a-1',
    userId: 'unais',
    category: 'gold',
    name: 'Gold bar',
    status: 'active',
    attributes: { weightGrams: 10, purity: '24k' },
    purchase: { priceLkr: 264500, priceOriginal: null, date: '2024-01-15', extraCostsLkr: 0 },
    valuation: {
      valueLkr: 300000,
      method: 'market',
      sourceLabel: 'manual',
      confidence: 'medium',
      note: null,
      updatedAt: '2024-06-01T00:00:00.000Z',
    },
    resaleValueLkr: 285000,
    notes: null,
    image: null,
    sold: null,
    createdAt: '2024-01-15T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    ...over,
  }) as unknown as Asset;

const record = (over: Partial<ValuationRecord> = {}): ValuationRecord =>
  ({
    id: 'r-1',
    assetId: 'a-1',
    userId: 'unais',
    valueLkr: 300000,
    method: 'market',
    sourceLabel: 'manual',
    confidence: 'medium',
    note: null,
    recordedAt: '2024-06-01T00:00:00.000Z',
    ...over,
  }) as unknown as ValuationRecord;

describe('backup', () => {
  it('round-trips a plaintext bundle', () => {
    const json = buildBackup({ assets: [asset()], records: [record()] });
    const out = parseBackup(json);
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0].name).toBe('Gold bar');
    expect(out.records).toHaveLength(1);
  });

  it('round-trips an encrypted bundle and hides the data', () => {
    const json = buildBackup({ assets: [asset()], records: [] }, { passphrase: 'secret-phrase-1' });
    expect(json).not.toContain('Gold bar');
    const out = parseBackup(json, { passphrase: 'secret-phrase-1' });
    expect(out.assets).toHaveLength(1);
  });

  it('rejects a wrong passphrase for encrypted backups', () => {
    const json = buildBackup({ assets: [asset()], records: [] }, { passphrase: 'right-phrase' });
    expect(() => parseBackup(json, { passphrase: 'wrong-phrase' })).toThrow();
  });

  it('demands a passphrase when one is required', () => {
    const json = buildBackup({ assets: [], records: [] }, { passphrase: 'right-phrase' });
    expect(() => parseBackup(json)).toThrow(/encrypted/);
  });

  it('detects a tampered encrypted payload', () => {
    const json = buildBackup({ assets: [asset()], records: [] }, { passphrase: 'mypassword' });
    const file = JSON.parse(json) as BackupFile;
    file.data = flipBit(file.data);
    expect(() => parseBackup(JSON.stringify(file), { passphrase: 'mypassword' })).toThrow();
  });

  it('refuses files that are not Vaultfolio backups', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow(/Not a valid Vaultfolio backup/);
    expect(() => parseBackup('not json at all')).toThrow();
  });

  it('validates record shapes on import', () => {
    const json = buildBackup({
      assets: [asset()],
      records: [record({ valueLkr: 'not-a-number' as unknown as number })],
    });
    expect(() => parseBackup(json)).toThrow();
  });

  it('writes the versioned manifest header', () => {
    const json = buildBackup({ assets: [], records: [] });
    const file = JSON.parse(json) as BackupFile;
    expect(file.format).toBe('vaultfolio-backup');
    expect(file.v).toBe(1);
    expect(file.encryption).toBe('none');
    expect(file.appVersion).toBeTruthy();
  });
});
