/**
 * Protected credentials — user-configured API secrets (currently: the user's
 * own Gemini API key for AI reports).
 *
 * Honesty note (documented in SECURITY.md): these are client-side
 * credentials. Vaultfolio is an offline-first browser/WebView app and there
 * is no Vaultfolio backend to hold them, so the safest available
 * implementation is envelope encryption at rest:
 *
 *  - The secret is encrypted with AES-256-GCM under a random 256-bit DEK.
 *  - In the normal unlocked-vault flow the DEK IS the vault DEK, so the key
 *    is sealed/unsealed together with the rest of the vault, in memory only.
 *  - Alternatively (e.g. while setting the key up from Settings) the vault's
 *    passphrase wraps the DEK with scrypt + a unique salt — the same
 *    envelope scheme the vault itself uses.
 *
 * What this model does NOT claim: protection against malware already running
 * with the user's privileges, or against a weak passphrase when the vault is
 * sealed but a passphrase-wrapped envelope persists. The key is therefore
 * recoverable from the local store by someone who already controls the
 * device AND the passphrase — never in plaintext at rest.
 */

import {
  aeadDecrypt,
  aeadEncrypt,
  checkVerifier,
  deriveKek,
  freshKey,
  fromHex,
  makeVerifier,
  toHex,
  DEFAULT_KDF,
} from './crypto';

export type CredentialKind = 'gemini-api-key';

export const BLOB_KEY = 'vaultfolio.credentials.v1';
const AAD_DEK = 'vf-cred-dek-wrap';
const AAD_SECRET = 'vf-cred-secret';

/** Scrypt parameters structurally as stored in a passphrase envelope. */
interface KdfRec {
  N: number;
  r: number;
  p: number;
}

/** Persisted per-credential envelope (shape validated before use). */
export interface CredentialEnvelope {
  secret: string;
  /** Present when the secret is passphrase-sealed; absent for vault-DEK mode. */
  wrap?: {
    saltHex: string;
    kdf: KdfRec;
    verifier: string; // hex scrypt verifier = KEK itself
    wrappedDek: string; // base64 AEAD(dek) under KEK
  };
}

function readBlob(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): Record<string, unknown> {
  try {
    const raw = storage.getItem(BLOB_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeBlob(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  blob: Record<string, unknown>,
): void {
  try {
    storage.setItem(BLOB_KEY, JSON.stringify(blob));
  } catch {
    /* storage full — leave existing blob untouched */
  }
}

function envelopeShapeOk(e: unknown): e is CredentialEnvelope {
  if (e === null || typeof e !== 'object') return false;
  const env = e as CredentialEnvelope;
  if (typeof env.secret !== 'string' || env.secret.length < 4) return false;
  if (env.wrap === undefined) return true;
  const w = env.wrap;
  return (
    typeof w.saltHex === 'string' && w.saltHex.length >= 16 &&
    typeof w.verifier === 'string' && w.verifier.length === 64 &&
    typeof w.wrappedDek === 'string' && w.wrappedDek.length > 0 &&
    typeof w.kdf === 'object' && w.kdf !== null &&
    Number.isInteger(w.kdf.N) && Number.isInteger(w.kdf.r) && Number.isInteger(w.kdf.p)
  );
}

/* ──────────────────────── Vault-DEK mode (preferred) ──────────────────────── */

/** Store the secret encrypted directly under the current unlocked vault DEK (hex). */
export function persistWithVaultDek(
  kind: CredentialKind,
  secret: string,
  dekHex: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): void {
  const dek = fromHex(dekHex); // sealing uses the live vault DEK, never a copy on disk
  const encrypted = aeadEncrypt(dek, secret, AAD_SECRET);
  const blob = readBlob(storage);
  // Vault-mode envelope has no `wrap`: there is no separate passphrase to seal it with.
  blob[kind] = { secret: encrypted } satisfies CredentialEnvelope;
  writeBlob(storage, blob);
}

/** Read the secret using the unlocked vault DEK (hex). */
export function loadWithVaultDek(
  kind: CredentialKind,
  dekHex: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): string | null {
  const envelope = readBlob(storage)[kind];
  if (!envelopeShapeOk(envelope)) return null;
  try {
    const dek = fromHex(dekHex);
    return envelope.wrap ? null : aeadDecrypt(dek, envelope.secret, AAD_SECRET);
  } catch {
    return null; // wrong DEK / tampered — treated as unsolved
  }
}

/* ──────────────────────── Passphrase-sealed mode ──────────────────────── */

/**
 * Store the secret with a passphrase (usually the vault passphrase while the
 * user has it entered, e.g. from Settings → Gemini AI).
 * Uses scrypt with a unique salt and an AEAD-wrapped random DEK — the same
 * envelope construction the vault itself uses.
 */
export function persistWithPassphrase(
  kind: CredentialKind,
  secret: string,
  passphrase: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): void {
  const verifierRec = makeVerifier(passphrase);
  const salt = fromHex(verifierRec.salt);
  const kek = deriveKek(passphrase, salt, verifierRec.params);
  const dek = freshKey();
  const wrappedDek = aeadEncrypt(kek, toHex(dek), AAD_DEK);
  const encrypted = aeadEncrypt(dek, secret, AAD_SECRET);
  const blob = readBlob(storage);
  blob[kind] = {
    secret: encrypted,
    wrap: {
      saltHex: verifierRec.salt,
      kdf: verifierRec.params,
      verifier: verifierRec.verifier,
      wrappedDek,
    },
  } satisfies CredentialEnvelope;
  writeBlob(storage, blob);
}

const kdfDefaults = DEFAULT_KDF;

/**
 * Read a passphrase-sealed secret. Returns null when the envelope is absent,
 * malformed, or the passphrase is wrong — callers cannot distinguish a wrong
 * password from a corrupted blob beyond the honest message: try again.
 */
export function loadWithPassphrase(
  kind: CredentialKind,
  passphrase: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): string | null {
  const envelope = readBlob(storage)[kind];
  if (!envelopeShapeOk(envelope) || !envelope.wrap) return null;
  const w = envelope.wrap;
  try {
    const salt = fromHex(w.saltHex);
    const kek = deriveKek(passphrase, salt, { ...kdfDefaults, ...w.kdf });
    if (!checkVerifier(passphrase, {
      params: { ...kdfDefaults, ...w.kdf },
      salt: w.saltHex,
      verifier: w.verifier,
    })) {
      return null; // wrong passphrase
    }
    const dekHex = aeadDecrypt(kek, w.wrappedDek, AAD_DEK);
    return aeadDecrypt(fromHex(dekHex), envelope.secret, AAD_SECRET);
  } catch {
    return null;
  }
}

/* ──────────────────────── Common API ──────────────────────── */

export function hasStoredCredential(
  kind: CredentialKind,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): boolean {
  const e = readBlob(storage)[kind];
  return envelopeShapeOk(e);
}

/** Best-effort metadata for the Settings UI. */
export function credentialSealMode(
  kind: CredentialKind,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): 'vault-dek' | 'passphrase' | null {
  const envelope = readBlob(storage)[kind];
  if (!envelopeShapeOk(envelope)) return null;
  return envelope.wrap ? 'passphrase' : 'vault-dek';
}

export function deleteCredential(
  kind: CredentialKind,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): boolean {
  const blob = readBlob(storage);
  const had = kind in blob;
  delete blob[kind];
  writeBlob(storage, blob);
  return had;
}
