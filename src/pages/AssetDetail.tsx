import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  BadgeCheck,
  Camera,
  CircleAlert,
  Info,
  Lock,
  Pencil,
  RotateCcw,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { categoryMeta } from '../lib/categories';
import {
  assetMetrics,
  resolveAssetValuation,
  resolveResaleValue,
  valuationMethodLabel,
} from '../lib/valuation';
import { formatDate, formatDateTime, formatMoney, parseNum, relativeTime } from '../lib/money';
import { formatArea } from '../lib/units';
import type { Asset, AssetStatus } from '../lib/types';
import { HistoryLine } from '../components/Charts';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea } from '../components/ui';

export function AssetDetail() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const { assets, records, market, settings, busy } = useData();
  const asset = assets.find((a) => a.id === assetId);
  const myRecords = useMemo(
    () => records.filter((r) => r.assetId === assetId).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)),
    [records, assetId],
  );

  const [editOpen, setEditOpen] = useState(false);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [soldOpen, setSoldOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);

  if (!asset) {
    return assets ? (
      <EmptyState
        icon={<CircleAlert size={20} />}
        title="Asset not found"
        body="It may have been deleted from another device."
        action={
          <Link to="/portfolio" className="text-sm text-accent hover:underline">
            ← Back to portfolio
          </Link>
        }
      />
    ) : (
      <Skeleton className="h-96" />
    );
  }

  const meta = categoryMeta(asset.category);
  const resolved = resolveAssetValuation(asset, market);
  const m = assetMetrics(asset, market);
  const resale = resolveResaleValue(asset, market);
  const usd = market?.usdLkr ?? null;

  return (
    <div className="max-w-4xl space-y-5 animate-fadeUp">
      {/* Header */}
      <button onClick={() => navigate('/portfolio')} className="text-sm text-txt-muted hover:text-txt flex items-center gap-1">
        <ArrowLeft size={14} /> Portfolio
      </button>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`w-11 h-11 rounded-xl bg-ink-800 border border-ink-700 flex items-center justify-center shrink-0 ${asset.category === 'gold_silver' ? 'text-amber-300' : 'text-accent'}`}>
            <meta.icon size={21} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl lg:text-2xl font-semibold break-words">{asset.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge>{meta.label}</Badge>
              <StatusBadge status={asset.status} />
              <Badge tone="accent">{valuationMethodLabel(resolved.method)}</Badge>
              <Badge tone={resolved.confidence === 'high' ? 'positive' : resolved.confidence === 'low' ? 'warning' : 'neutral'}>
                {resolved.confidence === 'high' ? 'High confidence' : resolved.confidence === 'low' ? 'Low confidence' : 'Medium confidence'}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditOpen(true)}>
            <Pencil size={14} /> Edit
          </Button>
          <Button onClick={() => setValuationOpen(true)}>
            <BadgeCheck size={14} /> Update valuation
          </Button>
          {asset.status === 'active' && (
            <Button onClick={() => setSoldOpen(true)}>
              Mark sold
            </Button>
          )}
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-[12px] text-txt-muted">Estimated value today</p>
          <p className="text-lg font-semibold tnum mt-1.5">
            {resolved.valueLkr === null ? <span className="text-txt-dim text-sm font-normal">Unavailable</span> : formatMoney(resolved.valueLkr, settings.displayCurrency, usd)}
          </p>
          <p className="text-[11px] text-txt-dim mt-1">{resolved.sourceLabel}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] text-txt-muted">Purchase cost</p>
          <p className="text-lg font-semibold tnum mt-1.5">{m.purchaseCostLkr === null ? '—' : formatMoney(m.purchaseCostLkr, settings.displayCurrency, usd)}</p>
          {asset.purchase.date && <p className="text-[11px] text-txt-dim mt-1">{formatDate(asset.purchase.date)}{asset.purchase.currency && asset.purchase.currency !== 'LKR' ? ` (${asset.purchase.currency} ${asset.purchase.priceOriginal})` : ''}</p>}
        </Card>
        <Card className="p-4">
          <p className="text-[12px] text-txt-muted">Unrealized gain (est.)</p>
          <p className={`text-lg font-semibold tnum mt-1.5 ${m.unrealizedGainLkr === null ? '' : m.unrealizedGainLkr >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {m.unrealizedGainLkr === null ? '—' : formatMoney(m.unrealizedGainLkr, settings.displayCurrency, usd)}
          </p>
          <p className="text-[11px] text-txt-dim mt-1">value − cost · excludes selling costs & taxes</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] text-txt-muted">Est. resale proceeds</p>
          <p className="text-lg font-semibold tnum mt-1.5">{resale === null ? '—' : formatMoney(resale, settings.displayCurrency, usd)}</p>
          <p className="text-[11px] text-txt-dim mt-1">
            {m.resaleGainLkr === null ? 'no resale figure recorded' : `net gain if sold: ${formatMoney(m.resaleGainLkr, settings.displayCurrency, usd)}`}
          </p>
        </Card>
      </div>

      {/* Explanation of the valuation */}
      <Card className="p-4 flex items-start gap-3">
        <Info size={16} className="text-accent mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <p className="text-txt">{resolved.explanation}</p>
          {asset.valuation.note && <p className="text-txt-muted mt-1.5">Owner note: “{asset.valuation.note}”</p>}
          <p className="text-txt-dim text-[11px] mt-1.5">Last valuation update: {formatDateTime(asset.valuation.updatedAt) || '—'} → {relativeTime(asset.valuation.updatedAt)}</p>
        </div>
      </Card>

      {/* Sold banner */}
      {asset.status === 'sold' && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3 border-emerald-500/25 bg-emerald-500/5">
          <div>
            <p className="text-sm font-medium text-emerald-400">Marked as sold</p>
            <p className="text-[12px] text-txt-muted mt-0.5">
              {asset.sold?.date ? `Sold on ${formatDate(asset.sold.date)} · ` : ''}
              {asset.sold?.proceedsLkr != null ? `Recorded proceeds: ${formatMoney(asset.sold.proceedsLkr, settings.displayCurrency, usd)}. ` : ''}
              Kept in history, excluded from active totals.
            </p>
          </div>
          <Button onClick={() => void useData.getState().restoreFromSold(asset.id)}>
            <RotateCcw size={14} /> Restore to active
          </Button>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Attributes */}
        <Card>
          <CardHeader title="Asset attributes" subtitle={`Recorded for ${meta.label}`} />
          <dl className="px-5 pb-5 grid gap-x-6 grid-cols-[auto_1fr] gap-y-2.5 text-[13px]">
            {attributeRows(asset).map(([k, v, priv]) =>
              v === null || v === '' || v === undefined ? null : (
                <div key={k} className="col-span-full flex gap-2">
                  <dt className="text-txt-dim w-40 shrink-0 flex items-center gap-1">
                    {priv && <Lock size={11} className="text-txt-dim" />}
                    {k}
                  </dt>
                  <dd className="text-txt min-w-0 break-words">{v}</dd>
                </div>
              ),
            )}
            <div className="col-span-full flex gap-2">
              <dt className="text-txt-dim w-40 shrink-0">Added</dt>
              <dd className="text-txt">{formatDate(asset.createdAt)}</dd>
            </div>
          </dl>
        </Card>

        {/* History */}
        <Card>
          <CardHeader
            title="Valuation history"
            subtitle={myRecordCountLabel(myRecords.length)}
          />
          {myRecords.length >= 3 ? (
            <div className="px-2 pb-2">
              <HistoryLine data={[...myRecords].reverse().map((r) => ({ date: r.recordedAt, valueLkr: r.valueLkr ?? 0 }))} />
            </div>
          ) : null}
          <ul className="px-5 pb-4 space-y-3">
            {myRecords.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 text-[13px]">
                <div>
                  <p className="text-txt tnum">{r.valueLkr === null ? '—' : formatMoney(r.valueLkr, settings.displayCurrency, usd)}</p>
                  <p className="text-[11px] text-txt-dim mt-0.5">
                    {valuationMethodLabel(r.method)} · {r.sourceLabel}
                  </p>
                  {r.note ? <p className="text-[11px] text-txt-muted mt-0.5 italic">“{r.note}”</p> : null}
                </div>
                <p className="text-[11px] text-txt-dim text-right shrink-0">{formatDate(r.recordedAt)}</p>
              </li>
            ))}
            {myRecords.length === 0 && (
              <li className="text-sm text-txt-muted">No recorded valuation events yet. Use “Update valuation” to start a history.</li>
            )}
          </ul>
        </Card>
      </div>

      {/* Notes */}
      {asset.notes && (
        <Card>
          <CardHeader title="Notes" />
          <p className="px-5 pb-5 text-[13px] text-txt-muted whitespace-pre-wrap">{asset.notes}</p>
        </Card>
      )}

      {/* Image */}
      <Card>
        <CardHeader title="Photo" subtitle="Optional — stored privately with your account" />
        <div className="px-5 pb-5">
          {asset.image ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img src={asset.image} alt={asset.name} className="max-h-72 rounded-lg border border-ink-700" />
              <Button variant="ghost" onClick={() => setImageOpen(true)}>
                <Camera size={14} /> Replace photo
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[13px] text-txt-muted">No photo added yet. A small photo helps identify the piece later.</p>
              <Button onClick={() => setImageOpen(true)}>
                <Camera size={14} /> Add photo
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="border-rose-500/20">
        <CardHeader title="Danger zone" subtitle="These actions can't be undone for active data" />
        <div className="px-5 pb-5 flex flex-wrap gap-2">
          <Button onClick={() => void useData.getState().archiveAsset(asset.id, asset.status !== 'archived')}>
            <Archive size={14} /> {asset.status === 'archived' ? 'Restore from archive' : 'Archive asset'}
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={14} /> Delete asset
          </Button>
        </div>
      </Card>

      {/* Modals */}
      <DeleteModal open={deleteOpen} onClose={() => setDeleteOpen(false)} asset={asset} onDeleted={() => navigate('/portfolio')} />
      <ValuationModal open={valuationOpen} onClose={() => setValuationOpen(false)} asset={asset} />
      <SoldModal open={soldOpen} onClose={() => setSoldOpen(false)} asset={asset} />
      <EditModal open={editOpen} onClose={() => setEditOpen(false)} asset={asset} />
      <ImageModal open={imageOpen} onClose={() => setImageOpen(false)} asset={asset} busy={busy} />
    </div>
  );
}

const myRecordCountLabel = (n: number) =>
  n >= 3
    ? `${n} recorded valuation events — chart shows the timeline`
    : n > 0
      ? `${n} event${n === 1 ? '' : 's'} — a chart appears from three events`
      : 'none yet';

function StatusBadge({ status }: { status: AssetStatus }) {
  if (status === 'sold') return <Badge tone="positive">Sold</Badge>;
  if (status === 'archived') return <Badge tone="warning">Archived</Badge>;
  return <Badge tone="accent">Active</Badge>;
}

/* ---------------- attribute rows ---------------- */

function attributeRows(a: Asset): [string, string, boolean?][] {
  const attr = a.attributes as unknown as Record<string, unknown>;
  const rows: [string, string, boolean?][] = [];
  const s = (k: string) => (typeof attr[k] === 'number' || typeof attr[k] === 'string' ? String(attr[k]) : attr[k] == null ? '' : JSON.stringify(attr[k]));
  const pct = (v: unknown) => (typeof v === 'number' ? `${v}%` : '');
  const money = (v: number | null | undefined) => (v == null ? '' : v.toLocaleString('en-US'));
  switch (a.category) {
    case 'gold_silver':
      rows.push(
        ['Metal', s('metal')],
        ['Form', s('form')],
        ['Weight', `${attr.weight ?? ''} ${attr.weightUnit ?? ''}`.trim()],
        ['Purity', s('purity')],
        ['Dealer spread', pct(attr.dealerSpreadPct) || '—'],
      );
      if (s('craftsmanshipNote')) rows.push(['Craftsmanship', s('craftsmanshipNote')]);
      break;
    case 'gems_jewelry':
      rows.push(
        ['Item type', s('itemType')],
        ['Gemstone', s('gemstoneType')],
        ['Gem weight', attr.gemWeight ? `${attr.gemWeight} ${attr.gemWeightUnit === 'g' ? 'g' : 'ct'}` : ''],
        ['Material', s('material')],
        ['Certification', s('certification')],
        ['Condition', s('condition')],
      );
      break;
    case 'watches':
      rows.push(
        ['Brand', s('brand')],
        ['Model', s('model')],
        ['Reference', s('reference')],
        ['Serial', s('serial'), true],
        ['Condition', s('condition')],
        ['Box & papers', attr.boxAndPapers ? 'Yes' : 'Partial or none'],
      );
      break;
    case 'land_property': {
      const area = formatArea(a.attributes as any);
      rows.push(
        ['Type', s('propertyType')],
        ['District', s('district')],
        ['Locality', s('city')],
        ...(['address', 'roadAccess', 'utilities', 'zoning'] as const).map((k) => [k[0].toUpperCase() + k.slice(1), s(k), k === 'address'] as [string, string, boolean?]),
      );
      if (area) rows.push(['Size', area]);
      break;
    }
    case 'cars':
      rows.push(
        ['Make / model', `${s('make')} ${s('model')}`],
        ['Year', s('year')],
        ['Variant', s('variant')],
        ['Odometer', attr.mileageKm ? `${money(attr.mileageKm as number)} km` : ''],
        ['Fuel', s('fuelType')],
        ['Condition', s('condition')],
        ['Registration', s('registration'), true],
      );
      break;
    case 'motorcycles':
      rows.push(
        ['Make / model', `${s('make')} ${s('model')}`],
        ['Year', s('year')],
        ['Engine', attr.engineCc ? `${attr.engineCc} cc` : ''],
        ['Odometer', attr.mileageKm ? `${money(attr.mileageKm as number)} km` : ''],
        ['Condition', s('condition')],
      );
      break;
    case 'other':
      rows.push(
        ['Kind', s('kind')],
        ['Description', s('description')],
      );
      break;
    default:
      break;
  }
  // purchase record
  rows.push(
    ['Purchase date', a.purchase.date ?? ''],
    ['Paid', a.purchase.priceOriginal != null ? `${a.purchase.priceOriginal.toLocaleString('en-US')} ${a.purchase.currency ?? 'LKR'}` : ''],
    ['Sale', a.status === 'sold' && a.sold?.date ? `${formatDate(a.sold.date)}${a.sold.proceedsLkr != null ? ` · ${money(a.sold.proceedsLkr)} LKR` : ''}` : ''],
  );
  return rows;
}

/* ---------------- Modals ---------------- */

function DeleteModal({ open, onClose, asset, onDeleted }: { open: boolean; onClose: () => void; asset: Asset; onDeleted: () => void }) {
  const { deleteAsset, pushToast } = useData();
  const [ack, setAck] = useState('');
  return (
    <Modal
      open={open}
      onClose={() => {
        setAck('');
        onClose();
      }}
      title="Delete asset"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={ack !== asset.name}
            onClick={async () => {
              const ok = await deleteAsset(asset.id);
              setAck('');
              onClose();
              if (ok) {
                pushToast({ kind: 'success', title: 'Asset deleted', body: `${asset.name} was removed with its valuation history.` });
                onDeleted();
              }
            }}
          >
            <Trash2 size={14} /> Delete permanently
          </Button>
        </>
      }
    >
      <p className="text-sm text-txt-muted">
        This permanently removes <strong className="text-txt">{asset.name}</strong> and its entire valuation
        history. Type the asset name to confirm:
      </p>
      <Input className="mt-3" value={ack} onChange={(e) => setAck(e.target.value)} placeholder={asset.name} />
      <p className="text-[11px] text-txt-dim mt-3">
        Prefer to keep it for the record? <strong className="text-txt-muted">Mark sold</strong> or archive it instead.
      </p>
    </Modal>
  );
}

function ValuationModal({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: Asset }) {
  const { updateAsset, pushToast, assets } = useData();
  const current = assets.find((a) => a.id === asset.id) ?? asset;
  const [value, setValue] = useState(String(current.valuation.valueLkr ?? ''));
  const [valDate, setValDate] = useState(new Date().toISOString().slice(0, 10));
  const [confidence, setConfidence] = useState(current.valuation.confidence);
  const [note, setNote] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update valuation"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const v = parseNum(value);
              if (v === null || v < 0) {
                pushToast({ kind: 'error', title: 'Enter a valid value' });
                return;
              }
              const isoDate = valDate ? new Date(valDate).toISOString() : new Date().toISOString();
              const ok = await updateAsset(
                asset.id,
                {
                  valuation: {
                    valueLkr: v,
                    method: 'user',
                    sourceLabel: 'Owner estimate',
                    confidence,
                    note: note.trim() || null,
                    updatedAt: isoDate,
                  },
                },
                { valuationRecord: true, valuationNote: note.trim() || undefined },
              );
              if (ok) {
                pushToast({ kind: 'success', title: 'Valuation updated', body: 'A valuation event was recorded in the history.' });
                onClose();
              }
            }}
          >
            Save valuation
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estimated value (LKR)" required>
            <Input type="number" inputMode="decimal" min="0" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Valuation date">
            <Input
              type="date"
              value={valDate}
              onChange={(e) => setValDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
            />
          </Field>
        </div>
        <Field label="Confidence">
          <Select value={confidence} onChange={(e) => setConfidence(e.target.value as 'high' | 'medium' | 'low')}>
            <option value="high">High — recent sale or appraisal</option>
            <option value="medium">Medium — marketplace comparisons</option>
            <option value="low">Low — rough estimate</option>
          </Select>
        </Field>
        <Field label="Why this value?" hint="Recorded with the valuation event.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. dealer quote, comparable sale, verified weight…" />
        </Field>
        <p className="text-[11px] text-txt-dim">
          Owner valuations are recorded as transparent history. You can view all historical valuations in the chart and log below.
        </p>
      </div>
    </Modal>
  );
}

function SoldModal({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: Asset }) {
  const { markSold, pushToast, settings } = useData();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [proceeds, setProceeds] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark as sold"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const ok = await markSold(asset.id, date, parseNum(proceeds));
              if (ok) {
                pushToast({
                  kind: 'success',
                  title: 'Marked as sold',
                  body: `Excluded from active totals; ${proceeds && parseNum(proceeds) ? 'proceeds' : 'record'} kept in history.`,
                });
                onClose();
              }
            }}
          >
            Save sale record
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Sale date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Sale proceeds (LKR, optional)">
          <Input type="number" inputMode="decimal" min="0" value={proceeds} onChange={(e) => setProceeds(e.target.value)} placeholder="Actual amount received" />
        </Field>
        <p className="text-[11px] text-txt-dim">
          The asset stays in your records under “Sold”, preserving history. Net sale gain compares proceeds with your purchase cost
          {settings.displayCurrency === 'USD' ? '' : ''}.
        </p>
      </div>
    </Modal>
  );
}

function EditModal({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: Asset }) {
  const { updateAsset, pushToast } = useData();
  const [name, setName] = useState(asset.name);
  const [quantity, setQuantity] = useState(String(asset.quantity ?? 1));
  const [price, setPrice] = useState(String(asset.purchase.priceOriginal ?? ''));
  const [date, setDate] = useState(asset.purchase.date ?? '');
  const [resale, setResale] = useState(String(asset.resaleValueLkr ?? ''));
  const [notes, setNotes] = useState(asset.notes ?? '');
  const reset = () => {
    setName(asset.name);
    setQuantity(String(asset.quantity ?? 1));
    setPrice(String(asset.purchase.priceOriginal ?? ''));
    setDate(asset.purchase.date ?? '');
    setResale(String(asset.resaleValueLkr ?? ''));
    setNotes(asset.notes ?? '');
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Edit asset"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const ok = await updateAsset(asset.id, {
                name: name.trim() || asset.name,
                quantity: Math.max(1, parseNum(quantity) ?? 1),
                purchase: { ...asset.purchase, priceOriginal: parseNum(price), priceLkr: parseNum(price), date: date || null },
                resaleValueLkr: parseNum(resale),
                notes: notes || null,
              });
              if (ok) {
                pushToast({ kind: 'success', title: 'Asset updated' });
                onClose();
              }
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="Quantity" hint="Items">
            <Input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase price (recorded currency)" hint={`Stored as ${asset.purchase.currency ?? 'LKR'}`}>
            <Input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Purchase date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Estimated resale value (LKR)">
          <Input type="number" inputMode="decimal" value={resale} onChange={(e) => setResale(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="text-[11px] text-txt-dim">Category attributes are preserved. Valuation history is never touched by an edit.</p>
      </div>
    </Modal>
  );
}

function ImageModal({ open, onClose, asset, busy }: { open: boolean; onClose: () => void; asset: Asset; busy: boolean }) {
  const { updateAsset, pushToast } = useData();
  const [pending, setPending] = useState<string | null>(null);
  const [sizeWarn, setSizeWarn] = useState(false);
  return (
    <Modal
      open={open}
      onClose={() => {
        setPending(null);
        onClose();
      }}
      title="Asset photo"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {asset.image && (
            <Button
              variant="danger"
              onClick={async () => {
                await updateAsset(asset.id, { image: null });
                onClose();
              }}
            >
              Remove
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!pending || busy}
            onClick={async () => {
              if (!pending) return;
              const ok = await updateAsset(asset.id, { image: pending });
              if (ok) {
                pushToast({ kind: 'success', title: 'Photo saved' });
                onClose();
              }
            }}
          >
            {busy && <TrendingDown size={0} aria-hidden />}
            Save photo
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <input
          type="file"
          accept="image/*"
          className="text-sm text-txt-muted file:mr-3 file:rounded-lg file:border-0 file:bg-ink-800 file:px-3 file:py-2 file:text-sm file:text-txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 400_000) {
              setSizeWarn(true);
              setPending(null);
              return;
            }
            setSizeWarn(false);
            const reader = new FileReader();
            reader.onload = () => setPending(String(reader.result));
            reader.readAsDataURL(f);
          }}
        />
        {sizeWarn && <p className="text-[11px] text-rose-400">Max size is 400 KB — choose a smaller image.</p>}
        {pending && (
          <img src={pending} alt="Preview" className="max-h-56 rounded-lg border border-ink-700" />
        )}
        <p className="text-[11px] text-txt-dim">
          Photos stay with your data — never listed publicly or leaked in exported JSON (stored as data URLs). {asset.image && <span>Removing a photo does not alter history.</span>}
        </p>
        <p className="text-[11px] text-txt-dim flex items-center gap-1">
          <Lock size={10} /> {import.meta.env.MODE === 'development' ? 'Stored locally / in your account.' : 'Stored in your account.'}
        </p>
      </div>
    </Modal>
  );
}
