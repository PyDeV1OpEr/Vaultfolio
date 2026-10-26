import { describe, expect, it } from 'vitest';
import {
  aeadDecrypt,
  aeadEncrypt,
  checkVerifier,
  deriveKek,
  freshKey,
  makeVerifier,
  fromHex,
  toHex,
  KDF_N,
} from './crypto';

/** Flip a bit inside a base64 payload without Node's Buffer. */
function flipBit(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  bytes[20] ^= 0xff;
  let outBin = '';
  for (const b of bytes) outBin += String.fromCharCode(b);
  return btoa(outBin);
}

describe('crypto', () => {
  it('round-trips AEAD encryption with domain separation', () => {
    const key = freshKey();
    const ct = aeadEncrypt(key, 'hello vaultfolio', 'test-domain');
    expect(ct).not.toContain('hello');
    expect(aeadDecrypt(key, ct, 'test-domain')).toBe('hello vaultfolio');
  });

  it('binds ciphertexts to their AAD — wrong domain fails', () => {
    const key = freshKey();
    const ct = aeadEncrypt(key, 'secret', 'domain-a');
    expect(() => aeadDecrypt(key, ct, 'domain-b')).toThrow();
  });

  it('rejects a wrong key', () => {
    const ct = aeadEncrypt(freshKey(), 'secret', '');
    expect(() => aeadDecrypt(freshKey(), ct, '')).toThrow();
  });

  it('detects tampered ciphertext', () => {
    const key = freshKey();
    const ct = aeadEncrypt(key, 'tamper-check', 'd');
    expect(() => aeadDecrypt(key, flipBit(ct), 'd')).toThrow();
  });

  it('produces a unique IV per encryption', () => {
    const key = freshKey();
    expect(aeadEncrypt(key, 'x', '')).not.toBe(aeadEncrypt(key, 'x', ''));
  });

  it('scrypt parameters hit the OWASP 64 MiB recommendation', () => {
    expect(KDF_N).toBe(32768);
  });

  it('derives the same KEK for the same secret+salt and a different one otherwise', () => {
    const salt = fromHex('aabbccdd00112233aabbccdd00112233');
    const a = deriveKek('correct horse', salt);
    const b = deriveKek('correct horse', salt);
    const c = deriveKek('battery staple', salt);
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(c)).not.toBe(toHex(a));
    expect(a).toHaveLength(32);
  });

  it('password verifiers round-trip and reject wrong secrets', () => {
    const rec = makeVerifier('p@ssw0rd-42');
    expect(checkVerifier('p@ssw0rd-42', rec)).toBe(true);
    expect(checkVerifier('p@ssw0rd-43', rec)).toBe(false);
    const rec2 = makeVerifier('p@ssw0rd-42');
    expect(rec2.salt).not.toBe(rec.salt); // unique salt per verifier
  });

  it('freshKey yields 32 fresh bytes', () => {
    expect(freshKey()).toHaveLength(32);
    expect(freshKey()).not.toEqual(freshKey());
  });
});
