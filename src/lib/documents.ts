/**
 * Documents centre — offline-first storage layer.
 *
 * Design:
 *  - Document METADATA lives in the encrypted vault (EncryptedLocalAdapter),
 *    so it is encrypted at rest with the rest of the portfolio and travels
 *    inside the standard backup/restore flow.
 *  - Document BINARIES live in a dedicated blob store (IndexedDB) keyed by
 *    document id — never in the encrypted vault row, never in a database row,
 *    keeping vault payloads small and preview fast.
 *  - Files are validated by declared MIME type and size, and stored as opaque
 *    blobs. Nothing uploaded is ever executed; previews render via
 *    sandboxed <iframe> for PDFs and <img> for images.
 *  - Deleting a document never touches its linked asset, and deleting an asset
 *    leaves the document in place (it just becomes unlinked).
 */

import type { DocumentCategory, DocumentExpiryStatus, DocumentRecord } from './types';

/* ── Blob store (IndexedDB) ─────────────────────────────────────── */

const DOC_DB = 'vaultfolio-docs';
const DOC_STORE = 'files';
const DOC_DB_VERSION = 1;

function openDocDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DOC_DB, DOC_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Cannot open document store'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDocDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, mode);
      const req = fn(tx.objectStore(DOC_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Document store request failed'));
    });
  } finally {
    db.close();
  }
}

export const getDocBlob = (id: string) => withStore<Blob | undefined>('readonly', (s) => s.get(id));
export const putDocBlob = (id: string, blob: Blob) => withStore('readwrite', (s) => s.put(blob, id));
export const deleteDocBlob = (id: string) => withStore('readwrite', (s) => s.delete(id));

/* ── Validation ─────────────────────────────────────────────────── */

export const DOC_MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

export const DOC_ACCEPT = Object.keys(DOC_MIME_LABELS).join(',');

/** Defensive ceiling; IndexedDB can hold far more, but keeps exports sane. */
export const DOC_MAX_SIZE_BYTES = 25 * 1024 * 1024;

export interface DocFileValidation {
  ok: boolean;
  reason?: string;
  label: string;
}

export function validateDocFile(file: { name: string; type: string; size: number }): DocFileValidation {
  const label = DOC_MIME_LABELS[file.type] ?? file.type.split('/').pop()?.toUpperCase() ?? 'FILE';
  if (!file.name || file.name.length > 180) {
    return { ok: false, reason: 'File name is missing or too long.', label };
  }
  if (!(file.type in DOC_MIME_LABELS)) {
    return { ok: false, reason: `Unsupported file type (${label}). Allowed: PDF, JPG, JPEG, PNG, WebP.`, label };
  }
  if (file.size <= 0) {
    return { ok: false, reason: 'File is empty.', label };
  }
  if (file.size > DOC_MAX_SIZE_BYTES) {
    return { ok: false, reason: `File is larger than the ${Math.floor(DOC_MAX_SIZE_BYTES / (1024 * 1024))} MB limit.`, label };
  }
  return { ok: true, label };
}

/* Fixed category vocabulary surfaced in the UI. */
export const DOC_CATEGORIES: { id: DocumentCategory; label: string }[] = [
  { id: 'gold_certificate', label: 'Gold certificate' },
  { id: 'silver_certificate', label: 'Silver certificate' },
  { id: 'platinum_certificate', label: 'Platinum certificate' },
  { id: 'palladium_certificate', label: 'Palladium certificate' },
  { id: 'purchase_receipt', label: 'Purchase receipt' },
  { id: 'property_deed', label: 'Property deed' },
  { id: 'land_document', label: 'Land document' },
  { id: 'vehicle_registration', label: 'Vehicle registration' },
  { id: 'vehicle_insurance', label: 'Vehicle insurance' },
  { id: 'watch_certificate', label: 'Watch authenticity certificate' },
  { id: 'jewelry_certificate', label: 'Jewellery certificate' },
  { id: 'warranty', label: 'Warranty document' },
  { id: 'insurance', label: 'Insurance document' },
  { id: 'other', label: 'Other document' },
];

const CATEGORY_SET = new Set(DOC_CATEGORIES.map((c) => c.id as string));

/** Resolve a stored category value to its label (custom values pass through). */
export function docCategoryLabel(category: string): string {
  return CATEGORY_SET.has(category)
    ? DOC_CATEGORIES.find((c) => c.id === category)!.label
    : category;
}

export function isKnownCategory(category: string): boolean {
  return CATEGORY_SET.has(category);
}

/* ── Record construction / updates ──────────────────────────────── */

export function newDocumentId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface NewDocumentInput {
  userId: string;
  name: string;
  category: string;
  assetId: string | null;
  file: File;
  issuedAt?: string | null;
  expiresAt?: string | null;
  description?: string | null;
}

export interface NewDocumentRecord {
  record: DocumentRecord;
  blob: Blob;
}

/** Validate and build a document record + blob WITHOUT persisting anything. */
export async function buildDocument(input: NewDocumentInput): Promise<NewDocumentRecord> {
  const { file } = input;
  const validation = validateDocFile({ name: file.name, type: file.type, size: file.size });
  if (!validation.ok) throw new Error(validation.reason ?? 'File rejected.');

  const name = (input.name || file.name.replace(/\.[^.]+$/, '')).trim().slice(0, 120);
  if (!name) throw new Error('Document name is required.');
  const category = (input.category || 'other').trim().slice(0, 60) || 'other';
  if (!isKnownCategory(category) && category.length < 2) throw new Error('Category is required.');

  // Re-wrap the File as an opaque Blob: loaded content is never executed.
  const blob = new Blob([file], { type: file.type });
  const record: DocumentRecord = {
    id: newDocumentId(),
    userId: input.userId,
    name,
    category,
    assetId: input.assetId,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    addedAt: new Date().toISOString(),
    issuedAt: input.issuedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    description: input.description?.trim() ? input.description.trim() : null,
  };
  return { record, blob };
}

export type DocumentPatch = Partial<
  Pick<DocumentRecord, 'name' | 'category' | 'assetId' | 'issuedAt' | 'expiresAt' | 'description'>
>;

/** Merge a metadata patch, rejecting edits to immutable provenance fields. */
export function mergeDocumentPatch(record: DocumentRecord, patch: DocumentPatch): DocumentRecord {
  const next: DocumentRecord = { ...record };
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 120);
    if (!name) throw new Error('Document name is required.');
    next.name = name;
  }
  if (patch.category !== undefined) {
    const category = patch.category.trim().slice(0, 60) || 'other';
    if (!isKnownCategory(category) && category.length < 2) throw new Error('Category is required.');
    next.category = category;
  }
  if (patch.assetId !== undefined) next.assetId = patch.assetId || null;
  if (patch.issuedAt !== undefined) next.issuedAt = patch.issuedAt || null;
  if (patch.expiresAt !== undefined) next.expiresAt = patch.expiresAt || null;
  if (patch.description !== undefined)
    next.description = patch.description?.trim() ? patch.description.trim() : null;
  return next;
}

/* ── Expiry tracking ────────────────────────────────────────────── */

export const DOC_EXPIRY_WARNING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Classify a value-only date string (YYYY-MM-DD). Returns null when unset/invalid. */
export function expiryStatus(expiresAt: string | null, now = Date.now()): DocumentExpiryStatus | null {
  if (!expiresAt) return null;
  const t = new Date(`${expiresAt}T23:59:59.999Z`).getTime();
  if (Number.isNaN(t)) return null;
  if (t < now) return 'expired';
  if (t - now <= DOC_EXPIRY_WARNING_DAYS * DAY_MS) return 'expiring';
  return 'valid';
}

export function daysUntilExpiry(expiresAt: string, now = Date.now()): number {
  const t = new Date(`${expiresAt}T23:59:59.999Z`).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.ceil((t - now) / DAY_MS);
}

export function expiryHuman(status: DocumentExpiryStatus, expiresAt: string, now = Date.now()): string {
  if (status === 'expired') return `Expired ${-daysUntilExpiry(expiresAt, now)} day(s) ago`;
  const days = daysUntilExpiry(expiresAt, now);
  const future = new Date(`${expiresAt}T23:59:59.999Z`).getTime() >= now;
  return future ? `Expires in ${days} day(s)` : `Expired 0 day(s) ago`;
}

export function fileHumanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Persistence helpers (metadata goes through the caller) ─────── */

/**
 * Store a validated document: blob to the blob store, metadata through the
 * caller-supplied persistence callback. The blob write happens first so a
 * failed metadata write never loses the file (an orphan blob is cleaned on
 * the next delete pass / retry), and never leaves a record without its file.
 */
export async function persistDocument(
  built: NewDocumentRecord,
  writeRecord: (record: DocumentRecord) => Promise<void>,
): Promise<void> {
  await putDocBlob(built.record.id, built.blob);
  try {
    await writeRecord(built.record);
  } catch (err) {
    await deleteDocBlob(built.record.id).catch(() => undefined);
    throw err;
  }
}

/**
 * Delete a document's blob + metadata (metadata removal via the caller).
 * Metadata removal happens first so a failure leaves the blob only (harmless
 * orphan, cleaned by the next successful delete / housekeeping).
 */
export async function removeDocument(
  id: string,
  deleteRecord: () => Promise<void>,
): Promise<void> {
  await deleteRecord();
  await deleteDocBlob(id);
}

/**
 * Remove blob payloads that no longer have a metadata record (e.g. after a
 * partial crash or a restore from a backup taken before documents existed).
 * Best-effort; returns the number of payloads cleaned.
 */
export async function garbageCollectDocBlobs(liveIds: string[]): Promise<number> {
  const live = new Set(liveIds);
  const db = await openDocDatabase();
  try {
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = db.transaction(DOC_STORE, 'readonly').objectStore(DOC_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Document store request failed'));
    });
    const stale = keys.filter((k) => !live.has(String(k)));
    for (const k of stale) {
      await withStore('readwrite', (s) => s.delete(k)).catch(() => undefined);
    }
    return stale.length;
  } finally {
    db.close();
  }
}
