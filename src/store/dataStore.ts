import { create } from 'zustand';
import type {
  AppSettings,
  Asset,
  MarketSnapshot,
  ManualPriceOverride,
  ValuationRecord,
  ValuationConfidence,
} from '../lib/types';
import { loadMarketData } from '../lib/market';
import { LocalAdapter, SupabaseAdapter, type DataAdapter } from '../lib/storage';
import { getSupabase, supabaseConfigured } from '../lib/supabase';

export type AppMode = 'loading' | 'demo' | 'signedOut' | 'cloud';
export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  body?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  displayCurrency: 'LKR',
  locale: 'en-US',
  theme: 'dark',
  ownerName: '',
};

const SETTINGS_KEY = 'vaultfolio.settings.v1';
const OVERRIDES_KEY = 'vaultfolio.overrides.v1';
const SESSION_SEEN_KEY = 'vaultfolio.session.seen.v1';
const MODE_PREF_KEY = 'vaultfolio.mode';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as T) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadSettings(): AppSettings {
  const s = readJson<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  if (s.locale === 'en-LK') s.locale = 'en-US'; // en-LK not reliably formatted in browsers
  return s;
}

function loadOverrides(): Partial<Record<ManualPriceOverride['kind'], number>> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { gold_per_gram?: number; silver_per_gram?: number; usd_lkr?: number };
    return {
      gold_per_gram: typeof parsed.gold_per_gram === 'number' ? parsed.gold_per_gram : undefined,
      silver_per_gram: typeof parsed.silver_per_gram === 'number' ? parsed.silver_per_gram : undefined,
      usd_lkr: typeof parsed.usd_lkr === 'number' ? parsed.usd_lkr : undefined,
    };
  } catch {
    return {};
  }
}

export const newId = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

interface DataState {
  mode: AppMode;
  demoDeclined: boolean;
  assets: Asset[];
  records: ValuationRecord[];
  settings: AppSettings;
  market: MarketSnapshot | null;
  overrides: Partial<Record<ManualPriceOverride['kind'], number>>;
  marketLoading: boolean;
  busy: boolean;
  error: string | null;
  toasts: Toast[];
  userEmail: string | null;
  adapter: DataAdapter | null;

  boot: () => Promise<void>;
  continueDemo: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  addAsset: (a: Omit<Asset, 'id' | 'userId' | 'createdAt' | 'updatedAt'>, opts?: { valuationRecord?: boolean; valuationNote?: string | null }) => Promise<string | null>;
  updateAsset: (id: string, patch: Partial<Asset>, opts?: { valuationRecord?: boolean; valuationNote?: string | null }) => Promise<boolean>;
  deleteAsset: (id: string) => Promise<boolean>;
  markSold: (id: string, saleDate: string | null, proceedsLkr: number | null) => Promise<boolean>;
  restoreFromSold: (id: string) => Promise<boolean>;
  archiveAsset: (id: string, archived: boolean) => Promise<boolean>;
  setSettings: (patch: Partial<AppSettings>) => void;
  setOverride: (kind: ManualPriceOverride['kind'], value: number | null) => void;
  refreshMarket: () => Promise<void>;
  resetDemo: () => Promise<void>;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useData = create<DataState>((set, get) => ({
  mode: 'loading',
  demoDeclined: false,
  assets: [],
  records: [],
  settings: loadSettings(),
  market: null,
  overrides: loadOverrides(),
  marketLoading: false,
  busy: false,
  error: null,
  toasts: [],
  userEmail: null,
  adapter: null,

  async boot() {
    // Boot decides the mode exactly once; explicit user choices (demo/sign-in)
    // must never be clobbered by this async check resolving later.
    if (get().mode !== 'loading') return;
    // 1) market data (works in every mode)
    get().refreshMarket().catch(() => {});
    // 2) an explicit demo preference always wins
    if (localStorage.getItem(MODE_PREF_KEY) === 'demo') {
      await get().continueDemo();
      return;
    }
    // 3) decide mode
    if (supabaseConfigured) {
      try {
        const sb = getSupabase();
        const { data } = await sb.auth.getSession();
        const session = data.session;
        if (session?.user) {
          set({ mode: 'cloud', userEmail: session.user.email ?? null });
          localStorage.setItem(MODE_PREF_KEY, 'cloud');
          const adapter = new SupabaseAdapter(sb, session.user.id);
          set({ adapter });
          const bundle = await adapter.init();
          set({ assets: bundle.assets, records: bundle.records, error: null });
          sb.auth.onAuthStateChange((e, s) => {
            if (e === 'SIGNED_OUT') {
              localStorage.removeItem(MODE_PREF_KEY);
              set({ mode: 'signedOut', assets: [], records: [], adapter: null, userEmail: null });
            }
          });
          return;
        }
        set({ mode: 'signedOut' });
        return;
      } catch (err) {
        set({ mode: 'demo', error: `Cloud connection failed — running in demo mode. ${(err as Error).message}` });
        const adapter = new LocalAdapter();
        const bundle = await adapter.init();
        set({ assets: bundle.assets, records: bundle.records, adapter });
        return;
      }
    }
    // Demo default; explicit mode preference processed above in boot().
    const seen = localStorage.getItem(SESSION_SEEN_KEY);
    if (!seen) {
      localStorage.setItem(SESSION_SEEN_KEY, '1');
      await get().continueDemo();
    } else {
      set({ mode: 'signedOut' });
    }
  },

  async continueDemo() {
    localStorage.setItem(MODE_PREF_KEY, 'demo');
    const adapter = new LocalAdapter();
    const bundle = await adapter.init();
    set({ mode: 'demo', adapter, assets: bundle.assets, records: bundle.records });
  },

  async signIn(email, password) {
    try {
      const sb = getSupabase();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return error.message;
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return 'Signed in but no session — try again.';
      set({ mode: 'cloud', userEmail: user.email ?? null });
      localStorage.setItem(MODE_PREF_KEY, 'cloud');
      const adapter = new SupabaseAdapter(sb, user.id);
      set({ adapter });
      const bundle = await adapter.init();
      set({ assets: bundle.assets, records: bundle.records });
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  },

  async signUp(email, password) {
    try {
      const sb = getSupabase();
      const { error } = await sb.auth.signUp({ email, password });
      if (error) return error.message;
      return 'Check your email to confirm the account, then sign in.';
    } catch (err) {
      return (err as Error).message;
    }
  },

  async signOut() {
    if (supabaseConfigured) {
      await getSupabase().auth.signOut();
    }
    localStorage.removeItem(MODE_PREF_KEY);
    set({ mode: 'signedOut', assets: [], records: [], adapter: null, userEmail: null });
  },

  async addAsset(input, opts) {
    const { adapter, mode } = get();
    if (!adapter) return null;
    const now = new Date().toISOString();
    const asset: Asset = {
      ...input,
      id: newId(),
      userId: mode === 'cloud' ? adapter.id && (adapter as SupabaseAdapter).userId || 'demo-user' : 'local-user',
      createdAt: now,
      updatedAt: now,
    } as Asset;
    const record: ValuationRecord | undefined = opts?.valuationRecord
      ? {
          id: newId(),
          assetId: asset.id,
          userId: asset.userId,
          valueLkr: asset.valuation.valueLkr ?? null,
          method: asset.valuation.method,
          sourceLabel: asset.valuation.sourceLabel,
          confidence: asset.valuation.confidence as ValuationConfidence,
          note: opts.valuationNote ?? null,
          recordedAt: now,
        }
      : undefined;
    set({ busy: true });
    try {
      await adapter.addAsset(asset, record);
      set((s) => ({
        assets: [asset, ...s.assets],
        records: record ? [record, ...s.records] : s.records,
      }));
      return asset.id;
    } catch (err) {
      set({ error: (err as Error).message });
      get().pushToast({ kind: 'error', title: 'Could not save asset', body: (err as Error).message });
      return null;
    } finally {
      set({ busy: false });
    }
  },

  async updateAsset(id, patch, opts) {
    const { assets, adapter } = get();
    const current = assets.find((a) => a.id === id);
    if (!current || !adapter) return false;
    const now = new Date().toISOString();
    const next: Asset = { ...current, ...patch, updatedAt: now };
    const valuationChanged =
      patch.valuation &&
      (patch.valuation.valueLkr !== current.valuation.valueLkr ||
        patch.valuation.method !== current.valuation.method);
    let record: ValuationRecord | undefined;
    if (opts?.valuationRecord || (valuationChanged && next.valuation.valueLkr != null)) {
      record = {
        id: newId(),
        assetId: next.id,
        userId: next.userId,
        valueLkr: next.valuation.valueLkr ?? null,
        method: next.valuation.method,
        sourceLabel: next.valuation.sourceLabel,
        confidence: next.valuation.confidence,
        note: opts?.valuationNote ?? null,
        recordedAt: now,
      };
    }
    set({ busy: true });
    try {
      await adapter.updateAsset(next, record);
      set((s) => ({
        assets: s.assets.map((a) => (a.id === id ? next : a)),
        records: record ? [record, ...s.records] : s.records,
      }));
      return true;
    } catch (err) {
      get().pushToast({ kind: 'error', title: 'Could not update asset', body: (err as Error).message });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async deleteAsset(id) {
    const { adapter, assets } = get();
    const target = assets.find((a) => a.id === id);
    if (!target || !adapter) return false;
    set({ busy: true });
    try {
      await adapter.deleteAsset(id);
      set((s) => ({
        assets: s.assets.filter((a) => a.id !== id),
        records: s.records.filter((r) => r.assetId !== id),
      }));
      return true;
    } catch (err) {
      get().pushToast({ kind: 'error', title: 'Could not delete asset', body: (err as Error).message });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async markSold(id, saleDate, proceedsLkr) {
    const { assets } = get();
    const a = assets.find((x) => x.id === id);
    if (!a) return false;
    const ok = await get().updateAsset(id, {
      status: 'sold',
      sold: { date: saleDate, proceedsLkr },
    });
    return ok;
  },

  async restoreFromSold(id) {
    return get().updateAsset(id, { status: 'active', sold: null });
  },

  async archiveAsset(id, archived) {
    return get().updateAsset(id, { status: archived ? 'archived' : 'active', sold: archived ? get().assets.find((a) => a.id === id)?.sold ?? null : get().assets.find((a) => a.id === id)?.sold ?? null });
  },

  setSettings(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  },

  setOverride(kind, value) {
    const next = { ...get().overrides };
    if (value === null || Number.isNaN(value)) delete next[kind];
    else next[kind] = value;
    set({ overrides: next });
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    get().refreshMarket();
  },

  async refreshMarket() {
    set({ marketLoading: true });
    try {
      const m = await loadMarketData(get().overrides);
      set({ market: m, marketLoading: false });
    } catch {
      set({ marketLoading: false });
    }
  },

  async resetDemo() {
    const adapter = get().adapter;
    if (adapter && adapter.id === 'local') {
      const bundle = await (adapter as LocalAdapter).reset();
      set({ assets: bundle.assets, records: bundle.records });
      get().pushToast({ kind: 'success', title: 'Demo data reset' });
    }
  },

  pushToast(t) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
}));

/** Convenience: assets the user actively owns. */
export const activeAssets = (s: DataState) => s.assets.filter((a) => a.status === 'active');
