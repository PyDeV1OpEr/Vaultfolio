import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Plus } from 'lucide-react';
import { z } from 'zod';
import { useData } from '../store/dataStore';
import { CATEGORIES, categoryMeta } from '../lib/categories';
import { AREA_UNITS, GOLD_KARATS, METAL_WEIGHT_UNITS, SILVER_FINENESS, sqftFromPerches, sqmFromPerches } from '../lib/units';
import { SUPPORTED_CURRENCIES, parseNum } from '../lib/money';
import { resolveAssetValuation } from '../lib/valuation';
import type {
  Asset,
  AssetCategory,
  CurrencyCode,
  GoldSilverAttrs,
  ValuationConfidence,
} from '../lib/types';
import { Button, Card, CardHeader, Field, Input, Modal, Select, Textarea } from '../components/ui';

/* ---------------- Shared pieces ---------------- */

const num = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : parseNum(v)));
// refines are applied at submit-time per category

const positive = (v: number | null) => v === null || v > 0;

const requiredPositive = (label: string) => (v: number | null) =>
  v !== null && Number.isFinite(v) && v > 0 ? true : `${label} must be a positive number`;

function PurchaseSection({
  state,
  set,
  errors,
}: {
  state: Record<string, string>;
  set: (k: string, v: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Purchase date" hint="Leave blank if you don't remember exactly.">
          <Input type="date" value={state.purchaseDate ?? ''} onChange={(e) => set('purchaseDate', e.target.value)} max={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Total paid (incl. premiums & fees)" required>
          <Input type="number" inputMode="decimal" min="0" value={state.purchasePrice ?? ''} onChange={(e) => set('purchasePrice', e.target.value)} placeholder="e.g. 450000" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Purchase currency">
          <Select value={state.purchaseCurrency ?? 'LKR'} onChange={(e) => set('purchaseCurrency', e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Extra purchase costs (LKR)" hint="Duty, fees, transport…">
          <Input type="number" inputMode="decimal" min="0" value={state.extraCosts ?? ''} onChange={(e) => set('extraCosts', e.target.value)} placeholder="0" />
        </Field>
      </div>
      {errors.purchasePrice && <p className="text-xs text-rose-400 -mt-1.5">{errors.purchasePrice}</p>}
    </div>
  );
}

const CONDITIONS = ['Excellent', 'Very good', 'Good', 'Fair', 'Poor', 'Needs work'];

function CurrentEstimateSection({
  state,
  set,
  errors,
  edgeNote,
}: {
  state: Record<string, string>;
  set: (k: string, v: string) => void;
  errors: Record<string, string>;
  edgeNote?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Estimated value today (LKR)" required>
          <Input type="number" inputMode="decimal" min="0" value={state.estimate ?? ''} onChange={(e) => set('estimate', e.target.value)} placeholder="Your best estimate" />
        </Field>
        <Field label="How confident are you?">
          <Select value={state.confidence ?? 'medium'} onChange={(e) => set('confidence', e.target.value)}>
            <option value="high">High — checked against recent sales</option>
            <option value="medium">Medium — prior owners or listing comparisons</option>
            <option value="low">Low — rough guess</option>
          </Select>
        </Field>
      </div>
      <Field label="Estimated resale value (LKR)" hint="What a dealer or market would realistically pay (often below retail).">
        <Input type="number" inputMode="decimal" min="0" value={state.resale ?? ''} onChange={(e) => set('resale', e.target.value)} placeholder="Optional" />
      </Field>
      {edgeNote}
      {errors.estimate && <p className="text-xs text-rose-400 -mt-1.5">{errors.estimate}</p>}
    </div>
  );
}

const CATEGORY_NOTE: Record<AssetCategory, string> = {
  gold_silver:
    'Vaultfolio values gold & silver transparently from fine-metal content — jewelry premiums are not assumed to be recoverable.',
  gems_jewelry:
    'Gem values are owner estimates: Vaultfolio cannot authenticate gemstones or price them from photos alone.',
  watches:
    'A manual estimate is fine — Vaultfolio does not assume watches appreciate without market evidence.',
  land_property:
    'Land values are user estimates only. Without comparable transaction data no market valuation can be inferred.',
  cars: 'Keep registration numbers in “Private registration” — they are never exported or printed.',
  motorcycles: 'Engine capacity and condition help you document the bike; values remain owner estimates.',
  other: 'Describe the item well — future-you will appreciate it.',
};

/* ---------------- Root page ---------------- */

export function AddAsset() {
  const { market, settings, addAsset, busy } = useData();
  const navigate = useNavigate();
  const [category, setCategory] = useState<AssetCategory | null>(null);
  const [state, setState] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [name, setName] = useState('');

  const set = (k: string, v: string) => setState((s) => ({ ...s, [k]: v }));

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Give the asset a name.';
    if (category) {
      const p = parseNum(state.purchasePrice ?? '');
      if (p === null) errs.purchasePrice = 'Enter what you paid (0 allowed).';
      else if (p < 0) errs.purchasePrice = 'Cannot be negative.';
      else if (category !== 'gold_silver' && category !== 'watches' && category !== 'cars' && category !== 'motorcycles') {
        const est = parseNum(state.estimate ?? '');
        if (est === null && !(state.estimateNotes ?? '').trim())
          errs.estimate = 'Enter your value estimate or describe why it is unavailable.';
      } else if (!(state.estimate ?? '').trim()) {
        // gold_silver supports calculated estimates; others manual
        const est = parseNum(state.estimate ?? '');
        if (category !== 'gold_silver' && est === null && category !== 'watches')
          errs.estimate = 'Enter your estimate (or 0-backed note above).';
      }
      // category extras
      if (category === 'gold_silver') {
        const w = parseNum(state.weight ?? '');
        if (w === null || !positive(w)) errs.weight = 'Weight must be a positive number.';
        if (!(state.purity ?? '').trim()) errs.purity = 'Purity is required (e.g. 22k, 999).';
      }
      if (category === 'cars' || category === 'motorcycles') {
        if (!state.make?.trim()) errs.make = 'Make is required.';
        if (!state.model?.trim()) errs.model = 'Model is required.';
        const yr = parseNum(state.year ?? '');
        if (!yr || yr < 1900 || yr > new Date().getFullYear() + 1) errs.year = 'Enter a valid year.';
      }
      if (category === 'land_property') {
        if (!state.district?.trim()) errs.district = 'District is required.';
        const pr = parseNum(state.sizePerches ?? '');
        if (pr === null || !positive(pr)) errs.sizePerches = 'Enter land size in perches (> 0).';
      }
      if (category === 'gems_jewelry' && !state.itemType) errs.itemType = 'Choose an item type.';
      if (category === 'other' && !state.kind?.trim()) errs.kind = 'Say what kind of asset this is.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!category || !validate()) {
      setErrors((e) => (Object.keys(e).length === 0 ? { ...e, name: name.trim() ? '' : 'Give the asset a name.' } : e));
      if (!category) return;
    }
    const paid = parseNum(state.purchasePrice ?? '');
    const purchaseLkr =
      !category || paid === null
        ? null
        : state.purchaseCurrency === 'USD'
          ? Math.round(paid * (market?.usdLkr ?? 300))
          : paid;
    const estimate = parseNum(state.estimate ?? '');
    const isGoldSilver = category === 'gold_silver';
    const attrs = buildAttributes(category!, state, settings.locale);
    const estimateAvailable =
      estimate !== null ||
      (state.estimateNotes ?? '') !== '' ||
      isGoldSilver;
    const assetInput: Omit<Asset, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
      category,
      name: name.trim(),
      status: 'active',
      attributes: attrs,
      purchase: {
        priceLkr: purchaseLkr,
        currency: (state.purchaseCurrency ?? 'LKR') as CurrencyCode,
        priceOriginal: parseNum(state.purchasePrice ?? ''),
        date: state.purchaseDate || null,
        extraCostsLkr: parseNum(state.extraCosts ?? ''),
      },
      valuation: {
        valueLkr:
          estimate !== null
            ? estimate
            : isGoldSilver
              ? null // resolved live by the engine from metal content
              : null,
        method:
          estimate !== null
            ? 'user'
            : isGoldSilver
              ? 'calculated'
              : 'unavailable',
        sourceLabel:
          estimate !== null
            ? 'Owner estimate'
            : isGoldSilver
              ? 'Calculated from metal content'
              : 'Not yet valued',
        confidence: (state.confidence ?? 'medium') as ValuationConfidence,
        note:
          (state.estimateNotes ?? '') !== ''
            ? state.estimateNotes
            : state.isDemoAware === 'true'
              ? 'Demo'
              : null,
        updatedAt: new Date().toISOString(),
      },
      resaleValueLkr: parseNum(state.resale ?? ''),
      notes: state.notes || null,
      image: null,
      sold: null,
    };
    if (!estimateAvailable && !isGoldSilver) {
      // unreachable via validation, safety net
      return;
    }
    const id = await addAsset(assetInput, {
      valuationRecord: estimate !== null,
      valuationNote: state.estimateNotes || null,
    });
    if (id) navigate(`/portfolio/${id}`);
  };

  const previewValue = useMemo(() => {
    if (category !== 'gold_silver') return null;
    const attrs = buildAttributes(category, state, settings.locale);
    if (!market || !name.trim()) return null;
    const draft: Asset = {
      id: 'draft',
      userId: 'draft',
      category,
      name,
      status: 'active',
      attributes: attrs,
      purchase: {},
      valuation: { method: 'calculated', sourceLabel: '', confidence: 'low', updatedAt: '' },
      createdAt: '',
      updatedAt: '',
    } as unknown as Asset;
    return resolveAssetValuation(draft, market).valueLkr;
  }, [category, state, market, name, settings.locale]);

  /* -------- Step 1: category choice -------- */
  if (!category) {
    return (
      <div className="max-w-3xl mx-auto animate-fadeUp">
        <button onClick={() => setConfirmCancel(true)} className="text-sm text-txt-muted hover:text-txt flex items-center gap-1 mb-4">
          <ArrowLeft size={14} /> Cancel
        </button>
        <h1 className="text-xl lg:text-2xl font-semibold">What would you like to add?</h1>
        <p className="text-sm text-txt-muted mt-1">Every category has a form built for that asset type.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCategory(c.id);
                setState({});
                setErrors({});
              }}
              className="text-left bg-ink-900 border border-ink-700 rounded-xl p-4 hover:border-accent/50 hover:bg-ink-850 transition-colors group"
            >
              <c.icon size={22} className={c.id === 'gold_silver' ? 'text-amber-300' : 'text-accent'} />
              <p className="font-medium mt-3 text-sm">{c.label}</p>
              <p className="text-[12px] text-txt-muted mt-1 leading-relaxed">{c.blurb}</p>
            </button>
          ))}
        </div>
        <CancelModal open={confirmCancel} onClose={() => setConfirmCancel(false)} />
      </div>
    );
  }

  /* -------- Step 2: category form -------- */
  const meta = categoryMeta(category);
  return (
    <div className="max-w-2xl mx-auto animate-fadeUp">
      <button
        onClick={() => {
          setConfirmCancel(true);
        }}
        className="text-sm text-txt-muted hover:text-txt flex items-center gap-1 mb-4"
      >
        <ArrowLeft size={14} /> Back
      </button>
      <div className="flex items-center gap-3">
        <meta.icon size={26} className={category === 'gold_silver' ? 'text-amber-300' : 'text-accent'} />
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold">Add {meta.label}</h1>
          <p className="text-sm text-txt-muted mt-0.5">{CATEGORY_NOTE[category]}</p>
        </div>
      </div>

      <Card className="mt-5 space-y-6 p-5">
        <Field label="Asset name" required error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g.22k Gold Bangle" maxLength={120} />
        </Field>

        <CategoryFields category={category} state={state} set={set} errors={errors} previewValue={previewValue} />

        <div className="border-t border-ink-800 pt-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-txt-dim">Purchase</h3>
          <PurchaseSection state={state} set={set} errors={errors} />
        </div>

        <div className="border-t border-ink-800 pt-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-txt-dim">Valuation</h3>
          <CurrentEstimateSection
            state={state}
            set={set}
            errors={errors}
            edgeNote={
              category === 'gold_silver' ? (
                <p className="text-[11px] text-txt-dim">
                  Leave the estimate blank to value this purely by fine-metal content at market prices
                  {market?.isDemo === false ? '' : ''}. Enter one to pin your own valuation (e.g. jewelry resale premium).
                </p>
              ) : category === 'land_property' ? (
                <p className="text-[11px] text-amber-400/80">
                  Vaultfolio does not appraise land. Your figure is treated as an owner estimate — record how
                  you arrived at it in the note field.
                </p>
              ) : null
            }
          />
          <Field label="How did you arrive at this value?" hint="Optional, but strongly recommended for future-you.">
            <Textarea value={state.estimateNotes ?? ''} onChange={(e) => set('estimateNotes', e.target.value)} placeholder="e.g. compared with dealer rates in June; naval priced here… " />
          </Field>
        </div>

        <div className="border-t border-ink-800 pt-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-txt-dim">Extra</h3>
          <Field label="Notes" hint="Condition details, storage, insurance…">
            <Textarea value={state.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-2 border-t border-ink-800 pt-4">
          <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            <Check size={14} /> Save asset
          </Button>
        </div>
      </Card>
      <CancelModal open={confirmCancel} onClose={() => setConfirmCancel(false)} />
    </div>
  );
}

/* ---------------- Category-specific fields ---------------- */

function CategoryFields({
  category,
  state,
  set,
  errors,
  previewValue,
}: {
  category: AssetCategory;
  state: Record<string, string>;
  set: (k: string, v: string) => void;
  errors: Record<string, string>;
  previewValue: number | null;
}) {
  switch (category) {
    case 'gold_silver':
      return <GoldSilverFields state={state} set={set} errors={errors} previewValue={previewValue} />;
    case 'gems_jewelry':
      return <GemsFields state={state} set={set} errors={errors} />;
    case 'watches':
      return <WatchFields state={state} set={set} errors={errors} />;
    case 'land_property':
      return <LandFields state={state} set={set} errors={errors} />;
    case 'cars':
      return <CarFields state={state} set={set} errors={errors} />;
    case 'motorcycles':
      return <MotorcycleFields state={state} set={set} errors={errors} />;
    case 'other':
      return <OtherFields state={state} set={set} errors={errors} />;
    default:
      return null;
  }
}

function GoldSilverFields({
  state,
  set,
  errors,
  previewValue,
}: {
  state: Record<string, string>;
  set: (k: string, v: string) => void;
  errors: Record<string, string>;
  previewValue: number | null;
}) {
  const metal = (state.metal ?? 'gold') as GoldSilverAttrs['metal'];
  return (
    <div className="space-y-3 pt-4 border-t border-ink-800">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Metal" required>
          <Select value={metal} onChange={(e) => set('metal', e.target.value)}>
            <option value="gold">Gold</option>
            <option value="silver">Silver</option>
          </Select>
        </Field>
        <Field label="Form" required>
          <Select value={state.form ?? 'bullion'} onChange={(e) => set('form', e.target.value)}>
            <option value="bullion">Bullion (bar)</option>
            <option value="coin">Coin</option>
            <option value="jewelry">Jewelry</option>
            <option value="other">Other</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Weight" required error={errors.weight}>
          <Input type="number" inputMode="decimal" min="0" step="any" value={state.weight ?? ''} onChange={(e) => set('weight', e.target.value)} />
        </Field>
        <Field label="Weight unit">
          <Select value={state.weightUnit ?? 'g'} onChange={(e) => set('weightUnit', e.target.value)}>
            {METAL_WEIGHT_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Purity" required error={errors.purity} hint={metal === 'gold' ? 'Karat or millesimal (916 → 22k).' : 'Fineness (999, 925…)'}>
          {metal === 'gold' ? (
            <Select value={state.purity ?? ''} onChange={(e) => set('purity', e.target.value)}>
              <option value="" disabled>
                Select karat
              </option>
              {GOLD_KARATS.map((k) => (
                <option key={k} value={k}>
                  {k} ({Math.round((parseFloat(k) / 24) * 1000)}/1000)
                </option>
              ))}
              <option value="916">916 (22k traditional)</option>
              <option value="custom — enter below">Other…</option>
            </Select>
          ) : (
            <Select value={state.purity ?? ''} onChange={(e) => set('purity', e.target.value)}>
              <option value="" disabled>
                Select fineness
              </option>
              {SILVER_FINENESS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
              <option value="sterling">Sterling</option>
            </Select>
          )}
        </Field>
      </div>
      {state.purity === 'custom — enter below' && (
        <Field label="Custom purity" required hint="e.g. .875 or 21k">
          <Input value={state.purityCustom ?? ''} onChange={(e) => set('purityCustom', e.target.value)} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dealer spread on resale (%)" hint="Typical: bullion 2–5%, jewelry 8–15%.">
          <Input type="number" inputMode="decimal" min="0" max="50" value={state.dealerSpread ?? ''} onChange={(e) => set('dealerSpread', e.target.value)} placeholder="e.g. 8" />
        </Field>
        <Field label="Craftsmanship / premium note">
          <Input value={state.craftsmanshipNote ?? ''} onChange={(e) => set('craftsmanshipNote', e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {previewValue !== null && (
        <div className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-[13px]">
          <span className="text-accent font-medium">Calculated fine-metal value: </span>
          <span className="tnum">LKR {Math.round(previewValue).toLocaleString('en-US')}</span>
          <p className="text-[11px] text-txt-muted mt-1">
            weight × purity × market price — jewelry premiums are not included.
          </p>
        </div>
      )}
    </div>
  );
}

function GemsFields({ state, set, errors }: { state: Record<string, string>; set: (k: string, v: string) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-3 pt-4 border-t border-ink-800">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Item type" required error={errors.itemType}>
          <Select value={state.itemType ?? ''} onChange={(e) => set('itemType', e.target.value)}>
            <option value="" disabled>
              Select
            </option>
            <option value="gemstone">Loose gemstone</option>
            <option value="jewelry">Jewelry</option>
          </Select>
        </Field>
        <Field label="Gemstone type" hint="e.g. Blue sapphire, ruby, yellow sapphire">
          <Input value={state.gemstoneType ?? ''} onChange={(e) => set('gemstoneType', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Gem weight" hint="If known">
          <Input type="number" inputMode="decimal" min="0" step="any" value={state.gemWeight ?? ''} onChange={(e) => set('gemWeight', e.target.value)} />
        </Field>
        <Field label="Gem unit">
          <Select value={state.gemWeightUnit ?? 'ct'} onChange={(e) => set('gemWeightUnit', e.target.value)}>
            <option value="ct">Carats (ct)</option>
            <option value="g">Grams (g)</option>
          </Select>
        </Field>
        <Field label="Condition">
          <Select value={state.condition ?? 'Good'} onChange={(e) => set('condition', e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Metal / material" hint="Setting or mounting">
          <Input value={state.material ?? ''} onChange={(e) => set('material', e.target.value)} placeholder="e.g. 18k gold setting" />
        </Field>
        <Field label="Certification" hint="Lab, year, report no. — as listed">
          <Input value={state.certification ?? ''} onChange={(e) => set('certification', e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <p className="text-[11px] text-txt-dim">
        Vaultfolio cannot authenticate gemstones or certify market value — an owner estimate is what the app records.
      </p>
    </div>
  );
}

function WatchFields({ state, set, errors }: { state: Record<string, string>; set: (k: string, v: string) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-3 pt-4 border-t border-ink-800">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Brand" required>
          <Input value={state.brand ?? ''} onChange={(e) => set('brand', e.target.value)} placeholder="e.g. Omega" />
        </Field>
        <Field label="Model" required>
          <Input value={state.model ?? ''} onChange={(e) => set('model', e.target.value)} placeholder="e.g. Seamaster 300M" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Reference no." hint="Optional">
          <Input value={state.reference ?? ''} onChange={(e) => set('reference', e.target.value)} />
        </Field>
        <Field label="Condition">
          <Select value={state.condition ?? 'Good'} onChange={(e) => set('condition', e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Box & papers">
          <Select value={state.boxAndPapers ?? 'some'} onChange={(e) => set('boxAndPapers', e.target.value)}>
            <option value="full">Box + papers</option>
            <option value="some">Box or papers only</option>
            <option value="none">Neither</option>
          </Select>
        </Field>
      </div>
      <Field label="Serial number" hint="Private: stored only for you, never exported.">
        <Input value={state.serial ?? ''} onChange={(e) => set('serial', e.target.value)} placeholder="Optional" />
      </Field>
    </div>
  );
}

function LandFields({ state, set, errors }: { state: Record<string, string>; set: (k: string, v: string) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-3 pt-4 border-t border-ink-800">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Property type" required>
          <Select value={state.propertyType ?? 'Bare land'} onChange={(e) => set('propertyType', e.target.value)}>
            <option>Bare land</option>
            <option>House</option>
            <option>Condominium/apartment</option>
            <option>Commercial property</option>
            <option>Tea/estate land</option>
          </Select>
        </Field>
        <Field label="District" required error={errors.district}>
          <Input value={state.district ?? ''} onChange={(e) => set('district', e.target.value)} placeholder="e.g. Kandy" list="lk-districts" />
          <datalist id="lk-districts">
            {['Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale', 'Nuwara Eliya', 'Galle', 'Matara', 'Hambantota', 'Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu', 'Batticaloa', 'Ampara', 'Trincomalee', 'Kurunegala', 'Puttalam', 'Anuradhapura', 'Polonnaruwa', 'Badulla', 'Monaragala', 'Ratnapura', 'Kegalle'].map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City / town / locality" required>
          <Input value={state.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Precise address or GPS" hint="Optional — privacy: never exposed publicly">
          <Input value={state.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Land size (perches)" required error={errors.sizePerches}>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={state.sizePerches ?? ''}
            onChange={(e) => {
              set('sizePerches', e.target.value);
              const p = parseNum(e.target.value);
              if (p !== null) {
                set('sizeSqft', String(Math.round(sqftFromPerches(p) * 100) / 100));
                set('sizeSqm', String(Math.round(sqmFromPerches(p) * 10) / 10));
              }
            }}
          />
        </Field>
        <Field label="Square feet">
          <Input type="number" inputMode="decimal" min="0" step="any" value={state.sizeSqft ?? ''} onChange={(e) => set('sizeSqft', e.target.value)} />
        </Field>
        <Field label="Square meters">
          <Input type="number" inputMode="decimal" min="0" step="any" value={state.sizeSqm ?? ''} onChange={(e) => set('sizeSqm', e.target.value)} />
        </Field>
      </div>
      <p className="text-[11px] text-txt-dim -mt-1.5">Conversion used: 1 Sri Lankan perch = 272.25 sq ft (25.29 sq m).</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Road access">
          <Input value={state.roadAccess ?? ''} onChange={(e) => set('roadAccess', e.target.value)} placeholder="e.g. main road, 6m frontage" />
        </Field>
        <Field label="Utilities">
          <Input value={state.utilities ?? ''} onChange={(e) => set('utilities', e.target.value)} placeholder="water, electricity…" />
        </Field>
        <Field label="Zoning / land use" hint="If known">
          <Input value={state.zoning ?? ''} onChange={(e) => set('zoning', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

function CarFields({ state, set, errors }: { state: Record<string, string>; set: (k: string, v: string) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-3 pt-4 border-t border-ink-800">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Make" required error={errors.make}>
          <Input value={state.make ?? ''} onChange={(e) => set('make', e.target.value)} placeholder="e.g. Toyota" />
        </Field>
        <Field label="Model" required error={errors.model}>
          <Input value={state.model ?? ''} onChange={(e) => set('model', e.target.value)} />
        </Field>
        <Field label="Year" required error={errors.year}>
          <Input type="number" inputMode="numeric" min="1900" max={new Date().getFullYear() + 1} value={state.year ?? ''} onChange={(e) => set('year', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Variant">
          <Input value={state.variant ?? ''} onChange={(e) => set('variant', e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Odometer (km)">
          <Input type="number" inputMode="numeric" min="0" value={state.mileage ?? ''} onChange={(e) => set('mileage', e.target.value)} />
        </Field>
        <Field label="Condition">
          <Select value={state.condition ?? 'Good'} onChange={(e) => set('condition', e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fuel type">
          <Select value={state.fuelType ?? ''} onChange={(e) => set('fuelType', e.target.value)}>
            <option value="">—</option>
            <option>Petrol</option>
            <option>Diesel</option>
            <option>Hybrid petrol</option>
            <option>Electric</option>
          </Select>
        </Field>
        <Field label="Registration number" hint="Private: never exported or shown publicly">
          <Input value={state.registration ?? ''} onChange={(e) => set('registration', e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </div>
  );
}

function MotorcycleFields({ state, set, errors }: { state: Record<string, string>; set: (k: string, v: string) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-3 pt-4 border-t border-ink-800">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Make" required error={errors.make}>
          <Input value={state.make ?? ''} onChange={(e) => set('make', e.target.value)} placeholder="e.g. Honda" />
        </Field>
        <Field label="Model" required error={errors.model}>
          <Input value={state.model ?? ''} onChange={(e) => set('model', e.target.value)} />
        </Field>
        <Field label="Year" required error={errors.year}>
          <Input type="number" inputMode="numeric" min="1900" max={new Date().getFullYear() + 1} value={state.year ?? ''} onChange={(e) => set('year', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Engine (cc)">
          <Input type="number" inputMode="numeric" min="0" value={state.engineCc ?? ''} onChange={(e) => set('engineCc', e.target.value)} />
        </Field>
        <Field label="Odometer (km)">
          <Input type="number" inputMode="numeric" min="0" value={state.mileage ?? ''} onChange={(e) => set('mileage', e.target.value)} />
        </Field>
        <Field label="Condition">
          <Select value={state.condition ?? 'Good'} onChange={(e) => set('condition', e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}

function OtherFields({ state, set, errors }: { state: Record<string, string>; set: (k: string, v: string) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-3 pt-4 border-t border-ink-800">
      <Field label="What kind of asset?" required error={errors.kind}>
        <Input value={state.kind ?? ''} onChange={(e) => set('kind', e.target.value)} placeholder="e.g. Antique furniture, artwork" />
      </Field>
      <Field label="Description">
        <Textarea value={state.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Condition, provenance, anything that matters." />
      </Field>
    </div>
  );
}

/* ---------------- Helpers ---------------- */

function buildAttributes(category: AssetCategory, s: Record<string, string>, _locale: string): Asset['attributes'] {
  switch (category) {
    case 'gold_silver': {
      const purity = s.purity === 'custom — enter below' ? s.purityCustom ?? s.purity : s.purity ?? '';
      return {
        metal: (s.metal ?? 'gold') as GoldSilverAttrs['metal'],
        form: (s.form ?? 'bullion') as GoldSilverAttrs['form'],
        weight: parseNum(s.weight) ?? 0,
        weightUnit: (s.weightUnit ?? 'g') as GoldSilverAttrs['weightUnit'],
        purity,
        dealerSpreadPct: parseNum(s.dealerSpread),
        craftsmanshipNote: s.craftsmanshipNote || null,
      } satisfies GoldSilverAttrs;
    }
    case 'gems_jewelry':
      return {
        itemType: (s.itemType ?? 'gemstone') as 'gemstone' | 'jewelry',
        gemstoneType: s.gemstoneType || null,
        gemWeight: parseNum(s.gemWeight),
        gemWeightUnit: (s.gemWeightUnit ?? 'ct') as 'ct' | 'g',
        material: s.material || null,
        certification: s.certification || null,
        condition: s.condition ?? 'Good',
      };
    case 'watches':
      return {
        brand: s.brand ?? '',
        model: s.model ?? '',
        reference: s.reference || null,
        serial: s.serial || null,
        condition: s.condition ?? 'Good',
        boxAndPapers: s.boxAndPapers === 'full' ? true : s.boxAndPapers === 'none' ? false : s.boxAndPapers === 'some',
      };
    case 'land_property':
      return {
        propertyType: s.propertyType ?? 'Bare land',
        district: s.district ?? '',
        city: s.city ?? '',
        address: s.address || null,
        sizePerches: parseNum(s.sizePerches),
        sizeSqft: parseNum(s.sizeSqft),
        sizeSqm: parseNum(s.sizeSqm),
        roadAccess: s.roadAccess || null,
        utilities: s.utilities || null,
        zoning: s.zoning || null,
      };
    case 'cars':
      return {
        make: s.make ?? '',
        model: s.model ?? '',
        year: parseNum(s.year) ?? 0,
        variant: s.variant || null,
        mileageKm: parseNum(s.mileage),
        fuelType: s.fuelType || null,
        condition: s.condition ?? 'Good',
        registration: s.registration || null,
      };
    case 'motorcycles':
      return {
        make: s.make ?? '',
        model: s.model ?? '',
        year: parseNum(s.year) ?? 0,
        engineCc: parseNum(s.engineCc),
        mileageKm: parseNum(s.mileage),
        condition: s.condition ?? 'Good',
      };
    case 'other':
      return {
        kind: s.kind ?? '',
        description: s.description || null,
      };
    default:
      return { kind: '' };
  }
}

export function CancelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Discard this asset?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onClose();
              navigate('/portfolio');
            }}
          >
            Discard
          </Button>
        </>
      }
    >
      <p className="text-sm text-txt-muted">
        Nothing has been saved yet. Discarding will leave any details you’ve entered.
      </p>
    </Modal>
  );
}
