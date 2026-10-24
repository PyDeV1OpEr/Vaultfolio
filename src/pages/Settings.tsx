import { useMemo, useState } from 'react';
import {
  Database,
  Download,
  FileJson,
  Info,
  Lock,
  LogIn,
  RefreshCw,
  RotateCcw,
  User as UserIcon,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { SUPPORTED_CURRENCIES, downloadTextFile } from '../lib/money';
import { categoryMeta } from '../lib/categories';
import { supabaseConfigured } from '../lib/supabase';
import { DEMO_MARKET } from '../lib/market';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select } from '../components/ui';
import type { CurrencyCode } from '../lib/types';

export function Settings() {
  const { settings, setSettings, assets, records, market, mode, resetDemo, signOut, userEmail } = useData();
  const [exportOpen, setExportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [includePrivate, setIncludePrivate] = useState(false);

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
    <div className="max-w-3xl space-y-4 animate-fadeUp">
      <header>
        <h1 className="text-xl lg:text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-txt-muted mt-1">Preferences for how Vaultfolio reads and keeps your data.</p>
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
                <UserIcon size={14} /> Profile (demo mode)
              </span>
            )
          }
          subtitle={mode === 'cloud' ? userEmail ?? '' : 'Local demo session — no account exists'}
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

      {/* Demo mode controls */}
      {mode === 'demo' && (
        <Card className="border-violet-500/25">
          <CardHeader title="Demo mode" subtitle="Sample data lives only in this browser" />
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            <Button onClick={() => setResetOpen(true)}>
              <RotateCcw size={14} /> Reset demo data
            </Button>
            <p className="text-[11px] text-txt-dim self-center">
              Resets to a fresh sample set and clears everything you added in demo mode.
            </p>
          </div>
        </Card>
      )}

      {/* Configuration status */}
      <Card>
        <CardHeader title="Integrations" subtitle="What's wired up in this build" />
        <ul className="px-5 pb-5 space-y-2.5 text-[13px]">
          <li className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Database size={14} className="text-txt-muted" /> Supabase (auth + secure storage)
            </span>
            {configStatus.supabase ? (
              <Badge tone="positive">{mode === 'cloud' ? 'Connected' : 'Configured — sign in'}</Badge>
            ) : (
              <Badge tone="demo">Not configured · demo mode</Badge>
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
            Demo metal prices: LKR {DEMO_MARKET.goldPerGramLkr?.toLocaleString('en-US')}/g gold · LKR{' '}
            {DEMO_MARKET.silverPerGramLkr?.toLocaleString('en-US')}/g silver · {DEMO_MARKET.usdLkr}/USD.{' '}
            Provide <code className="text-accent">VITE_METALS_API_URL</code> for a live provider, or enter verified
            prices manually on the Market page.
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
            Demo mode stores data in this browser's localStorage only. It offers no cross-device sync and is
            not as protected as an authenticated deployment — never treat it as a backup.
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

      {/* Reset modal */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset demo data"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await resetDemo();
                setResetOpen(false);
              }}
            >
              Reset everything
            </Button>
          </>
        }
      >
        <p className="text-sm text-txt-muted">
          This clears assets and valuation events stored in this browser (including anything you entered) and
          regenerates the labeled sample dataset. This cannot be undone.
        </p>
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
