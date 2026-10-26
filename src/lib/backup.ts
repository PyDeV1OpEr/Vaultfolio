import { z } from 'zod';
import { aeadDecrypt, aeadEncrypt, toHex, fromHex, deriveKek, DEFAULT_KDF, type KdfParams } from './crypto';
import { randomBytes } from '@noble/hashes/utils.js';
import type { Asset, ValuationRecord } from './types';

/**
 * Backup/restore: a versioned, self-describing JSON manifest of the whole
 * portfolio bundle, optionally encrypted with a user passphrase
 * (scrypt-derived KEK → AES-256-GCM, matching the vault's own cryptography).
 *
 * The manifest is storage-agnostic: it contains app-domain records, not
 * storage rows, so restore works in the local (offline) adapter regardless
 * of where the backup came from.
 */

export const BACKUP_FORMAT = 'vaultfolio-backup';
export const BACKUP_VERSION = 1 as const;
const AAD_BACKUP = 'vf-backup-v1';
export const APP_VERSION = '1.0.0';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  v: typeof BACKUP_VERSION;
  createdAt: string;
  appVersion: string;
  encryption: 'none' | 'AES-256-GCM+scrypt';
  /** Present when encryption === 'AES-256-GCM+scrypt'. */
  kdf?: KdfParams;
  /** Hex salt for the passphrase KEK (encryption mode only). */
  salt?: string;
  /** Plaintext JSON document, or base64 iv+ct when encrypted. */
  data: string;
}

/* ---------------------- import validation schema ---------------------- */

const assetValidator = z.object({
  id: z.string().min(1),
  userId: z.string(),
  category: z.string(),
  name: z.string(),
  status: z.enum(['active', 'archived', 'sold']),
  attributes: z.record(z.unknown()),
  purchase: z.object({
    priceLkr: z.number().nullable(),
    priceOriginal: z.number().nullable(),
    currency: z.string().optional(),
    date: z.string().nullable(),
    extraCostsLkr: z.number().nullable(),
  }),
  valuation: z.object({
    valueLkr: z.number().nullable(),
    method: z.string(),
    sourceLabel: z.string().nullable(),
    confidence: z.string(),
    note: z.string().nullable(),
    updatedAt: z.string().nullable(),
  }),
  resaleValueLkr: z.number().nullable(),
  notes: z.string().nullable(),
  image: z.string().nullable(),
  sold: z.nullable(z.object({ date: z.string().nullable(), proceedsLkr: z.number().nullable() })),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const recordValidator = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  userId: z.string(),
  valueLkr: z.number().nullable(),
  method: z.string(),
  sourceLabel: z.string().nullable(),
  confidence: z.string(),
  note: z.string().nullable(),
  recordedAt: z.string(),
});

const manifestValidator = z.object({
  format: z.literal(BACKUP_FORMAT),
  v: z.literal(BACKUP_VERSION),
  createdAt: z.string(),
  appVersion: z.string(),
  encryption: z.enum(['none', 'AES-256-GCM+scrypt']),
  kdf: z
    .object({
      alg: z.literal('scrypt'),
      N: z.number().int().positive(),
      r: z.number().int().positive(),
      p: z.number().int().positive(),
    })
    .optional(),
  salt: z.string().optional(),
  data: z.string(),
});

/* ---------------------- build ---------------------- */

export function buildBackup(
  bundle: { assets: Asset[]; records: ValuationRecord[] },
  opts: { passphrase?: string } = {},
): string {
  const plaintext = JSON.stringify({ assets: bundle.assets, records: bundle.records });
  const salt = toHex(randomBytes(16));
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    v: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    encryption: opts.passphrase ? 'AES-256-GCM+scrypt' : 'none',
    ...(opts.passphrase ? { kdf: DEFAULT_KDF, salt } : {}),
    data: opts.passphrase
      ? aeadEncrypt(deriveKek(opts.passphrase, fromHex(salt)), plaintext, AAD_BACKUP)
      : plaintext,
  };
  return JSON.stringify(file, null, 2);
}

/* ---------------------- parse ---------------------- */

export function parseBackup(
  text: string,
  opts: { passphrase?: string } = {},
): { assets: Asset[]; records: ValuationRecord[] } {
  let manifest: BackupFile;
  try {
    manifest = manifestValidator.parse(JSON.parse(text)) as BackupFile;
  } catch (err) {
    throw new Error(`Not a valid Vaultfolio backup file. ${(err as Error).message}`);
  }

  let payload: { assets: Asset[]; records: ValuationRecord[] };
  if (manifest.encryption === 'none') {
    payload = JSON.parse(manifest.data);
  } else {
    if (!opts.passphrase) throw new Error('This backup is encrypted — enter its passphrase to restore.');
    if (!manifest.salt) throw new Error('Backup is missing its KDF salt and cannot be decrypted.');
    const kek = deriveKek(opts.passphrase, fromHex(manifest.salt), manifest.kdf ?? DEFAULT_KDF);
    payload = JSON.parse(aeadDecrypt(kek, manifest.data, AAD_BACKUP));
  }

  const doc = z
    .object({ assets: z.array(assetValidator), records: z.array(recordValidator) })
    .parse(payload);
  return doc as unknown as { assets: Asset[]; records: ValuationRecord[] };
}
