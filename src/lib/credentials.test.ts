import { describe, expect, it } from 'vitest';
import {
  persistWithVaultDek,
  loadWithVaultDek,
  hasStoredCredential,
  deleteCredential,
  BLOB_KEY,
  type CredentialKind,
} from './credentials';
import {
  persistWithPassphrase,
  loadWithPassphrase,
  credentialSealMode,
} from './credentials';

class FakeStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
}

const KIND: CredentialKind = 'gemini-api-key';

describe('credentials: vault-DEK mode', () => {
  it('round-trips a Gemini key under the vault DEK', () => {
    const s = new FakeStorage();
    const dek = 'a'.repeat(64);
    persistWithVaultDek(KIND, 'AIza-test-key-1234567890abcdef', dek, s);
    expect(loadWithVaultDek(KIND, dek, s)).toBe('AIza-test-key-1234567890abcdef');
    expect(credentialSealMode(KIND, s)).toBe('vault-dek');
  });

  it('never stores the plaintext secret in the blob', () => {
    const s = new FakeStorage();
    const dek = 'b'.repeat(64);
    persistWithVaultDek(KIND, 'AIza-PLAINTEXT-MARKER-1', dek, s);
    expect(s.getItem(BLOB_KEY)).not.toContain('PLAINTEXT');
  });

  it('fails cleanly with a different DEK instead of returning garbage', () => {
    const s = new FakeStorage();
    persistWithVaultDek(KIND, 'sk-test', 'c'.repeat(64), s);
    const wrong = 'd'.repeat(64);
    expect(loadWithVaultDek(KIND, wrong, s)).toBeNull();
  });

  it('vault-mode envelope must not have a wrap field (only passphrase envelopes do)', () => {
    const s = new FakeStorage();
    persistWithVaultDek(KIND, 'x', 'e'.repeat(64), s);
    const parsed = JSON.parse(s.getItem(BLOB_KEY)!) as Record<string, { wrap?: unknown }>;
    expect(parsed[KIND].wrap).toBeUndefined();
  });
});

describe('credentials: passphrase mode', () => {
  it('round-trips with the correct passphrase and rejects a wrong one', () => {
    const s = new FakeStorage();
    persistWithPassphrase(KIND, 'AIza-pass-sealed', 'correct horse', s);
    expect(loadWithPassphrase(KIND, 'correct horse', s)).toBe('AIza-pass-sealed');
    expect(loadWithPassphrase(KIND, 'wrong horse', s)).toBeNull();
  });

  it('scrypt-derives a fresh salt per save (two saves produce different envelopes)', () => {
    const s = new FakeStorage();
    persistWithPassphrase(KIND, 'first', 'pw', s);
    const first = s.getItem(BLOB_KEY);
    persistWithPassphrase(KIND, 'second', 'pw', s);
    const second = s.getItem(BLOB_KEY);
    const parsed = JSON.parse(second!) as Record<string, { wrap?: { saltHex: string } }>;
    const parsed1 = JSON.parse(first!) as Record<string, { wrap?: { saltHex: string } }>;
    expect(parsed[KIND].wrap!.saltHex).not.toBe(parsed1[KIND].wrap!.saltHex);
  });

  it('migrates: saving with a vault DEK then re-saving with a passphrase updates the seal mode', () => {
    const s = new FakeStorage();
    persistWithDekThenPassphrase(s);
    expect(credentialSealMode(KIND, s)).toBe('passphrase');
    expect(loadWithPassphrase(KIND, 'pw', s)).toBe('final-key');
    expect(loadWithPassphrase(KIND, 'banana', s)).toBeNull();
  });

  function persistWithDekThenPassphrase(s: FakeStorage): void {
    persistWithVaultDek(KIND, 'old-key', 'f'.repeat(64), s);
    expect(credentialSealMode(KIND, s)).toBe('vault-dek');
    persistWithPassphrase(KIND, 'final-key', 'pw', s);
  }
});

describe('credential lifecycle', () => {
  it('tracks existence and deletion without leaking the secret into the blob key', () => {
    const s = new FakeStorage();
    expect(hasStoredCredential(KIND, s)).toBe(false);
    persistWithPassphrase(KIND, 'AIza-x', 'pw', s);
    expect(hasStoredCredential(KIND, s)).toBe(true);
    expect(deleteCredential('gemini-api-key', s)).toBe(true);
    expect(hasStoredCredential(KIND, s)).toBe(false);
    expect(deleteCredential(KIND, s)).toBe(false);
  });

  it('tolerates a corrupted blob by reporting nothing stored', () => {
    const s = new FakeStorage();
    s.setItem(BLOB_KEY, 'not json at all {');
    expect(hasStoredCredential(KIND, s)).toBe(false);
    expect(loadWithPassphrase(KIND, 'pw', s)).toBeNull();
  });

  it('tolerates a semi-valid envelope with garbage fields', () => {
    const s = new FakeStorage();
    s.setItem(BLOB_KEY, JSON.stringify({ [KIND]: { secret: '', wrap: { saltHex: 'zz' } } }));
    expect(hasStoredCredential(KIND, s)).toBe(false);
  });
});
