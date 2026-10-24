import type { Asset, ValuationRecord } from './types';
import { buildDemoData } from './demo';

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

/* ---------------- Local (demo) adapter ---------------- */

const LOCAL_KEY = 'vaultfolio.local.v1';

interface LocalDoc extends DataBundle {}

export class LocalAdapter implements DataAdapter {
  readonly id = 'local' as const;

  async init(): Promise<DataBundle> {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      try {
        const doc = JSON.parse(raw) as LocalDoc;
        if (Array.isArray(doc.assets) && Array.isArray(doc.records)) return doc;
      } catch {
        /* fall through to fresh seed */
      }
    }
    const seed = buildDemoData();
    this.persist(seed);
    return seed;
  }

  private load(): LocalDoc {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as LocalDoc;
      } catch {
        /* ignore */
      }
    }
    return { assets: [], records: [] };
  }

  private persist(doc: LocalDoc) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(doc));
  }

  async addAsset(asset: Asset, record?: ValuationRecord) {
    const doc = this.load();
    doc.assets = [asset, ...doc.assets.filter((x) => x.id !== asset.id)];
    if (record) doc.records = [record, ...doc.records];
    this.persist(doc);
  }

  async updateAsset(asset: Asset, record?: ValuationRecord) {
    const doc = this.load();
    doc.assets = [asset, ...doc.assets.filter((x) => x.id !== asset.id)];
    if (record) doc.records = [record, ...doc.records];
    this.persist(doc);
  }

  async deleteAsset(assetId: string) {
    const doc = this.load();
    doc.assets = doc.assets.filter((x) => x.id !== assetId);
    doc.records = doc.records.filter((r) => r.assetId !== assetId);
    this.persist(doc);
  }

  async reset() {
    localStorage.removeItem(LOCAL_KEY);
    localStorage.removeItem('vaultfolio.market.cache.v1');
    return this.init();
  }
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
