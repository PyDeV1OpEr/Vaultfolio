import type { Asset, ValuationRecord } from './types';
import { aeadDecrypt, aeadEncrypt } from './crypto';

/**
 * Storage adapter interface. Two implementations:
 *  - LocalAdapter: browser-local demo mode (sample data + user records),
 *    persisted in localStorage under the user's device only.
 *  - SupabaseAdapter: authenticated Postgres with RLS.
 */

export interface DataBundle {
  assets: Asset[];
  records: ValuationRecord[];
}

export interface DataAdapter {
  readonly id: 'local' | 'supabase';
  /** Load all data for the current user, seeding demo data if local & empty. */
  init(): Promise<DataBundle>;
  addAsset(asset: Asset, record?: ValuationRecord): Promise<void>;
  updateAsset(asset: Asset, record?: ValuationRecord): Promise<void>;
  deleteAsset(assetId: string): Promise<void>;
}

/* ---------------- Encrypted local (offline-first) adapter ---------------- */

const VAULT_KEY = 'vaultfolio.vault.v1';
const LEGACY_LOCAL_KEY = 'vaultfolio.local.v1'; // pre-encryption local data (plaintext)

/** The plaintext portfolio document stored encrypted at rest. */
interface LocalDoc {
  assets: Asset[];
  records: ValuationRecord[];
}

/**
 * Offline-first local portfolio storage. The entire bundle is encrypted at
 * rest with the session DEK (AES-256-GCM); nothing is seeded automatically —
 * a new portfolio starts empty until the user adds assets (or loads the
 * explicitly-labeled sample dataset, which exists only for development).
 */
export class EncryptedLocalAdapter implements DataAdapter {
  readonly id = 'local' as const;

  constructor(
    private readonly dek: () => Uint8Array,
    private readonly store: {
      getItem(k: string): string | null;
      setItem(k: string, v: string): void;
      removeItem(k: string): void;
    } = localStorage,
  ) {}

  async init(): Promise<DataBundle> {
    const raw = this.store.getItem(VAULT_KEY);
    if (raw) {
      const doc = JSON.parse(raw) as import('./profile').EncryptedDoc;
      const plain = decryptDoc(this.dek(), doc);
      return { assets: plain.assets, records: plain.records };
    }
    // Legacy migration: import pre-encryption data (real user records only —
    // seeding demo data here is a development-only action elsewhere).
    if (this.store.getItem(LEGACY_LOCAL_KEY)) {
      try {
        const legacy = JSON.parse(this.store.getItem(LEGACY_LOCAL_KEY)!) as LocalDoc;
        const bundle = { assets: Array.isArray(legacy.assets) ? legacy.assets : [], records: Array.isArray(legacy.records) ? legacy.records : [] };
        this.persist(bundle);
        // Only purge the plaintext after a verified encrypted write.
        const check = this.dek();
        const written = JSON.parse(this.store.getItem(VAULT_KEY)!) as import('./profile').EncryptedDoc;
        decryptDoc(check, written);
        this.store.removeItem(LEGACY_LOCAL_KEY);
        return bundle;
      } catch {
        /* fall through to fresh vault; legacy data left untouched for manual recovery */
      }
    }
    return { assets: [], records: [] };
  }

  private read(): LocalDoc {
    const raw = this.store.getItem(VAULT_KEY);
    if (!raw) return { assets: [], records: [] };
    const doc = JSON.parse(raw) as import('./profile').EncryptedDoc;
    return decryptDoc(this.dek(), doc);
  }

  private persist(doc: LocalDoc) {
    this.store.setItem(VAULT_KEY, JSON.stringify(encryptDoc(this.dek(), doc)));
  }

  async addAsset(asset: Asset, record?: ValuationRecord) {
    const doc = this.read();
    doc.assets = [asset, ...doc.assets.filter((x) => x.id !== asset.id)];
    if (record) doc.records = [record, ...doc.records.filter((r) => r.id !== record.id)];
    this.persist(doc);
  }

  async updateAsset(asset: Asset, record?: ValuationRecord) {
    const doc = this.read();
    doc.assets = [asset, ...doc.assets.filter((x) => x.id !== asset.id)];
    if (record) doc.records = [record, ...doc.records.filter((r) => r.id !== record.id)];
    this.persist(doc);
  }

  async deleteAsset(assetId: string) {
    const doc = this.read();
    doc.assets = doc.assets.filter((x) => x.id !== assetId);
    doc.records = doc.records.filter((r) => r.assetId !== assetId);
    this.persist(doc);
  }

  /** Replace the whole portfolio (restore path); assumes validation happened upstream. */
  async replaceAll(bundle: LocalDoc) {
    this.persist({ assets: bundle.assets, records: bundle.records });
  }

  /** Wipe the encrypted vault (user-initiated Reset); returns an empty bundle. */
  async wipe() {
    this.store.removeItem(VAULT_KEY);
    this.store.removeItem('vaultfolio.market.cache.v1');
    return this.init();
  }

  /** Development-only: seed the clearly-labeled sample dataset. Never called in production boot. */
  async loadSampleData() {
    const { buildDemoData } = await import('./demo');
    const seed = buildDemoData();
    const doc = this.read();
    const hasExisting = doc.assets.length > 0 || doc.records.length > 0;
    const nextAssets = hasExisting ? [...seed.assets, ...doc.assets] : seed.assets;
    const nextRecords = hasExisting ? [...seed.records, ...doc.records] : seed.records;
    this.persist({ assets: nextAssets, records: nextRecords });
    return { assets: nextAssets, records: nextRecords } as DataBundle;
  }
}

/* ---------------- doc (de)hydration helpers ---------------- */

function encryptDoc(dek: Uint8Array, doc: LocalDoc): import('./profile').EncryptedDoc {
  return {
    v: 1,
    alg: 'AES-256-GCM',
    payload: aeadEncrypt(dek, JSON.stringify(doc), 'vf-vault-doc-v1'),
  };
}

function decryptDoc(dek: Uint8Array, doc: import('./profile').EncryptedDoc): LocalDoc {
  const parsed = JSON.parse(aeadDecrypt(dek, doc.payload, 'vf-vault-doc-v1')) as LocalDoc;
  if (!Array.isArray(parsed.assets) || !Array.isArray(parsed.records)) throw new Error('corrupt vault document');
  return parsed;
}

/* ---------------- Supabase adapter ---------------- */

export interface SupabaseClientLike {
  from(table: string): any;
  storage: {
    from(bucket: string): {
      getPublicUrl(path: string): { data: { publicUrl: string } | null };
      upload(path: string, blob: File | Blob): any;
      remove(paths: string[]): any;
    };
  };
}

export class SupabaseAdapter implements DataAdapter {
  readonly id = 'supabase' as const;
  readonly userId: string;
  private sb: import('@supabase/supabase-js').SupabaseClient;

  constructor(sb: import('@supabase/supabase-js').SupabaseClient, userId: string) {
    this.sb = sb;
    this.userId = userId;
  }

  async init(): Promise<DataBundle> {
    const [assetsRes, recordsRes] = await Promise.all([
      this.sb
        .from('vaultfolio_assets')
        .select('*')
        .order('created_at', { ascending: false }),
      this.sb
        .from('vaultfolio_valuations')
        .select('*')
        .order('recorded_at', { ascending: false }),
    ]);
    if (assetsRes.error) throw assetsRes.error;
    if (recordsRes.error) throw recordsRes.error;
    return {
      assets: assetsRes.data.map((r: any) => rowToAsset(r)),
      records: recordsRes.data.map((r: any) => rowToRecord(r)),
    };
  }

  async addAsset(asset: Asset, record?: ValuationRecord) {
    const res = await this.sb.from('vaultfolio_assets').insert(assetToRow(asset));
    if (res.error) throw res.error;
    if (record) await this.addRecord(record);
  }

  private async addRecord(record: ValuationRecord) {
    const res = await this.sb.from('vaultfolio_valuations').insert(recordToRow(record));
    if (res.error) throw res.error;
  }

  async updateAsset(asset: Asset, record?: ValuationRecord) {
    const res = await this.sb
      .from('vaultfolio_assets')
      .update(assetToRow(asset))
      .eq('id', asset.id);
    if (res.error) throw res.error;
    if (record) await this.addRecord(record);
  }

  async deleteAsset(assetId: string) {
    const res = await this.sb.from('vaultfolio_assets').delete().eq('id', assetId);
    if (res.error) throw res.error;
    await this.sb.from('vaultfolio_valuations').delete().eq('asset_id', assetId);
  }

  async uploadImage(assetId: string, userId: string, file: File): Promise<string | null> {
    const path = `${userId}/${assetId}/${file.name}`;
    const { error } = await this.sb.storage.from('asset-files').upload(path, file, { upsert: true });
    if (error) return null;
    const { data } = await this.sb.storage.from('asset-files').getPublicUrl(path);
    return data.publicUrl ?? null;
  }
}

/* ---------------- Row mapping ---------------- */

function assetToRow(a: Asset) {
  return {
    id: a.id,
    user_id: a.userId,
    category: a.category,
    name: a.name,
    status: a.status,
    attributes_json: a.attributes,
    purchase_price_lkr: a.purchase.priceLkr,
    purchase_currency: a.purchase.currency ?? 'LKR',
    purchase_price_original: a.purchase.priceOriginal,
    purchase_date: a.purchase.date,
    purchase_extra_costs_lkr: a.purchase.extraCostsLkr,
    valuation_value_lkr: a.valuation.valueLkr,
    valuation_method: a.valuation.method,
    valuation_source: a.valuation.sourceLabel,
    valuation_confidence: a.valuation.confidence,
    valuation_note: a.valuation.note,
    valuation_updated_at: a.valuation.updatedAt,
    resale_value_lkr: a.resaleValueLkr,
    notes: a.notes,
    image_url: a.image,
    sold_date: a.sold?.date ?? null,
    sale_proceeds_lkr: a.sold?.proceedsLkr ?? null,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

function rowToAsset(r: any): Asset {
  return {
    id: r.id,
    userId: r.user_id,
    category: r.category,
    name: r.name,
    status: r.status,
    attributes: r.attributes_json,
    purchase: {
      priceLkr: r.purchase_price_lkr,
      currency: r.purchase_currency ?? 'LKR',
      priceOriginal: r.purchase_price_original,
      date: r.purchase_date,
      extraCostsLkr: r.purchase_extra_costs_lkr,
    },
    valuation: {
      valueLkr: r.valuation_value_lkr,
      method: r.valuation_method,
      sourceLabel: r.valuation_source,
      confidence: r.valuation_confidence,
      note: r.valuation_note,
      updatedAt: r.valuation_updated_at,
    },
    resaleValueLkr: r.resale_value_lkr,
    notes: r.notes,
    image: r.image_url,
    sold: r.sold_date ? { date: r.sold_date, proceedsLkr: r.sale_proceeds_lkr } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function recordToRow(v: ValuationRecord) {
  return {
    id: v.id,
    asset_id: v.assetId,
    user_id: v.userId,
    value_lkr: v.valueLkr,
    method: v.method,
    source_label: v.sourceLabel,
    confidence: v.confidence,
    note: v.note,
    recorded_at: v.recordedAt,
  };
}

function rowToRecord(r: any): ValuationRecord {
  return {
    id: r.id,
    assetId: r.asset_id,
    userId: r.user_id,
    valueLkr: r.value_lkr,
    method: r.method,
    sourceLabel: r.source_label,
    confidence: r.confidence,
    note: r.note,
    recordedAt: r.recorded_at,
  };
}
