import { create } from 'zustand';
import { z } from 'zod';
import type { AppSettings, Asset, MarketSnapshot, ManualPriceOverride, DocumentRecord, ValuationRecord, ValuationConfidence, ValuationMethod } from '../lib/types';
import { loadValuationPrefs, saveValuationPrefs, type ValuationPrefs } from '../lib/appraisal';
import { loadMarketData } from '../lib/market';
import { syncObservationsIfDue } from '../lib/marketWatch';
import { EncryptedLocalAdapter, SupabaseAdapter, DataAdapter } from '../lib/storage';
import { getSupabase, supabaseConfigured } from '../lib/supabase';
import { ProfileStore } from '../lib/profile';
import { fromHex } from '../lib/crypto';
import { buildBackup, parseBackup } from '../lib/backup';
import { deleteDocBlob, getDocBlob, putDocBlob, persistDocument, mergeDocumentPatch, type NewDocumentRecord } from '../lib/documents';
import {
  hasStoredCredential,
  loadWithPassphrase,
  loadWithVaultDek,
  persistWithPassphrase,
  persistWithVaultDek,
  deleteCredential,
} from '../lib/credentials';

const KIND_GEMINI = 'gemini-api-key' as const;

/**
 * Application session modes (offline-first):
 *
 *   loading      boot in progress
 *   onboarding   no profile exists on this device yet
 *   locked       profile exists, vault sealed (DEK not in memory)
 *   local        unlocked offline-first session; data encrypted at rest
 *   signedOut    cloud configured but no session (optional Supabase web flow)
 *   cloud        signed-in Supabase session
 *   demo         development-only sample dataset; NEVER a production mode
 */
export type AppMode = 'loading' | 'onboarding' | 'locked' | 'local' | 'signedOut' | 'cloud' | 'demo';

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
  assets: Asset[];
  records: ValuationRecord[];
  /** Documents-centre metadata (binaries live in the local blob store). */
  documents: DocumentRecord[];
  /** Valuation Centre reassessment preferences. */
  valuationPrefs: ValuationPrefs;
  settings: AppSettings;
  market: MarketSnapshot | null;
  overrides: Partial<Record<ManualPriceOverride['kind'], number>>;
  marketLoading: boolean;
  busy: boolean;
  error: string | null;
  toasts: Toast[];
  userEmail: string | null;
  profileName: string | null;
  adapter: DataAdapter | null;

  boot: () => Promise<void>;
  createProfile: (input: {
    username: string;
    password: string;
    displayName?: string | null;
    currency?: 'LKR' | 'USD';
    pin?: string | null;
  }) => Promise<string | null>;
  unlockWithPassword: (password: string) => Promise<string | null>;
  unlockWithPin: (pin: string) => Promise<string | null>;
  registerPin: (pin: string) => string | null;
  changePin: (currentPin: string, newPin: string) => Promise<string | null>;
  removePin: (currentPin: string) => Promise<string | null>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  recoverPin: (username: string, password: string, newPin: string) => Promise<string | null>;
  pinCooldownRemaining: () => number;
  recoveryCooldownRemaining: () => number;
  hasPin: () => boolean;
  pinLength: () => 4 | 6 | null;
  lock: () => void;

  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;

  addAsset: (a: Omit<Asset, 'id' | 'userId' | 'createdAt' | 'updatedAt'>, opts?: { valuationRecord?: boolean; valuationNote?: string | null }) => Promise<string | null>;
  updateAsset: (id: string, patch: Partial<Asset>, opts?: { valuationRecord?: boolean; valuationNote?: string | null }) => Promise<boolean>;
  deleteAsset: (id: string) => Promise<boolean>;

  /** Documents centre: persist a validated doc (blob written first). */
  addDocument: (built: NewDocumentRecord) => Promise<string | null>;
  updateDocument: (id: string, patch: Partial<DocumentRecord>) => Promise<string | null>;
  deleteDocument: (id: string) => Promise<boolean>;
  markSold: (id: string, saleDate: string | null, proceedsLkr: number | null) => Promise<boolean>;
  /** Valuation Centre: persist an approved valuation result as a full record. */
  recordValuation: (input: {
    assetId: string;
    valueLkr: number;
    method: ValuationMethod;
    sourceLabel: string;
    confidence: ValuationConfidence;
    note?: string | null;
    /** Full ISO timestamp the valuation takes effect from (user-picked date allowed). */
    effectiveAt?: string | null;
    extras?: Partial<Omit<ValuationRecord, 'id' | 'assetId' | 'userId' | 'valueLkr' | 'method' | 'sourceLabel' | 'confidence' | 'note' | 'recordedAt'>>;
  }) => Promise<boolean>;
  /** Valuation Centre: change the reassessment cadence. */
  setCadence: (cadence: ValuationPrefs['cadence']) => void;
  restoreFromSold: (id: string) => Promise<boolean>;
  archiveAsset: (id: string, archived: boolean) => Promise<boolean>;

  exportBackup: (passphrase: string | null) => Promise<{ filename: string; blob: Blob } | null>;
  restoreBackup: (file: File | string, passphrase: string | null) => Promise<string | null>;
  wipeVault: () => Promise<void>;

  setSettings: (patch: Partial<AppSettings>) => void;
  setOverride: (kind: ManualPriceOverride['kind'], value: number | null) => void;
  refreshMarket: () => Promise<void>;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;

  /** Stores the user's Gemini key: under the unlocked vault DEK when
   *  available, otherwise passphrase-sealed. Returns an error message or null. */
  saveGeminiKey: (key: string, passphrase: string | null) => Promise<string | null>;
  /** Reads the stored Gemini key. When `passphrase` is provided it unseals a
   *  passphrase-sealed key; otherwise it uses the vault DEK when unlocked. */
  loadGeminiKey: (passphrase?: string | null) => Promise<string | null>;
  /** True when a Gemini key envelope exists on this device (contents not read). */
  hasGeminiKeyStored: () => boolean;
  /** Remove the stored Gemini key envelope. */
  clearGeminiKey: () => boolean;

  /** Development-only: seed the clearly-labeled sample dataset. */
  loadSampleData: () => Promise<void>;
}

export const useData = create<DataState>((set, get) => {
  let profiles = new ProfileStore();
  let dekHex: string | null = null;

  const startLocalSession = async (unlockedDekHex: string) => {
    dekHex = unlockedDekHex;
    const bytes = fromHex(unlockedDekHex);
    const adapter = new EncryptedLocalAdapter(() => bytes);
    const profile = profiles.readProfile();
    set({ mode: 'local', adapter, profileName: profile?.username ?? null, error: null });
    const bundle = await adapter.init();
    set({ assets: bundle.assets, records: bundle.records, documents: bundle.documents ?? [], error: null });
    if (profile?.displayName && !get().settings.ownerName) {
      set({ settings: { ...get().settings, ownerName: profile.displayName } });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(get().settings));
    }
  };

  const clearSession = (mode: AppMode) => {
    dekHex = null;
    set({ mode, adapter: null, assets: [], records: [], documents: [] });
  };

  const ensurePayloadDate = (input: string | null | undefined): string => {
    if (!input || Number.isNaN(new Date(input).getTime())) return new Date().toISOString();
    // Date-only strings (user-picked valuation date) normalise to midday UTC
    // so timeline sorting treats the whole day uniformly.
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return `${input.trim()}T12:00:00.000Z`;
    return new Date(input).toISOString();
  };

  const failMessage = (cooldownSeconds: number, fallback: string) =>
    cooldownSeconds > 0
      ? cooldownSeconds >= 60
        ? `Too many failed attempts. Try again in ${Math.ceil(cooldownSeconds / 60)} min.`
        : `Too many failed attempts. Try again in ${cooldownSeconds}s.`
      : fallback;

  return {
  mode: 'loading',
  assets: [],
  records: [],
  documents: [],
  valuationPrefs: loadValuationPrefs(),
    settings: loadSettings(),
    market: null,
    overrides: loadOverrides(),
    marketLoading: false,
    busy: false,
    error: null,
    toasts: [],
    userEmail: null,
    profileName: null,
    adapter: null,

    async boot() {
      // Boot decides the mode exactly once.
      if (get().mode !== 'loading') return;
      // 1) market data (works in every mode)
      get().refreshMarket().catch(() => {});
      // 2) cloud resume only when the user previously chose cloud sync (web builds)
      if (supabaseConfigured && localStorage.getItem(MODE_PREF_KEY) === 'cloud') {
        try {
          const sb = getSupabase();
          const { data } = await sb.auth.getSession();
          const session = data.session;
          if (session?.user) {
            const adapter = new SupabaseAdapter(sb, session.user.id);
            set({ mode: 'cloud', adapter, userEmail: session.user.email ?? null });
            const bundle = await adapter.init();
            set({ assets: bundle.assets, records: bundle.records, documents: [], error: null });
            sb.auth.onAuthStateChange((e) => {
              if (e === 'SIGNED_OUT') {
                localStorage.removeItem(MODE_PREF_KEY);
                clearSession('signedOut');
              }
            });
            return;
          }
        } catch {
          /* fall through to the local vault flow */
        }
      }
      // 3) local-first decision
      profiles = new ProfileStore();
      if (profiles.hasProfile()) set({ mode: 'locked', profileName: profiles.profileUsername() });
      else set({ mode: 'onboarding' });
    },

    async createProfile(input) {
      try {
        const { dekHex: fresh } = profiles.createProfile(input);
        set({ profileName: input.username.trim() });
        if (input.currency) get().setSettings({ displayCurrency: input.currency });
        if (input.displayName) get().setSettings({ ownerName: input.displayName });
        if (input.pin) {
          profiles.registerPin(input.pin, fresh);
        }
        await startLocalSession(fresh);
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },

    async unlockWithPassword(password) {
      const cooldown = get().pinCooldownRemaining();
      if (cooldown > 0) return failMessage(cooldown, '');
      const dek = profiles.unlockWithPassword(password);
      if (!dek) {
        const c = profiles.recordFailure('pin');
        return failMessage(c, 'Incorrect password.');
      }
      profiles.recordSuccess('pin');
      await startLocalSession(dek);
      return null;
    },

    async unlockWithPin(pin) {
      const cooldown = get().pinCooldownRemaining();
      if (cooldown > 0) return failMessage(cooldown, '');
      const dek = profiles.unlockWithPin(pin);
      if (!dek) {
        const c = profiles.recordFailure('pin');
        return failMessage(c, 'Incorrect PIN.');
      }
      profiles.recordSuccess('pin');
      await startLocalSession(dek);
      return null;
    },

    registerPin(pin) {
      if (!dekHex) return 'The vault must be unlocked first.';
      try {
        profiles.registerPin(pin, dekHex);
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },

    async changePin(currentPin, newPin) {
      if (!dekHex) return 'The vault must be unlocked first.';
      const res = profiles.changePin(currentPin, newPin, dekHex);
      if (!res.ok) {
        // Wrong current PIN still counts against the persisted attempt counter.
        if (/incorrect/i.test(currentPin === newPin ? '' : res.error ?? '')) profiles.recordFailure('pin');
        return res.error ?? 'Could not change the PIN.';
      }
      return null;
    },

    async removePin(currentPin) {
      if (!profiles.hasPin()) return 'No PIN is set.';
      const cooldown = get().pinCooldownRemaining();
      if (cooldown > 0) return failMessage(cooldown, '');
      if (profiles.unlockWithPin(currentPin) === null) {
        const c = profiles.recordFailure('pin');
        return failMessage(c, 'Current PIN is incorrect.');
      }
      profiles.recordSuccess('pin');
      profiles.removePin();
      return null;
    },

    async changePassword(currentPassword, newPassword) {
      if (!dekHex) return 'The vault must be unlocked first.';
      const res = profiles.changePassword(currentPassword, newPassword);
      return res.ok ? null : (res.error ?? 'Could not change the password.');
    },

    /**
     * PIN recovery: verify username + master password, register a new PIN.
     * On success the same password immediately unlocks (the DEK is unwrapped
     * from the password wrap inside changePassword-style logic), so we then
     * start the session directly with the password KEK.
     */
    async recoverPin(username, password, newPin) {
      const lockedUntil = get().recoveryCooldownRemaining();
      if (lockedUntil > 0) return failMessage(lockedUntil, '');
      const res = profiles.recoverPin(username, password, newPin);
      if (!res.ok) {
        const c = profiles.recordFailure('recovery');
        return failMessage(c, res.error ?? 'Recovery failed.');
      }
      profiles.recordSuccess('recovery');
      await startLocalSession(profiles.unlockWithPassword(password)!);
      return null;
    },

    pinCooldownRemaining() {
      return profiles.cooldownRemaining('pin');
    },
    recoveryCooldownRemaining() {
      return profiles.cooldownRemaining('recovery');
    },
    hasPin() {
      return profiles.hasPin();
    },
    pinLength() {
      return profiles.pinLength();
    },
    lock() {
      clearSession('locked');
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
      clearSession('signedOut');
    },

    async addAsset(input, opts) {
      const { adapter, mode } = get();
      if (!adapter) return null;
      const now = new Date().toISOString();
      const userId = mode === 'cloud' ? (adapter as SupabaseAdapter).userId : get().profileName ?? 'local-user';
      const asset: Asset = {
        ...input,
        id: newId(),
        userId,
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
        // Documents must survive asset deletion — they only become unlinked.
        const unlinkedDocs: DocumentRecord[] = [];
        for (const d of get().documents) {
          if (d.assetId === id) {
            const next = { ...d, assetId: null };
            unlinkedDocs.push(next);
            await adapter.upsertDocument?.(next);
          }
        }
        set((s) => ({
          assets: s.assets.filter((a) => a.id !== id),
          records: s.records.filter((r) => r.assetId !== id),
          documents: unlinkedDocs.length ? s.documents.map((d) => (d.assetId === id ? { ...d, assetId: null } : d)) : s.documents,
        }));
        return true;
      } catch (err) {
        get().pushToast({ kind: 'error', title: 'Could not delete asset', body: (err as Error).message });
        return false;
      } finally {
        set({ busy: false });
      }
    },

    /* ── Documents centre ────────────────────────────────────────── */

    async addDocument(built) {
      const { adapter, mode } = get();
      if (!adapter?.upsertDocument) return 'Documents are available only in the local (offline) vault.';
      const userId = mode === 'cloud' ? (adapter as SupabaseAdapter).userId : get().profileName ?? 'local-user';
      const record = { ...built.record, userId };
      try {
        await persistDocument({ record, blob: built.blob }, (r) => adapter.upsertDocument!(r));
        set((s) => ({ documents: [record, ...s.documents] }));
        return null;
      } catch (err) {
        get().pushToast({ kind: 'error', title: 'Could not save document', body: (err as Error).message });
        return (err as Error).message;
      }
    },

    async updateDocument(id, patch) {
      const { adapter, documents } = get();
      const current = documents.find((d) => d.id === id);
      if (!current || !adapter?.upsertDocument) return 'Not found.';
      try {
        const next = mergeDocumentPatch(current, patch);
        await adapter.upsertDocument(next);
        set((s) => ({ documents: s.documents.map((d) => (d.id === id ? next : d)) }));
        return null;
      } catch (err) {
        get().pushToast({ kind: 'error', title: 'Could not update document', body: (err as Error).message });
        return (err as Error).message;
      }
    },

    async deleteDocument(id) {
      const { adapter, documents } = get();
      const target = documents.find((d) => d.id === id);
      if (!target || !adapter?.removeDocumentRecord) return false;
      try {
        await adapter.removeDocumentRecord(id);
        await deleteDocBlob(id).catch(() => undefined);
        set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }));
        return true;
      } catch (err) {
        get().pushToast({ kind: 'error', title: 'Could not delete document', body: (err as Error).message });
        return false;
      }
    },

    async markSold(id, saleDate, proceedsLkr) {
      return get().updateAsset(id, { status: 'sold', sold: { date: saleDate, proceedsLkr } });
    },

    /* ── Valuation Centre ─────────────────────────────────────────── */

    async recordValuation(input) {
      const { assets, adapter } = get();
      const current = assets.find((a) => a.id === input.assetId);
      if (!current) return false;
      if (!(input.valueLkr > 0) || !Number.isFinite(input.valueLkr)) return false;
      const stamp = ensurePayloadDate(input.effectiveAt);
      const record: ValuationRecord = {
        id: newId(),
        assetId: current.id,
        userId: current.userId,
        valueLkr: input.valueLkr,
        method: input.method,
        sourceLabel: input.sourceLabel,
        confidence: input.confidence,
        note: input.note ?? null,
        recordedAt: stamp,
        approved: true,
        ...(input.extras ?? {}),
      };
      const next: Asset = {
        ...current,
        valuation: {
          valueLkr: input.valueLkr,
          method: input.method,
          sourceLabel: input.sourceLabel,
          confidence: input.confidence,
          note: input.note ?? null,
          updatedAt: stamp,
        },
        updatedAt: stamp,
      };
      set({ busy: true });
      try {
        await adapter?.updateAsset(next, record);
        set((s) => ({
          assets: s.assets.map((a) => (a.id === input.assetId ? next : a)),
          records: [record, ...s.records],
        }));
        get().pushToast({
          kind: 'success',
          title: 'Valuation saved',
          body: `${current.name}: ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(input.valueLkr)} LKR recorded as the current estimate.`,
        });
        return true;
      } catch (err) {
        get().pushToast({ kind: 'error', title: 'Could not save valuation', body: (err as Error).message });
        return false;
      } finally {
        set({ busy: false });
      }
    },

    setCadence(cadence) {
      const next = { ...get().valuationPrefs, cadence };
      set({ valuationPrefs: next });
      saveValuationPrefs(next);
    },

    async restoreFromSold(id) {
      return get().updateAsset(id, { status: 'active', sold: null });
    },

    async archiveAsset(id, archived) {
      return get().updateAsset(id, { status: archived ? 'archived' : 'active' });
    },

    async exportBackup(passphrase) {
      const { assets, records, documents } = get();
      // Inline document payloads so a backup restores files on another device.
      // Metadata-only entries (file missing from the blob store) still travel.
      const documentsWithPayload = await Promise.all(
        documents.map(async (d) => {
          try {
            const blob = await getDocBlob(d.id);
            if (!blob) return d;
            const b64 = await new Promise<string>((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve((fr.result as string).split(',')[1] ?? '');
              fr.onerror = () => reject(fr.error);
              fr.readAsDataURL(blob);
            });
            return { ...d, dataB64: b64 };
          } catch {
            return d;
          }
        }),
      );
      const json = buildBackup({ assets, records, documents: documentsWithPayload }, passphrase ? { passphrase } : {});
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `vaultfolio-backup-${stamp}.json`;
      return { filename, blob: new Blob([json], { type: 'application/json' }) };
    },

    async restoreBackup(fileOrText, passphrase) {
      try {
        const text = typeof fileOrText === 'string' ? fileOrText : await fileOrText.text();
        const bundle = parseBackup(text, passphrase ? { passphrase } : {});
        const adapter = get().adapter;
        if (!adapter || !(adapter instanceof EncryptedLocalAdapter)) {
          return 'Restore is available only in the local (offline) mode.';
        }
        // Rehydrate document blobs, then persist CLEAN metadata records.
        let documents: DocumentRecord[] = [];
        if (bundle.documents?.length) {
          for (const d of bundle.documents) {
            const withPayload = d as DocumentRecord & { dataB64?: string };
            if (withPayload.dataB64) {
              try {
                const bin = atob(withPayload.dataB64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                await putDocBlob(d.id, new Blob([bytes], { type: d.mimeType }));
              } catch {
                /* keep metadata; preview will surface the missing-file state */
              }
            }
          }
          documents = bundle.documents.map((d) => {
            const { dataB64: _dropped, ...meta } = d as DocumentRecord & { dataB64?: string };
            void _dropped;
            return meta;
          });
        }
        await adapter.replaceAll({ assets: bundle.assets, records: bundle.records, documents });
        set({ assets: bundle.assets, records: bundle.records, documents });
        get().pushToast({
          kind: 'success',
          title: 'Backup restored',
          body:
            documents.length > 0
              ? `${bundle.assets.length} assets, ${bundle.records.length} valuation events, ${documents.length} documents.`
              : `${bundle.assets.length} assets and ${bundle.records.length} valuation events.`,
        });
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },

    async wipeVault() {
      const adapter = get().adapter;
      if (adapter && adapter.id === 'local') {
        for (const d of get().documents) {
          await deleteDocBlob(d.id).catch(() => undefined);
        }
        const bundle = await (adapter as EncryptedLocalAdapter).wipe();
        set({ assets: bundle.assets, records: bundle.records, documents: [] });
        get().pushToast({ kind: 'success', title: 'Vault wiped', body: 'All local data has been removed.' });
      }
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
        // Refresh both sources in parallel so the state update that triggers
        // re-render sees fresh metal observations too: existing gold/silver/
        // platinum/palladium assets then recompute against current market.
        const [m, ] = await Promise.all([
          loadMarketData(get().overrides),
          syncObservationsIfDue().catch(() => ({ fetched: false, observationsAdded: 0 })),
        ]);
        set({ market: m, marketLoading: false });
      } catch {
        set({ marketLoading: false });
      }
    },

    async saveGeminiKey(key, passphrase) {
      const trimmed = key.trim();
      if (trimmed.length < 20) return 'That does not look like a valid Gemini API key.';
      try {
        if (dekHex) {
          // Preferred: seal under the live vault DEK (in-memory only, never persisted).
          persistWithVaultDek(KIND_GEMINI, trimmed, dekHex);
        } else if (passphrase) {
          // Fallback when the vault is locked: passphrase-seal the key instead.
          persistWithPassphrase(KIND_GEMINI, trimmed, passphrase, localStorage);
        } else {
          return 'Vault is locked — enter your vault passphrase to store the key, or unlock the vault first.';
        }
        get().pushToast({ kind: 'success', title: 'Gemini key saved', body: 'Encrypted with your vault key. It never leaves this device.' });
        return null;
      } catch (e) {
        return `Could not store the key: ${(e as Error).message}`;
      }
    },

    async loadGeminiKey(passphrase) {
      try {
        if (dekHex) {
          const viaVault = loadWithVaultDek(KIND_GEMINI, dekHex, localStorage);
          if (viaVault) return viaVault;
        }
        if (passphrase) {
          return loadWithPassphrase(KIND_GEMINI, passphrase, localStorage);
        }
        return null;
      } catch {
        return null;
      }
    },

    hasGeminiKeyStored() {
      return hasStoredCredential(KIND_GEMINI, localStorage);
    },

    clearGeminiKey() {
      const removed = deleteCredential(KIND_GEMINI, localStorage);
      if (removed) {
        get().pushToast({ kind: 'info', title: 'Gemini key removed', body: 'Reports can no longer be generated until a new key is configured.' });
      }
      return removed;
    },

    async loadSampleData() {
      const adapter = get().adapter;
      if (adapter && adapter.id === 'local') {
        const bundle = await (adapter as EncryptedLocalAdapter).loadSampleData();
        set({ assets: bundle.assets, records: bundle.records });
      }
    },

    pushToast(t) {
      const id = Date.now() + Math.random();
      set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4200);
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    },
  } satisfies DataState;
});

/** Convenience: assets the user actively owns. */
export const activeAssets = (s: DataState) => s.assets.filter((a) => a.status === 'active');
