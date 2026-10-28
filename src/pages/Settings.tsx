import { useMemo, useRef, useState } from 'react';
import {
  Database,
  Download,
  FileJson,
  Info,
  KeyRound,
  Lock,
  LogIn,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { SUPPORTED_CURRENCIES, downloadTextFile } from '../lib/money';
import { categoryMeta } from '../lib/categories';
import { supabaseConfigured } from '../lib/supabase';
import { MAX_PIN_FAILURES } from '../lib/profile';
import { credentialSealMode } from '../lib/credentials';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select } from '../components/ui';
import type { CurrencyCode } from '../lib/types';

export function Settings() {
  const {
    settings, setSettings, assets, records, market, mode, signOut, userEmail,
    hasPin, pinLength, registerPin, changePin, removePin, changePassword, lock,
    exportBackup, restoreBackup, wipeVault, pushToast,
    saveGeminiKey, hasGeminiKeyStored, clearGeminiKey,
  } = useData();
  const [exportOpen, setExportOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [includePrivate, setIncludePrivate] = useState(false);

  /* security form state (local mode only) */
  const [pinForm, setPinForm] = useState({ pin: '', confirm: '' });
  const [pinChange, setPinChange] = useState({ current: '', next: '' });
  const [pwChange, setPwChange] = useState({ current: '', next: '', confirm: '' });
  const [secErr, setSecErr] = useState<string | null>(null);

  /* backup state */
  const [backupPass, setBackupPass] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Gemini key state */
  const [geminiModalOpen, setGeminiModalOpen] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [geminiPassphrase, setGeminiPassphrase] = useState('');
  const [geminiErr, setGeminiErr] = useState<string | null>(null);
  const [geminiBusy, setGeminiBusy] = useState(false);

  const keyConfigured = hasGeminiKeyStored();
  const sealMode = credentialSealMode('gemini-api-key') ?? 'vault-dek';

  const configStatus = useMemo(
    () => ({
      supabase: supabaseConfigured,
      metalsApi: Boolean(import.meta.env.VITE_METALS_API_URL),
    }),
    [],
  );

  const exportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'Vaultfolio',
      note: 'Values are owner estimates and transparent calculations, not appraisals.',
      settings,
      assets: assets.map((a) => ({
        ...a,
        // private fields are excluded unless the user opts in
        attributes: includePrivate
          ? (a.attributes as unknown as Record<string, unknown>)
          : maskPrivates(a.category, a.attributes as unknown as Record<string, unknown>),
      })),
      valuationEvents: records,
    };
    downloadTextFile(`vaultfolio-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    setExportOpen(false);
  };

  const exportCsv = () => {
    const header = [
      'id', 'category', 'name', 'status', 'estimated_value_lkr', 'purchase_cost_lkr', 'purchase_date',
      'resale_value_lkr', 'valuation_method', 'valuation_source', 'last_valued', 'notes',
    ];
    const lines = [header.join(',')];
    for (const a of assets) {
      const cells = [
        a.id,
        a.category,
        a.name,
        a.status,
        a.valuation.valueLkr ?? '',
        a.purchase.priceLkr ?? '',
        a.purchase.date ?? '',
        a.resaleValueLkr ?? '',
        a.valuation.method,
        a.valuation.sourceLabel.replace(/,/g, ' '),
        a.valuation.updatedAt,
        (a.notes ?? '').replace(/[\r\n,]/g, ' '),
      ];
      lines.push(cells.join(','));
    }
    downloadTextFile(`vaultfolio-assets-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
    setExportOpen(false);
  };

  return (
    <div className="max-w-3xl space-y-5 animate-fadeUp">
      <header className="pb-2 border-b border-ink-800/80">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-txt">Settings & Preferences</h1>
        <p className="text-xs text-txt-muted mt-0.5">Preferences for how Vaultfolio reads, encrypts, and maintains your data.</p>
      </header>

      {/* Profile / account */}
      <Card>
        <CardHeader
          title={
            mode === 'cloud' ? (
              <span className="flex items-center gap-2">
                <LogIn size={14} /> Account
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <UserIcon size={14} /> Profile (offline vault)
              </span>
            )
          }
          subtitle={mode === 'cloud' ? userEmail ?? '' : 'Local session — encrypted on this device'}
        />
        <div className="px-5 pb-5 grid sm:grid-cols-2 gap-3">
          <Field label="Your name" hint="Used for greeting; never leaves your records.">
            <Input value={settings.ownerName} onChange={(e) => setSettings({ ownerName: e.target.value })} placeholder="e.g. M. Unais" />
          </Field>
          {mode === 'cloud' && (
            <div className="sm:col-span-2">
              <Button onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Display preferences */}
      <Card>
        <CardHeader title="Display" subtitle="Currency & regional formatting" />
        <div className="px-5 pb-5 grid sm:grid-cols-2 gap-3">
          <Field label="Display currency" hint="Sri Lankan Rupees by default — the base currency of all records.">
            <Select value={settings.displayCurrency} onChange={(e) => setSettings({ displayCurrency: e.target.value as CurrencyCode })}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Theme" hint="Vaultfolio ships dark-first; light mode is not yet designed.">
            <Select value={settings.theme} onChange={(e) => setSettings({ theme: e.target.value as 'dark' | 'light' | 'system' })}>
              <option value="dark">Dark (recommended)</option>
              <option value="system" disabled>
                Follow system (coming soon)
              </option>
              <option value="light" disabled>
                Light (coming soon)
              </option>
            </Select>
          </Field>
        </div>
        {settings.displayCurrency === 'USD' && !market?.usdLkr && (
          <p className="px-5 pb-5 text-[11px] text-amber-400">
            No USD rate is configured — set one under Market &amp; Valuations → manual overrides, or amounts will keep
            displaying in LKR.
          </p>
        )}
      </Card>

      {/* Data & export */}
      <Card>
        <CardHeader title="Data export" subtitle="Your records in practical formats" />
        <div className="px-5 pb-5 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setExportOpen(true)}>
            <Download size={14} /> Export data
          </Button>
          <span className="text-[11px] text-txt-dim self-center">
            {assets.length} assets · {records.length} valuation events
          </span>
        </div>
      </Card>

      {/* Security & lock (local offline mode) */}
      {mode === 'local' && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <ShieldCheck size={14} /> Security &amp; Lock
              </span>
            }
            subtitle="The vault on this device: master password, optional PIN, quick lock"
          />
          <div className="px-5 pb-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => lock()}>
                <Lock size={14} /> Lock vault now
              </Button>
              <span className="text-[11px] text-txt-dim self-center">
                Clears the decryption key from memory; reopen with your password{hasPin() ? ' or PIN' : ''}.
              </span>
            </div>

            {/* PIN lifecycle */}
            {hasPin() ? (
              <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3.5 space-y-3">
                <p className="text-[12px] font-medium text-txt flex items-center gap-2">
                  <KeyRound size={13} className="text-accent" /> Device PIN — {pinLength()}-digit
                </p>
                <div className="grid sm:grid-cols-3 gap-2 items-end">
                  <Field label="Current PIN">
                    <Input
                      type="password"
                      inputMode="numeric"
                      value={pinChange.current}
                      onChange={(e) => setPinChange({ ...pinChange, current: e.target.value.replace(/\D/g, '') })}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="New PIN (4 or 6 digits)">
                    <Input
                      type="password"
                      inputMode="numeric"
                      value={pinChange.next}
                      onChange={(e) => setPinChange({ ...pinChange, next: e.target.value.replace(/\D/g, '') })}
                      autoComplete="off"
                    />
                  </Field>
                  <Button
                    onClick={async () => {
                      setSecErr(null);
                      const res = await changePin(pinChange.current, pinChange.next);
                      if (res) setSecErr(res);
                      else {
                        setPinChange({ current: '', next: '' });
                        pushToast({ kind: 'success', title: 'PIN changed' });
                      }
                    }}
                    disabled={!pinChange.current || (pinChange.next.length !== 4 && pinChange.next.length !== 6)}
                  >
                    Change PIN
                  </Button>
                </div>
                <div>
                  <Button
                    variant="ghost"
                    className="text-xs"
                    onClick={async () => {
                      setSecErr(null);
                      const res = await removePin(pinChange.current);
                      if (res) setSecErr(res);
                      else {
                        setPinChange({ current: '', next: '' });
                        pushToast({ kind: 'success', title: 'PIN removed — password unlocks the vault' });
                      }
                    }}
                    disabled={!pinChange.current}
                  >
                    Remove PIN
                  </Button>
                  <span className="text-[11px] text-txt-dim ml-2">Requires the current PIN.</span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3.5 space-y-3">
                <p className="text-[12px] font-medium text-txt flex items-center gap-2">
                  <KeyRound size={13} className="text-accent" /> Add a device PIN
                </p>
                <p className="text-[11px] text-txt-dim">
                  A {MAX_PIN_FAILURES}-attempt PIN keeps casual snoopers out while your master password stays
                  sealed underneath. The PIN wraps the same key — changing your password later won’t
                  invalidate it.
                </p>
                <div className="grid sm:grid-cols-3 gap-2 items-end">
                  <Field label="New PIN (4 or 6 digits)">
                    <Input
                      type="password"
                      inputMode="numeric"
                      value={pinForm.pin}
                      onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Confirm PIN">
                    <Input
                      type="password"
                      inputMode="numeric"
                      value={pinForm.confirm}
                      onChange={(e) => setPinForm({ ...pinForm, confirm: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                      autoComplete="off"
                    />
                  </Field>
                  <Button
                    onClick={() => {
                      setSecErr(null);
                      if (pinForm.pin !== pinForm.confirm) {
                        setSecErr('PINs do not match.');
                        return;
                      }
                      const res = registerPin(pinForm.pin);
                      if (res) setSecErr(res);
                      else {
                        setPinForm({ pin: '', confirm: '' });
                        pushToast({ kind: 'success', title: 'PIN set' });
                      }
                    }}
                  disabled={!pinForm.pin || (pinForm.pin.length !== 4 && pinForm.pin.length !== 6) || pinForm.pin !== pinForm.confirm}
                  >
                    Set PIN
                  </Button>
                </div>
              </div>
            )}

            {/* Password change */}
            <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3.5 space-y-3">
              <p className="text-[12px] font-medium text-txt">Change master password</p>
              <p className="text-[11px] text-txt-dim">
                Re-wraps the vault key under the new password — your data itself is not re-encrypted.
              </p>
              <div className="grid sm:grid-cols-3 gap-2 items-end">
                <Field label="Current password">
                  <Input type="password" value={pwChange.current} onChange={(e) => setPwChange({ ...pwChange, current: e.target.value })} autoComplete="current-password" />
                </Field>
                <Field label="New password (min 8 chars)">
                  <Input type="password" value={pwChange.next} onChange={(e) => setPwChange({ ...pwChange, next: e.target.value })} autoComplete="new-password" />
                </Field>
                <Button
                  onClick={async () => {
                    setSecErr(null);
                    if (pwChange.next.length < 8) {
                      setSecErr('New password must be at least 8 characters.');
                      return;
                    }
                    if (pwChange.next !== pwChange.confirm) {
                      setSecErr('New passwords do not match.');
                      return;
                    }
                    const res = await changePassword(pwChange.current, pwChange.next);
                    if (res) setSecErr(res);
                    else {
                      setPwChange({ current: '', next: '', confirm: '' });
                      pushToast({ kind: 'success', title: 'Master password changed' });
                    }
                  }}
                  disabled={!pwChange.current || pwChange.next.length < 8 || pwChange.next !== pwChange.confirm}
                >
                  Change password
                </Button>
              </div>
            </div>

            {secErr && <p className="text-xs text-rose-400">{secErr}</p>}
          </div>
        </Card>
      )}

      {/* Backup & restore (local offline mode) */}
      {mode === 'local' && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <PackageOpen size={14} /> Backup &amp; restore
              </span>
            }
            subtitle="A versioned manifest of your whole portfolio — encrypt it with a passphrase for travel"
          />
          <div className="px-5 pb-5 space-y-4">
            <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3.5 space-y-3">
              <p className="text-[12px] font-medium text-txt flex items-center gap-2">
                <Download size={13} className="text-accent" /> Export backup
              </p>
              <Field label="Passphrase (optional)" hint="Leaving this empty writes a plain-JSON backup. AES-256-GCM + scrypt when set.">
                <Input type="password" value={backupPass} onChange={(e) => setBackupPass(e.target.value)} placeholder="Leave empty for unencrypted" autoComplete="new-password" />
              </Field>
              <Button
                variant="primary"
                onClick={async () => {
                  const out = await exportBackup(backupPass || null);
                  if (!out) return;
                  const url = URL.createObjectURL(out.blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = out.filename;
                  a.click();
                  URL.revokeObjectURL(url);
                  setBackupPass('');
                  pushToast({ kind: 'success', title: 'Backup exported', body: out.filename });
                }}
              >
                Export backup file
              </Button>
            </div>

            <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3.5 space-y-3">
              <p className="text-[12px] font-medium text-txt flex items-center gap-2">
                <Upload size={13} className="text-accent" /> Restore from backup
              </p>
              <p className="text-[11px] text-txt-dim">
                Restoring <strong>replaces current data</strong> in this vault with the backup file.
                Confirmation is required before any data is overwritten.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-wrap gap-2 items-center">
                <Button onClick={() => fileInputRef.current?.click()}>
                  {restoreFile ? restoreFile.name : 'Choose backup file…'}
                </Button>
                <Input
                  type="password"
                  className="max-w-52"
                  value={restorePass}
                  onChange={(e) => setRestorePass(e.target.value)}
                  placeholder="Passphrase if encrypted"
                  autoComplete="off"
                />
                <Button
                  variant="primary"
                  disabled={!restoreFile}
                  onClick={() => setConfirmRestoreOpen(true)}
                >
                  Restore
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Gemini AI (user-configured key, envelope-encrypted at rest) */}
      <Card>
        <CardHeader title="Gemini AI" subtitle="User-configured key for AI Market Reports" />
        <div className="px-5 pb-5 space-y-3">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex items-center gap-2">
              <Sparkles size={14} className="text-txt-muted" /> Gemini API key
            </span>
            {keyConfigured ? (
              <Badge tone="positive">Stored · encrypted at rest</Badge>
            ) : (
              <Badge tone="warning">Not configured</Badge>
            )}
          </div>
          {keyConfigured && (
            <p className="text-[11px] text-txt-dim">
              Seal mode: {sealMode === 'passphrase' ? 'passphrase-sealed envelope (your vault passphrase wraps the key)' : 'vault DEK (key is sealed together with your vault)'}.
              The plaintext key is never written to disk or logs.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setGeminiModalOpen(true)}>
              <KeyRound size={13} /> {keyConfigured ? 'Replace key' : 'Add key'}
            </Button>
            {keyConfigured && (
              <Button size="sm" variant="danger" onClick={() => void clearGeminiKey()}>
                Remove key
              </Button>
            )}
          </div>
          <p className="text-[11px] text-txt-dim leading-relaxed">
            Reports call Google's Gemini REST API directly and the key is sent only in the Authorization header to Google.
            Because Vaultfolio runs locally, this is client-side with envelope encryption — a determined adversary with device access could still recover it; never use a production-critical key here.
            Create a free key at aistudio.google.com.
          </p>
        </div>
      </Card>

      {/* Configuration status */}
      <Card>
        <CardHeader title="Integrations" subtitle="What's wired up in this build" />
        <ul className="px-5 pb-5 space-y-2.5 text-[13px]">
          <li className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Database size={14} className="text-txt-muted" /> Supabase (optional cloud sync)
            </span>
            {configStatus.supabase ? (
              <Badge tone="positive">{mode === 'cloud' ? 'Connected' : 'Configured'}</Badge>
            ) : (
              <Badge tone="demo">Not configured · offline mode</Badge>
            )}
          </li>
          <li className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <RefreshCw size={14} className="text-txt-muted" /> Live market data (gold/silver FX)
            </span>
            {configStatus.metalsApi ? (
              <Badge tone="positive">Configured</Badge>
            ) : (
              <Badge tone="warning">Not configured — manual entry only</Badge>
            )}
          </li>
        </ul>
        {!configStatus.metalsApi && (
          <p className="px-5 pb-5 text-[11px] text-txt-dim">
            Vaultfolio operates fully offline: physical assets are tracked using transparent, user-entered estimates. No paid market API subscription or external network dependency is required.
          </p>
        )}
      </Card>

      {/* Privacy */}
      <Card>
        <CardHeader title="Privacy" subtitle="What this app does and doesn't do" />
        <ul className="px-5 pb-5 space-y-2 text-[12px] text-txt-muted">
          <li className="flex gap-2">
            <Lock size={13} className="mt-0.5 shrink-0 text-txt-dim" />
            In cloud mode, every asset, valuation, and attachment is row-protected in Postgres (RLS) to your
            authenticated user only — the app cannot read anyone else's data and neither can other users.
          </li>
          <li className="flex gap-2">
            <Lock size={13} className="mt-0.5 shrink-0 text-txt-dim" />
            Serial numbers, registration plates, and precise property addresses are marked private and are
            excluded from exports unless you explicitly opt in.
          </li>
          <li className="flex gap-2">
            <Lock size={13} className="mt-0.5 shrink-0 text-txt-dim" />
            In offline mode your vault is AES-256-GCM encrypted locally and only readable after the
            master password or device PIN unlocks it — but there is no cross-device sync, so keep a
            backup (Settings → Backup &amp; restore).
          </li>
          <li className="flex gap-2">
            <Info size={13} className="mt-0.5 shrink-0 text-txt-dim" />
            Vaultfolio never publishes, lists, or shares your assets. There is no social view.
          </li>
        </ul>
      </Card>

      {/* Export modal */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export your data"
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={exportCsv}>
              <Download size={14} /> CSV
            </Button>
            <Button variant="primary" onClick={exportJson}>
              <FileJson size={14} /> Export JSON
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-txt-muted">
          <p>
            Export includes asset records and valuation events.{' '}
            <label className="flex items-start gap-2 mt-3 text-txt">
              <input type="checkbox" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} className="mt-1" />
              <span className="text-[13px]">
                Include private fields (serials, registration numbers, precise addresses). Off by default.
              </span>
            </label>
          </p>
          <ul className="text-[12px] text-txt-dim list-disc pl-4 space-y-1">
            <li>CSV: one row per asset — great for spreadsheets.</li>
            <li>JSON: full fidelity including valuation event history.</li>
          </ul>
        </div>
      </Modal>

      {/* Wipe-vault modal (local offline mode) */}
      {mode === 'local' && (
        <Card>
          <CardHeader title="Danger zone" subtitle="Irreversible local actions" />
          <div className="px-5 pb-5">
            <Button variant="danger" onClick={() => setWipeOpen(true)}>
              <Trash2 size={14} /> Wipe vault data…
            </Button>
          </div>
        </Card>
      )}

      <Modal
        open={wipeOpen}
        onClose={() => setWipeOpen(false)}
        title="Wipe vault data"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWipeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await wipeVault();
                setWipeOpen(false);
              }}
            >
              Wipe everything
            </Button>
          </>
        }
      >
        <p className="text-sm text-txt-muted">
          This permanently deletes every asset and valuation event stored in this vault
          (including anything you entered). Your profile, master password and PIN stay intact.
          This cannot be undone.
        </p>
      </Modal>

      {/* Restore confirmation modal */}
      <Modal
        open={confirmRestoreOpen}
        onClose={() => setConfirmRestoreOpen(false)}
        title="Confirm Portfolio Restore"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRestoreOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!restoreFile) return;
                setConfirmRestoreOpen(false);
                const res = await restoreBackup(restoreFile, restorePass || null);
                if (res) {
                  pushToast({ kind: 'error', title: 'Restore failed', body: res });
                } else {
                  setRestoreFile(null);
                  setRestorePass('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                  pushToast({ kind: 'success', title: 'Portfolio restored successfully', body: 'All assets and valuation history have been restored.' });
                }
              }}
            >
              <Upload size={14} /> Overwrite &amp; Restore
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-txt">
            Are you sure you want to restore from <strong className="text-accent">{restoreFile?.name}</strong>?
          </p>
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <strong>Warning:</strong> This will replace all current data in this vault (
            <strong>{assets.length} active asset{assets.length === 1 ? '' : 's'}</strong> and{' '}
            <strong>{records.length} valuation event{records.length === 1 ? '' : 's'}</strong>) with the data contained in this backup.
          </div>
          <p className="text-xs text-txt-dim">
            If you wish to preserve your current records, export a fresh backup before proceeding.
          </p>
        </div>
      </Modal>

      {/* Gemini key modal: accepts the key; passphrase is requested only when the vault is locked */}
      <Modal
        open={geminiModalOpen}
        onClose={() => { setGeminiModalOpen(false); setGeminiErr(null); setGeminiKeyInput(''); setGeminiPassphrase(''); }}
        title="Configure Gemini API key"
      >
        <div className="space-y-3.5">
          <Field label="Gemini API key">
            <Input
              id="gemini-key"
              type="password"
              autoComplete="off"
              placeholder="AIza…"
              value={geminiKeyInput}
              onChange={(e) => setGeminiKeyInput(e.target.value)}
            />
          </Field>
          {mode !== 'local' && (
            <Field label="Vault passphrase (needed to seal the key while the vault is locked)">
              <Input
                id="gemini-pass"
                type="password"
                autoComplete="off"
                value={geminiPassphrase}
                onChange={(e) => setGeminiPassphrase(e.target.value)}
              />
            </Field>
          )}
          <p className="text-[11px] text-txt-dim leading-relaxed">
            Stored per your device with envelope encryption (AES-256-GCM + scrypt wrapping). Nothing is uploaded to Vaultfolio servers.
            Get a free key at aistudio.google.com. If you've pasted a key anywhere public, rotate it.
          </p>
          {geminiErr && <p className="text-xs text-negative">{geminiErr}</p>}
        </div>
        <div className="mt-4 flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={() => { setGeminiModalOpen(false); setGeminiErr(null); setGeminiKeyInput(''); setGeminiPassphrase(''); }}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            loading={geminiBusy}
            onClick={async () => {
              setGeminiBusy(true);
              setGeminiErr(null);
              const err = await saveGeminiKey(geminiKeyInput, mode === 'local' ? null : geminiPassphrase);
              setGeminiBusy(false);
              if (err) { setGeminiErr(err); return; }
              setGeminiModalOpen(false);
              setGeminiKeyInput('');
              setGeminiPassphrase('');
            }}
          >
            Save key
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function maskPrivates(category: string, attrs: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...attrs };
  const privateKeys = ['serial', 'registration', 'address'];
  for (const k of Object.keys(masked)) {
    if (privateKeys.includes(k) && masked[k]) masked[k] = '[private]';
  }
  return masked;
}
