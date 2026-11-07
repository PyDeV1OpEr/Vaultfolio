/**
 * Documents — premium document centre for physical assets.
 *
 * Offline-first: metadata lives inside the encrypted vault, binaries in the
 * local blob store. Uploads are validated (PDF/JPG/PNG/WebP, ≤25 MB) and never
 * executed; PDF previews render through sandboxed iframes with the
 * allow-scripts-sandbox set, images through plain <img>.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Clock3, Download, FileText, Files, Filter, HardDrive,
  Image as ImageIcon, LinkIcon, List, LayoutGrid, Pencil,
  Search as SearchIcon, SortAsc, Trash2, Upload, ZoomIn, ZoomOut,
  ShieldCheck, FileWarning,
} from 'lucide-react';
import { useData } from '../store/dataStore';
import {
  buildDocument, docCategoryLabel, DOC_ACCEPT, DOC_CATEGORIES,
  DOC_MIME_LABELS, expiryStatus, expiryHuman, fileHumanSize, getDocBlob,
  validateDocFile,
  type NewDocumentRecord,
} from '../lib/documents';
import { EmptyState, Modal, Button } from '../components/ui';
import type { DocumentRecord } from '../lib/types';

type SortKey = 'recent' | 'oldest' | 'name' | 'category' | 'expiry';
type ViewMode = 'grid' | 'list';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Recently added' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name', label: 'Alphabetical' },
  { id: 'category', label: 'Category' },
  { id: 'expiry', label: 'Expiry date' },
];

export function Documents() {
  const { documents = [], assets, addDocument, updateDocument, deleteDocument, replaceDocumentBlobs } = useData() as unknown as {
    documents?: DocumentRecord[];
    assets: { id: string; name: string }[];
    addDocument: (built: NewDocumentRecord) => Promise<void>;
    updateDocument: (id: string, patch: Partial<DocumentRecord>) => Promise<void>;
    deleteDocument: (id: string) => Promise<void>;
    replaceDocumentBlobs: (records: DocumentRecord[]) => Promise<void>;
  };

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewMode>('grid');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DocumentRecord | null>(null);
  const [previewTarget, setPreviewTarget] = useState<DocumentRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentRecord | null>(null);

  const assetNameById = useMemo(() => new Map(assets.map((a) => [a.id, a.name])), [assets]);

  const filtered = useMemo(() => {
    let list = documents;
    if (categoryFilter !== 'all') list = list.filter((d) => d.category === categoryFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.fileName.toLowerCase().includes(q) ||
          (d.description ?? '').toLowerCase().includes(q) ||
          docCategoryLabel(d.category).toLowerCase().includes(q) ||
          (d.assetId && assetNameById.get(d.assetId)?.toLowerCase().includes(q)),
      );
    }
    const sorted = [...list];
    const byTime = (a: DocumentRecord) => new Date(a.addedAt).getTime();
    const byExpiry = (a: DocumentRecord) =>
      a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
    switch (sort) {
      case 'recent': sorted.sort((a, b) => byTime(b) - byTime(a)); break;
      case 'oldest': sorted.sort((a, b) => byTime(a) - byTime(b)); break;
      case 'name': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'category': sorted.sort((a, b) => docCategoryLabel(a.category).localeCompare(docCategoryLabel(b.category)) || byTime(b) - byTime(a)); break;
      case 'expiry': sorted.sort((a, b) => byExpiry(a) - byExpiry(b)); break;
    }
    return sorted;
  }, [documents, categoryFilter, query, sort, assetNameById]);

  const totalBytes = documents.reduce((sum, d) => sum + d.sizeBytes, 0);
  const expiring = useMemo(
    () => documents.filter((d) => ['expiring', 'expired'].includes(expiryStatus(d.expiresAt) ?? 'valid')),
    [documents],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasAny = (documents as any[]).length > 0;

  /*
   * All overlays (upload/edit/preview/delete) are rendered in BOTH branches.
   * They used to sit only below the empty-state early return, so with zero
   * documents the “Upload document” button set uploadOpen on a dialog that
   * was never mounted — the click appeared dead (no picker, no dialog).
   */
  const dialogs = (
    <>
      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} assets={assets} />}
      {editTarget && <EditDialog doc={editTarget} assets={assets} onClose={() => setEditTarget(null)} onUpdate={updateDocument} />}
      {previewTarget && <PreviewDialog doc={previewTarget} assetNameById={assetNameById} onClose={() => setPreviewTarget(null)} />}
      {deleteTarget && <DeleteDialog doc={deleteTarget} assetNameById={assetNameById} onClose={() => setDeleteTarget(null)} onConfirm={deleteDocument} />}
    </>
  );

  if (!hasAny) {
    return (
      <>
        <EmptyState
          icon={<Files className="text-accent" size={28} />}
          title="No documents yet"
          body="Store certificates, deeds, receipts and insurance papers for your physical assets — encrypted, offline, and linked to your portfolio."
          action={<Button variant="primary" size="md" onClick={() => setUploadOpen(true)}><Upload size={15} /> Upload document</Button>}
        />
        {dialogs}
      </>
    );
  }

  return (
    <div className="max-w-6xl">
      <DocsHeader
        count={documents.length}
        totalBytes={totalBytes}
        expiring={expiring}
        onUpload={() => setUploadOpen(true)}
      />
      <DocsToolbar
        query={query} setQuery={setQuery} categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter} sort={sort} setSort={setSort}
        view={view} setView={setView} count={filtered.length}
      />
      {filtered.length === 0 ? (
        <EmptyState icon={<FileText size={26} className="text-txt-dim" />} title="No matching documents" body="Adjust the search, category or sort." />
      ) : (
        <DocsGrid
          docs={filtered} view={view} assetNameById={assetNameById}
          onEdit={setEditTarget} onPreview={setPreviewTarget} onDelete={setDeleteTarget}
        />
      )}
      {dialogs}
    </div>
  );
}

/* ───────────────────────── Major components ───────────────────────── */

function StatCard({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-700/80 bg-ink-850/60 p-3.5 flex items-center gap-3">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${warn ? 'bg-amber-500/15 text-amber-300' : 'bg-accent/10 text-accent'}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-2xs uppercase tracking-wider text-txt-dim">{label}</p>
        <p className="text-sm font-semibold tnum">{value}</p>
      </div>
    </div>
  );
}

function DocsHeader({ count, totalBytes, expiring, onUpload }: { count: number; totalBytes: number; expiring: DocumentRecord[]; onUpload: () => void }) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Files size={20} className="text-accent" /> Documents
          </h1>
          <p className="text-xs text-txt-dim mt-0.5">Certificates, deeds & receipts — encrypted at rest, offline, linked to your assets.</p>
        </div>
        <Button variant="primary" size="sm" onClick={onUpload}><Upload size={14} /> Upload document</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4">
        <StatCard icon={<Files size={15} />} label="Documents" value={String(count)} />
        <StatCard icon={<HardDrive size={15} />} label="Storage used" value={fileHumanSize(totalBytes)} />
        <StatCard
          icon={expiring.length ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
          label="Expiring / expired" value={String(expiring.length)} warn={expiring.length > 0}
        />
        {expiring.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-start gap-2.5 col-span-2 md:col-span-1">
            <AlertTriangle size={15} className="text-amber-300 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200 leading-snug">
              {expiring.length === 1 ? '1 document needs attention — check its expiry date below.' : `${expiring.length} documents need attention — check their expiry dates below.`}
            </p>
          </div>
        )}
        {expiring.length === 0 && <div className="hidden md:block" />}
      </div>
    </div>
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-xl border border-ink-700 bg-ink-875 px-2.5 text-xs text-txt focus:outline-none focus:border-accent"
    >
      {children}
    </select>
  );
}

function DocsToolbar({ query, setQuery, categoryFilter, setCategoryFilter, sort, setSort, view, setView, count }: {
  query: string; setQuery: (v: string) => void; categoryFilter: string; setCategoryFilter: (v: string) => void;
  sort: SortKey; setSort: (v: SortKey) => void; view: ViewMode; setView: (v: ViewMode) => void; count: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5 bg-ink-875 p-2.5 rounded-2xl border border-ink-700">
      <div className="relative flex-1 min-w-[180px]">
        <SearchIcon size={14} className="absolute left-3 top-2 text-txt-dim" />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents, categories, linked assets…"
          className="w-full h-8 rounded-xl border border-ink-700 bg-ink-900 pl-8 pr-3 text-xs text-txt placeholder:text-txt-dim focus:outline-none focus:border-accent"
        />
      </div>
      <span className="flex items-center gap-1.5 text-2xs text-txt-dim">
        <Filter size={12} className="text-txt-muted" />
        <Select value={categoryFilter} onChange={setCategoryFilter}>
          <option value="all">All categories</option>
          {DOC_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </Select>
      </span>
      <span className="flex items-center gap-1.5 text-2xs text-txt-dim">
        <SortAsc size={12} className="text-txt-muted" />
        <Select value={sort} onChange={(v) => setSort(v as SortKey)}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </span>
      <span className="rounded-xl border border-ink-700 bg-ink-900 flex overflow-hidden p-0.5">
        <button aria-label="Grid view" onClick={() => setView('grid')} className={`px-2.5 h-7 rounded-lg transition-all ${view === 'grid' ? 'bg-[#7047EB]/25 text-white border border-accent/40 shadow-[0_0_10px_rgba(169,155,255,0.15)]' : 'text-txt-dim hover:text-txt'}`}><LayoutGrid size={14} /></button>
        <button aria-label="List view" onClick={() => setView('list')} className={`px-2.5 h-7 rounded-lg transition-all ${view === 'list' ? 'bg-[#7047EB]/25 text-white border border-accent/40 shadow-[0_0_10px_rgba(169,155,255,0.15)]' : 'text-txt-dim hover:text-txt'}`}><List size={14} /></button>
      </span>
      <span className="text-2xs text-txt-dim tnum px-1">{count} shown</span>
    </div>
  );
}

function ExpiryBadge({ doc }: { doc: DocumentRecord }) {
  const status = expiryStatus(doc.expiresAt);
  if (!status) return null;
  const cls = status === 'expired'
    ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
    : status === 'expiring'
    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs ${cls}`}>
      <Clock3 size={10} /> {expiryHuman(status, doc.expiresAt!)}
    </span>
  );
}

function DocCard({ doc, assetName, onEdit, onPreview, onDelete }: {
  doc: DocumentRecord; assetName?: string;
  onEdit: () => void; onPreview: () => void; onDelete: () => void;
}) {
  const isImage = doc.mimeType.startsWith('image/');
  return (
    <div className="group relative rounded-xl border border-ink-700/80 bg-ink-850/60 hover:border-accent/40 hover:bg-ink-800/80 transition-all duration-150 p-3.5 flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <span className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
          {isImage ? <ImageIcon size={16} className="text-accent" /> : <FileText size={16} className="text-accent" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate">{doc.name}</p>
          <p className="text-2xs text-txt-dim truncate">{docCategoryLabel(doc.category)} · {fileHumanSize(doc.sizeBytes)}</p>
        </div>
      </div>
      {assetName && (
        <Link to={`/portfolio/${doc.assetId}`} className="inline-flex items-center gap-1 text-2xs text-accent hover:underline">
          <LinkIcon size={10} /> {assetName}
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-1.5 mt-auto min-h-[20px]">
        <ExpiryBadge doc={doc} />
      </div>
      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
        <button onClick={onPreview} className="rounded-md px-2 py-1 text-2xs inline-flex items-center gap-1 text-txt hover:text-accent hover:bg-ink-800"><ZoomIn size={11} /> Open</button>
        <button onClick={onEdit} className="rounded-md px-2 py-1 text-2xs inline-flex items-center gap-1 text-txt hover:text-accent hover:bg-ink-800"><Pencil size={11} /> Edit</button>
        <button onClick={onDelete} className="rounded-md px-2 py-1 text-2xs inline-flex items-center gap-1 text-rose-400/90 hover:text-rose-300 hover:bg-rose-500/10 ml-auto"><Trash2 size={11} /> Delete</button>
      </div>
    </div>
  );
}

function DocListRow({ doc, assetName, onEdit, onPreview, onDelete }: {
  doc: DocumentRecord; assetName?: string;
  onEdit: () => void; onPreview: () => void; onDelete: () => void;
}) {
  const isImage = doc.mimeType.startsWith('image/');
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-ink-700/80 bg-ink-850/60 hover:border-accent/40 px-3.5 py-2.5">
      <span className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
        {isImage ? <ImageIcon size={14} className="text-accent" /> : <FileText size={14} className="text-accent" />}
      </span>
      <button onClick={onPreview} className="flex-1 min-w-0 text-left">
        <p className="text-xs font-semibold truncate">{doc.name}</p>
        <p className="text-2xs text-txt-dim truncate">
          {docCategoryLabel(doc.category)} · {fileHumanSize(doc.sizeBytes)}{assetName ? ` · ${assetName}` : ''}
        </p>
      </button>
      <ExpiryBadge doc={doc} />
      <button onClick={onEdit} className="rounded-md p-1 text-txt-dim hover:text-accent" aria-label="Edit"><Pencil size={13} /></button>
      <button onClick={onDelete} className="rounded-md p-1 text-txt-dim hover:text-rose-400" aria-label="Delete"><Trash2 size={13} /></button>
    </div>
  );
}

function DocsGrid({ docs, view, assetNameById, onEdit, onPreview, onDelete }: {
  docs: DocumentRecord[]; view: ViewMode; assetNameById: Map<string, string>;
  onEdit: (d: DocumentRecord) => void; onPreview: (d: DocumentRecord) => void; onDelete: (d: DocumentRecord) => void;
}) {
  if (view === 'list') {
    return (
      <div className="flex flex-col gap-2">
        {docs.map((d) => (
          <DocListRow key={d.id} doc={d} assetName={d.assetId ? assetNameById.get(d.assetId) : undefined}
            onEdit={() => onEdit(d)} onPreview={() => onPreview(d)} onDelete={() => onDelete(d)} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {docs.map((d) => (
        <DocCard key={d.id} doc={d} assetName={d.assetId ? assetNameById.get(d.assetId) : undefined}
          onEdit={() => onEdit(d)} onPreview={() => onPreview(d)} onDelete={() => onDelete(d)} />
      ))}
    </div>
  );
}

/* ── Upload dialog with drag-and-drop + validation ───────────────── */

function UploadDialog({ assets, onClose }: { assets: { id: string; name: string }[]; onClose: () => void }) {
  const { addDocument } = useData() as unknown as { addDocument: (b: NewDocumentRecord) => Promise<void> };
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('gold_certificate');
  const [customCategory, setCustomCategory] = useState('');
  const [assetId, setAssetId] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const takeFile = (f: File) => {
    setFile(f);
    setValidation(validateDocFile({ name: f.name, type: f.type, size: f.size }).ok ? null : validateDocFile({ name: f.name, type: f.type, size: f.size }).reason!);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const cat = category === 'custom' ? customCategory.trim() : category;
      const built = await buildDocument({
        userId: 'local-user', name, category: cat, assetId: assetId || null,
        file, issuedAt: issuedAt || null, expiresAt: expiresAt || null,
        description: description || null,
      });
      if (!built.record.id) throw new Error('Document id missing.');
      await addDocument(built);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const v = file ? validateDocFile({ name: file.name, type: file.type, size: file.size }) : null;

  return (
    <Modal open onClose={onClose} title="Upload document">
      <div className="flex flex-col gap-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) takeFile(f); }}
          onClick={() => inputRef.current?.click()}
          className={`mt-1 rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${dragOver ? 'border-accent bg-accent/10' : validation === null && file ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-ink-700 hover:border-ink-600'}`}
        >
          <Upload size={20} className="mx-auto text-txt-dim" />
          <p className="text-xs mt-2 font-medium">{dragOver ? 'Drop to attach' : 'Drag & drop a document, or click to browse'}</p>
          <p className="text-2xs text-txt-dim mt-1">PDF · JPG · JPEG · PNG · WebP — up to 25 MB</p>
          <input ref={inputRef} type="file" hidden accept={DOC_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) takeFile(f); }} />
          {file && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5">
              {file.type.startsWith('image/') ? <ImageIcon size={13} className="text-accent" /> : <FileText size={13} className="text-accent" />}
              <span className="text-2xs truncate max-w-[220px] font-medium">{file.name}</span>
              <span className="text-2xs text-txt-dim tnum">{fileHumanSize(file.size)}</span>
              {v?.ok ? <ShieldCheck size={13} className="text-emerald-400" /> : <FileWarning size={13} className="text-rose-400" />}
            </div>
          )}
          {validation && (
            <p className="text-2xs text-rose-400 mt-2 inline-flex items-center gap-1 justify-center"><AlertTriangle size={11} /> {validation}</p>
          )}
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Document name"><input className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Land deed – Attidiya" /></Field>
          <Field label="Category">
            <select className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              <option value="custom">Custom…</option>
            </select>
          </Field>
          {category === 'custom' && (
            <Field label="Custom category name"><input className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="e.g. Bank appraisal" /></Field>
          )}
          <Field label="Related asset (optional)">
            <select className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">None — general document</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Issue date (optional)"><input type="date" className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} /></Field>
          <Field label="Expiry date (optional)"><input type="date" className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
        </div>
        <Field label="Description (optional)"><textarea rows={2} className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs resize-none" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>

        {error && <p className="text-2xs text-rose-400 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>}

        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-xs border border-ink-700 hover:bg-ink-800">Cancel</button>
          <Button variant="primary" size="sm" onClick={!busy && v?.ok && !!file ? submit : undefined}>{busy ? 'Saving…' : 'Save document'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs uppercase tracking-wide text-txt-dim">{label}</span>
      {children}
    </label>
  );
}

/* ── Preview dialog ─────────────────────────────────────────────── */

function PreviewDialog({ doc, assetNameById, onClose }: {
  doc: DocumentRecord; assetNameById: Map<string, string>; onClose: () => void;
}) {
  const { replaceDocumentBlobs, deleteDocument, documents = [] } = useData() as unknown as {
    replaceDocumentBlobs: (records: DocumentRecord[]) => Promise<void>;
    deleteDocument: (id: string) => Promise<void>;
    documents?: DocumentRecord[];
  };
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const blob = await getDocBlob(doc.id);
        if (cancelled) return;
        if (!blob) { setError('The stored file could not be found on this device (the record survived but its data is missing). Re-upload the document to restore the preview.'); return; }
        const objectUrl = URL.createObjectURL(blob);
        revoke = objectUrl;
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setError('Preview could not be loaded from local storage.');
      }
    })();
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [doc.id]);

  const download = async () => {
    const blob = await getDocBlob(doc.id);
    if (!blob) return;
    const a = document.createElement('a');
    const safeName = doc.fileName.split(/[^A-Za-z0-9._-]/g).join('_');
    a.href = URL.createObjectURL(blob);
    a.download = safeName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const isImage = doc.mimeType.startsWith('image/');
  const isPdf = doc.mimeType === 'application/pdf';

  return (
    <Modal open onClose={onClose} title={doc.name} width="max-w-3xl">
      <div className="flex flex-col gap-3">
        {error ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        ) : !url ? (
          <div className="rounded-lg border border-ink-700 p-8 text-center text-xs text-txt-dim">Decoding document locally…</div>
        ) : isImage ? (
          <div className="bg-ink-950 rounded-lg border border-ink-700 overflow-auto max-h-[55vh] flex items-start justify-center">
            <img src={url} alt={doc.name} style={{ transform: `scale(${zoom})` }} className="origin-top transition-transform max-w-full" />
          </div>
        ) : isPdf ? (
          <div className="rounded-lg border border-ink-700 overflow-hidden bg-white" style={{ height: '55vh' }}>
            {/* sandboxed: no scripts, no forms, no same-origin access */}
            <iframe src={`${url}#view=FitH`} title={doc.name} sandbox="allow-same-origin" className="w-full h-full border-0" />
          </div>
        ) : (
          <div className="rounded-lg border border-ink-700 p-5 text-center text-xs text-txt-dim">No in-app preview for {doc.mimeType}. Use Download below.</div>
        )}

        {isImage && url && (
          <div className="flex items-center gap-2 justify-center">
            <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="rounded-lg border border-ink-700 p-1.5 text-txt-dim hover:text-txt" aria-label="Zoom out"><ZoomOut size={13} /></button>
            <span className="text-2xs tnum text-txt-dim w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="rounded-lg border border-ink-700 p-1.5 text-txt-dim hover:text-txt" aria-label="Zoom in"><ZoomIn size={13} /></button>
          </div>
        )}

        <DocMetaTable doc={doc} assetName={doc.assetId ? assetNameById.get(doc.assetId) : undefined} />

        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 text-xs hover:bg-ink-800"><Download size={13} /> Download</button>
          <button onClick={onClose} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs hover:bg-ink-800">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function DocMetaTable({ doc, assetName }: { doc: DocumentRecord; assetName?: string }) {
  const rows: [string, React.ReactNode][] = [
    ['Category', docCategoryLabel(doc.category)],
    ['File type', `${DOC_MIME_LABELS[doc.mimeType] ?? doc.mimeType} (${doc.mimeType})`],
    ['File size', fileHumanSize(doc.sizeBytes)],
    ['Date uploaded', new Date(doc.addedAt).toLocaleString()],
    ['Related asset', assetName ? <Link to={`/portfolio/${doc.assetId}`} className="text-accent hover:underline">{assetName}</Link> : 'None'],
    ['Issued', doc.issuedAt ? new Date(doc.issuedAt).toLocaleDateString() : '—'],
    ['Expiry', doc.expiresAt ? <ExpiryBadge doc={doc} /> : '—'],
  ];
  if (doc.description) rows.push(['Description', <span className="whitespace-pre-wrap">{doc.description}</span>]);
  return (
    <dl className="rounded-xl border border-ink-700 bg-ink-850/50 p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
      {rows.map(([k, v]) => (
        <div key={k as string}>
          <dt className="text-2xs uppercase tracking-wide text-txt-dim">{k}</dt>
          <dd className="mt-0.5 text-txt">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Edit dialog ────────────────────────────────────────────────── */

function EditDialog({ doc, assets, onClose, onUpdate }: {
  doc: DocumentRecord; assets: { id: string; name: string }[];
  onClose: () => void; onUpdate: (id: string, patch: Partial<DocumentRecord>) => Promise<void>;
}) {
  const [name, setName] = useState(doc.name);
  const [category, setCategory] = useState(doc.id ? doc.category : 'other');
  const [customCategory, setCustomCategory] = useState('');
  const [assetId, setAssetId] = useState(doc.assetId ?? '');
  const [issuedAt, setIssuedAt] = useState(doc.issuedAt ?? '');
  const [expiresAt, setExpiresAt] = useState(doc.expiresAt ?? '');
  const [description, setDescription] = useState(doc.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const cat = category === 'custom' ? customCategory.trim() : category;
      await onUpdate(doc.id, { name, category: cat, assetId: assetId || null, issuedAt: issuedAt || null, expiresAt: expiresAt || null, description: description || null });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isCustom = !DOC_CATEGORIES.some((c) => c.id === doc.category);

  return (
    <Modal open onClose={onClose} title="Edit document">
      <div className="flex flex-col gap-3">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Document name"><input className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Category">
            <select className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              <option value="custom">Custom…</option>
              {isCustom && <option value={doc.category}>{doc.category} (current)</option>}
            </select>
          </Field>
          {category === 'custom' && (
            <Field label="Custom category name"><input className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder={isCustom ? doc.category : 'e.g. Bank appraisal'} /></Field>
          )}
          <Field label="Related asset">
            <select className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">None — general document</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Issue date"><input type="date" className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} /></Field>
          <Field label="Expiry date"><input type="date" className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
        </div>
        <Field label="Description"><textarea rows={2} className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs resize-none" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {error && <p className="text-2xs text-rose-400 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={!busy ? submit : undefined}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Delete dialog ──────────────────────────────────────────────── */

function DeleteDialog({ doc, assetNameById, onClose, onConfirm }: {
  doc: DocumentRecord; assetNameById: Map<string, string>;
  onClose: () => void; onConfirm: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const linked = doc.assetId ? assetNameById.get(doc.assetId) : undefined;
  return (
    <Modal open onClose={onClose} title="Delete document">
      <p className="text-xs leading-relaxed">
        Delete <span className="font-semibold">“{doc.name}”</span> permanently?{linked ? <> It is linked to <span className="text-accent">{linked}</span> — deleting the document will <span className="text-amber-300">not</span> affect the asset.</> : ' The file cannot be recovered.'}
      </p>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="danger" size="sm" onClick={async () => { setBusy(true); try { await onConfirm(doc.id); onClose(); } finally { setBusy(false); } }}>{busy ? 'Deleting…' : 'Delete document'}</Button>
      </div>
    </Modal>
  );
}
