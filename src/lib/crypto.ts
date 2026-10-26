import { scrypt } from '@noble/hashes/scrypt.js';
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { equalBytes, concatBytes } from '@noble/ciphers/utils.js';

export { equalBytes };

/**
 * Cryptographic foundation for Vaultfolio's offline-first local security.
 *
 * Libraries: @noble/hashes (scrypt password-based KDF) and
 * @noble/ciphers (AES-256-GCM authenticated encryption). Both are
 * maintained, audited JS libraries — no hand-rolled crypto.
 *
 * Principles enforced here:
 *  - Passwords/PINs are never stored — only scrypt verifiers with unique
 *    per-record salts are persisted.
 *  - All encryption is authenticated (GCM); any tampered ciphertext fails
 *    decryption instead of yielding garbage.
 *  - Keys are random 256-bit values; user secrets only ever derive
 *    key-encryption keys (KEKs), which wrap the data-encryption key (DEK).
 *  - Domain-separation AAD strings bind each ciphertext to its purpose.
 */

/** OWASP-recommended scrypt parameters for offline active workloads (64 MiB). */
export const KDF_N = 1 << 15; // 32768
export const KDF_r = 8;
export const KDF_p = 1;
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

export type KdfParams = { alg: 'scrypt'; N: number; r: number; p: number };

export const DEFAULT_KDF: KdfParams = { alg: 'scrypt', N: KDF_N, r: KDF_r, p: KDF_p };

const enc = new TextEncoder();
const dec = new TextDecoder();

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function fromUtf8(b: Uint8Array): string {
  return dec.decode(b);
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0) throw new Error('bad hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64(b: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < b.length; i += CHUNK) {
    bin += String.fromCharCode(...b.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Derive a 256-bit KEK from a user secret + salt using scrypt. */
export function deriveKek(
  secret: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF,
): Uint8Array {
  return scrypt(utf8(secret), salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: 32,
    maxmem: SCRYPT_MAXMEM,
  });
}

/** AES-256-GCM encrypt. Returns base64 iv+ct blob string bound to `aad`. */
export function aeadEncrypt(key: Uint8Array, plaintext: string, aad = ''): string {
  const iv = randomBytes(12);
  const cipher = gcm(key, iv, aad ? utf8(aad) : undefined);
  const ct = cipher.encrypt(utf8(plaintext));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv);
  blob.set(ct, iv.length);
  return toBase64(blob);
}

/** AES-256-GCM decrypt. Throws on wrong key, wrong AAD, or tampering. */
export function aeadDecrypt(key: Uint8Array, b64: string, aad = ''): string {
  const blob = fromBase64(b64);
  if (blob.length < 13) throw new Error('ciphertext too short');
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const cipher = gcm(key, iv, aad ? utf8(aad) : undefined);
  return fromUtf8(cipher.decrypt(ct));
}

export interface PasswordVerifier {
  params: KdfParams;
  salt: string; // hex
  /** scrypt output stored as hex — is itself the verifier (32 bytes entropy-equivalent). */
  verifier: string; // hex
}

/** Create a verifier record; the raw secret is immediately discardable. */
export function makeVerifier(secret: string): PasswordVerifier {
  const salt = randomBytes(16);
  const key = deriveKek(secret, salt);
  return { params: DEFAULT_KDF, salt: toHex(salt), verifier: toHex(key) };
}

export function checkVerifier(secret: string, rec: PasswordVerifier): boolean {
  try {
    const salt = fromHex(rec.salt);
    const key = deriveKek(secret, salt, rec.params);
    return equalBytes(key, fromHex(rec.verifier));
  } catch {
    return false;
  }
}

export function freshKey(): Uint8Array {
  return randomBytes(32);
}
