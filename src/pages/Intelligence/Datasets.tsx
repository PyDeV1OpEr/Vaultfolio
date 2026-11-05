import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CloudDownload,
  Database,
  Download,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  Input,
  Select,
} from '../../components/ui';
import { intel, fmtBytes, fmtDate, fmtNumber } from '../../lib/intel';

/** Shared CSV import surface: native picker + drag-and-drop. */
export function IntelImport() {
  const nav = useNavigate();
  const [file, setFile] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const doPick = async () => {
    try {
      const picked = await intel.pickCsv();
      if (picked) {
        setFile(picked);
        setName(picked.split('/').pop()?.replace(/\.csv$/i, '') ?? '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const d = await intel.importCsv(file, name.trim() || undefined);
      nav(`/intelligence/datasets/${d.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Import a CSV dataset</h1>
        <p className="text-xs text-txt-muted mt-0.5">
          Delimiters (comma, semicolon, tab), encodings and column types are detected automatically.
        </p>
      </header>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          dragDepth.current = 0;
          // The webview carries the dragged file's *path*; Tauri FS access for
          // arbitrary paths happens only through the Rust handler's validation.
          const raw = (e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('public.file-url') || '').trim();
          const path = normalizeDroppedPath(raw);
          if (path && /\.csv$/i.test(path)) {
            setFile(path);
            setName(path.split('/').pop()?.replace(/\.csv$/i, '') ?? '');
            setError(null);
          } else if (raw) {
            setError('Only .csv files can be dropped. Use “Choose a file” for other encodings.');
          }
        }}
        className={`relative rounded-2xl border-2 border-dashed transition-colors duration-150 p-10 text-center ${
          dragging ? 'border-accent bg-accent/5' : 'border-ink-650 bg-ink-900/50'
        }`}
        aria-label="CSV import drop area"
      >
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center mx-auto mb-3">
          <Upload size={20} className="text-accent" />
        </div>
        <p className="text-xs font-medium">Drag a .csv file here</p>
        <p className="text-2xs text-txt-dim mt-0.5">UTF-8 is native; common single-byte encodings are also handled.</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void doPick()} loading={busy}>
          Choose a file…
        </Button>
      </div>

      {file && (
        <Card>
          <CardBody className="space-y-3">
            <div>
              <p className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1">Selected file</p>
              <p className="text-xs font-mono break-all text-txt">{file.split('/').pop()}</p>
              <p className="text-2xs text-txt-dim font-mono mt-0.5 break-all">{file}</p>
            </div>
            <div>
              <label htmlFor="intel-ds-name" className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1 block">
                Dataset name
              </label>
              <Input
                id="intel-ds-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Gold shop sales 2026"
                maxLength={120}
              />
            </div>
          </CardBody>
          <div className="flex gap-2 p-4 pt-0">
            <Button variant="primary" size="sm" onClick={() => void doImport()} loading={busy} disabled={busy}>
              Import dataset
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setFile(null); setError(null); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {error && <InlineAlert kind="error">{error}</InlineAlert>}

      <div className="flex gap-2 text-2xs text-txt-dim">
        <Link to="/intelligence/samples" className="text-accent hover:underline">Browse sample datasets</Link>
        <span>·</span>
        <Link to="/intelligence/docs/csv-troubleshooting" className="hover:text-txt">CSV troubleshooting guide</Link>
      </div>
    </div>
  );
}

function normalizeDroppedPath(raw: string): string | null {
  // macOS 'file://' URLs → plain path; plain POSIX paths pass through.
  if (raw.startsWith('file://')) {
    try { return decodeURIComponent(new URL(raw).pathname); } catch { return null; }
  }
  if (raw.startsWith('file:')) {
    try { return decodeURIComponent(raw.slice('file:'.length)); } catch { return null; }
  }
  if (raw.startsWith('/')) return raw;
  return null;
}

/* ────────────────── dataset list ────────────────── */

export function IntelDatasets() {
  const nav = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof intel.listDatasets>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await intel.listDatasets());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Datasets</h1>
          <p className="text-xs text-txt-muted mt-0.5">Every CSV you have imported lives on this device.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => nav('/intelligence/import')}>
          <Upload size={14} /> Import
        </Button>
      </header>
      {error && <InlineAlert kind="error">{error}</InlineAlert>}
      <DatasetTable data={data} onDelete={(id) => setConfirmId(id)} />
      <ConfirmDialog
        open={confirmId != null}
        onClose={() => setConfirmId(null)}
        title="Delete this dataset?"
        description={<span>Models trained on it stay in your library, but their link to this dataset is removed. This cannot be undone.</span>}
        confirmLabel="Delete dataset"
        loading={deleting}
        onConfirm={async () => {
          if (!confirmId) return;
          setDeleting(true);
          try {
            await intel.deleteDataset(confirmId);
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setDeleting(false);
            setConfirmId(null);
          }
        }}
      />
    </div>
  );
}

function DatasetTable({
  data,
  onDelete,
}: {
  data: Awaited<ReturnType<typeof intel.listDatasets>> | null;
  onDelete: (id: string) => void;
}) {
  const nav = useNavigate();
  if (!data) return <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-accent" size={20} /></div>;
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<Database size={20} />}
        title="No datasets yet"
        body="Import a CSV to get started, or load the built-in samples."
        size="md"
        action={<Button variant="primary" size="sm" onClick={() => nav('/intelligence/import')}><Upload size={14} /> Import dataset</Button>}
      />
    );
  }
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <button
          key={d.id}
          onClick={() => nav(`/intelligence/datasets/${d.id}`)}
          className="w-full text-left rounded-xl border border-ink-700 bg-ink-900/60 hover:bg-ink-850 hover:border-ink-650 transition-all duration-120 p-3.5 flex items-center gap-4 group"
        >
          <span className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
            <Database size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold truncate">{d.name}</p>
            <p className="text-2xs text-txt-dim mt-0.5">
              {fmtDate(d.imported_at)} · {fmtBytes(d.byte_size)}
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <Badge>{d.column_count} cols</Badge>
            <Badge>{fmtNumber(d.row_count, 0)} rows</Badge>
          </div>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Delete ${d.name}`}
            onClick={(e) => { e.stopPropagation(); onDelete(d.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDelete(d.id); } }}
            className="p-1.5 rounded-lg text-txt-dim hover:text-rose-400 hover:bg-rose-500/10 opacity-60 group-hover:opacity-100 transition-all"
          >
            <Trash2 size={14} />
          </span>
        </button>
      ))}
    </div>
  );
}

/* ────────────────── dataset inspect ────────────────── */

export function IntelDatasetDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof intel.getDataset>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<'preview' | 'stats'>('preview');

  // Preview state
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof intel.preview>> | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  // Column stats panel
  const [stats, setStats] = useState<{ column: string; data: Record<string, unknown> } | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    intel.getDataset(id).then((d) => { if (alive) setData(d); }).catch((err) => {
      if (alive) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { alive = false; };
  }, [id]);

  const fetchPreview = useCallback(async () => {
    if (!id) return;
    setPreviewErr(null);
    try {
      const res = await intel.preview({
        dataset_id: id,
        page,
        page_size: 50,
        sort: sort?.col,
        dir: sort?.dir,
        search: search.trim() || undefined,
      });
      setPreview(res);
    } catch (err) {
      setPreviewErr(err instanceof Error ? err.message : String(err));
    }
  }, [id, page, search, sort]);

  useEffect(() => { void fetchPreview(); }, [fetchPreview]);

  const loadColumn = async (col: string) => {
    if (!id) return;
    setStats({ column: col, data: {} });
    setStatsBusy(true);
    try {
      setStats({ column: col, data: await intel.columnStats(id, col) });
    } catch (err) {
      setStats({ column: col, data: { error: err instanceof Error ? err.message : String(err) } });
    } finally {
      setStatsBusy(false);
    }
  };

  if (error) return <div className="max-w-xl space-y-3"><InlineAlert kind="error">{error}</InlineAlert><Button size="sm" onClick={() => nav('/intelligence/datasets')}>Back to datasets</Button></div>;
  if (!data) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-accent" size={22} /></div>;

  const cols = data.profile?.columns ?? [];
  const visibleCols = (preview?.columns ?? []).filter((c) => !hidden.has(c));

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{data.name}</h1>
          <p className="text-xs text-txt-muted mt-0.5">
            {fmtNumber(data.rowCount, 0)} rows · {(data.profile?.column_count ?? cols.length)} columns ·{' '}
            {fmtBytes(data.byteSize)} · imported {fmtDate(data.importedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge>{data.encoding}</Badge>
          <Badge>{data.delimiter === '\t' ? 'tab' : data.delimiter === ';' ? 'semicolon' : 'comma'} delimited</Badge>
        </div>
      </header>

      {/* Summary grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <MiniStat label="Missing values" value={`${fmtNumber(data.missingTotal, 0)} of ${fmtNumber(data.rowCount * cols.length, 0)} cells`} />
        <MiniStat label="Duplicate rows" value={fmtNumber(data.duplicateRows, 0)} />
        <MiniStat label="File" value={data.originalName} mono />
        <MiniStat label="Encoding" value={`${data.encoding} · ${data.delimiter === '\t' ? 'tab' : data.delimiter}`} mono />
      </div>

      {data.profile?.warnings && data.profile.warnings.length > 0 && (
        <InlineAlert kind="warning">{data.profile.warnings.map((w, i) => <span key={i} className="block">{w}</span>)}</InlineAlert>
      )}

      {/* Tabs */}
      <div className="flex gap-0.5 bg-ink-800/60 rounded-lg p-0.5 border border-ink-700 w-fit" role="tablist">
        {(['preview', 'stats'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors uppercase tracking-wider ${
              tab === t ? 'bg-ink-950 border border-ink-650 text-txt' : 'text-txt-muted hover:text-txt'
            }`}
          >
            {t === 'preview' ? 'Preview' : 'Column statistics'}
          </button>
        ))}
      </div>

      {tab === 'preview' ? (
        <PreviewTable
          preview={preview}
          previewErr={previewErr}
          visibleCols={visibleCols}
          page={page}
          setPage={setPage}
          sort={sort}
          setSort={setSort}
          search={search}
          setSearch={(s) => { setSearch(s); setPage(1); }}
          hidden={hidden}
          setHidden={setHidden}
          allCols={preview?.columns ?? []}
          onRefresh={fetchPreview}
        />
      ) : (
        <div className="grid md:grid-cols-[280px_1fr] gap-4">
          {/* column list */}
          <Card>
            <CardBody className="p-2">
              <ul className="space-y-0.5 max-h-[460px] overflow-y-auto">
                {cols.map((c) => (
                  <li key={c.name}>
                    <button
                      onClick={() => void loadColumn(c.name)}
                      className={`w-full text-left rounded-lg px-2.5 py-2 text-xs transition-colors flex items-center justify-between gap-2 ${
                        stats?.column === c.name ? 'bg-accent/12 text-accent' : 'hover:bg-ink-850 text-txt'
                      }`}
                    >
                      <span className="truncate font-medium">{c.name}</span>
                      <TypeBadge t={c.dtype} />
                    </button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          {/* detail panel */}
          <Card>
            <CardBody>
              {!stats ? (
                <p className="text-xs text-txt-dim text-center py-10">Select a column to compute detailed statistics.</p>
              ) : statsBusy || !Object.keys(stats.data).length ? (
                <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-accent" size={18} /></div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold">{stats.column}</h2>
                    <TypeBadge t={cols.find((c) => c.name === stats.column)?.dtype ?? ''} />
                  </div>
                  <StatsGrid stats={stats.data} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button
          variant="primary"
          size="sm"
          onClick={() => nav('/intelligence/train', { state: { datasetId: data.id } })}
        >
          Train a model on this dataset
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            const dest = await intel.pickSavePath(`${data.name}.csv`);
            if (!dest) return;
            try {
              await intel.export('dataset', data.id, dest);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <Download size={14} /> Export copy
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDel(true)}>
          <Trash2 size={14} /> Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="Delete this dataset?"
        description={<span>Models trained on it stay in your library, but their link to it is removed. This cannot be undone.</span>}
        confirmLabel="Delete dataset"
        loading={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            if (id) await intel.deleteDataset(id);
            nav('/intelligence/datasets');
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setDeleting(false);
            setConfirmDel(false);
          }
        }}
      />
    </div>
  );
}

function MiniStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
      <p className="text-2xs uppercase tracking-wider text-txt-dim font-semibold">{label}</p>
      <p className={`mt-0.5 truncate ${mono ? 'font-mono text-2xs' : 'text-xs font-medium'}`} title={value}>{value}</p>
    </div>
  );
}

export function TypeBadge({ t }: { t: string }) {
  const tone = t === 'numeric' ? 'positive' : t === 'datetime' ? 'accent' : t === 'boolean' ? 'negative' : 'neutral';
  return <Badge tone={tone}>{t}</Badge>;
}

function PreviewTable({
  preview, previewErr, visibleCols, page, setPage, sort, setSort, search, setSearch, hidden, setHidden, allCols, onRefresh,
}: {
  preview: Awaited<ReturnType<typeof intel.preview>> | null;
  previewErr: string | null;
  visibleCols: string[];
  page: number;
  setPage: (n: number) => void;
  sort: { col: string; dir: 'asc' | 'desc' } | null;
  setSort: (s: { col: string; dir: 'asc' | 'desc' } | null) => void;
  search: string;
  setSearch: (s: string) => void;
  hidden: Set<string>;
  setHidden: Dispatch<SetStateAction<Set<string>>>;
  allCols: string[];
  onRefresh: () => void;
}) {
  const hideDrop = (col: string) => {
    if (visibleCols.length <= 1) return; // keep at least one visible column
    const next = new Set(hidden);
    next.add(col);
    setHidden(next);
    onRefresh();
  };
  const unhide = (col: string) => {
    const next = new Set(hidden);
    next.delete(col);
    setHidden(next);
    onRefresh();
  };
  const totalPages = preview?.total_pages ?? 1;
  const canPrev = page > 1;
  const canNext = preview ? page < totalPages : false;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-dim pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rows…"
            className="pl-7 text-2xs py-1.5"
            aria-label="Search dataset rows"
          />
        </div>
        {/* column visibility */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {allCols.slice(0, 12).map((c) => (
            <button
              key={c}
              onClick={() => (hidden.has(c) ? unhide(c) : visibleCols.length > 1 && hideDrop(c))}
              className={`px-2 py-1 rounded-md text-2xs border transition-colors ${
                hidden.has(c)
                  ? 'border-ink-700 bg-ink-900 text-txt-dim hover:border-ink-600'
                  : 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
              }`}
              title={hidden.has(c) ? `Show ${c}` : `Hide ${c}`}
            >
              {c}
            </button>
          ))}
          {allCols.length > 12 && (
            <span className="text-2xs text-txt-dim font-mono">+{allCols.length - 12} more</span>
          )}
        </div>
      </div>

      {previewErr && <InlineAlert kind="error">{previewErr}</InlineAlert>}

      <div className="rounded-xl border border-ink-700 overflow-x-auto bg-ink-950/60">
        {preview == null ? (
          <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-accent" size={18} /></div>
        ) : (
          <table className="w-full text-2xs min-w-[480px]">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-900/80">
                {visibleCols.map((c) => (
                  <th key={c} className="px-2.5 py-2 text-left whitespace-nowrap">
                    <button
                      onClick={() => setSort(sort?.col === c && sort.dir === 'desc' ? null : { col: c, dir: sort?.col === c && sort.dir === 'asc' ? 'desc' : 'asc' })}
                      className="flex items-center gap-1 hover:text-accent transition-colors font-semibold"
                    >
                      {sort?.col === c && (sort.dir === 'asc' ? <ArrowUpNarrowWide size={11} /> : <ArrowDownWideNarrow size={11} />)}
                      {c}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.length === 0 ? (
                <tr><td colSpan={visibleCols.length} className="px-3 py-8 text-center text-txt-dim">No rows match this search.</td></tr>
              ) : preview.rows.map((row, i) => (
                <tr key={i} className={i % 2 ? 'bg-ink-900/40' : ''}>
                  {visibleCols.map((c) => {
                    const v = row[c];
                    return (
                      <td key={c} className="px-2.5 py-1.5 whitespace-nowrap max-w-[220px] truncate font-mono text-txt-muted" title={String(v ?? '')}>
                        {v == null || v === '' ? <span className="text-ink-600">—</span> : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-2xs text-txt-dim">
        <span>
          {preview ? `${fmtNumber(preview.total_rows, 0)} rows · ${visibleCols.length}/${allCols.length} columns` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="xs" disabled={!canPrev} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="tnum font-mono">{page} / {totalPages}</span>
          <Button variant="ghost" size="xs" disabled={!canNext} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

function StatsGrid({ stats }: { stats: Record<string, unknown> }) {
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(stats)) {
    if (k === 'top_values' && Array.isArray(v)) continue;
    rows.push([k, v == null ? '—' : typeof v === 'number' ? fmtNumber(v) : String(v)]);
    if (Array.isArray(v) && k !== 'top_values') {
      rows.pop();
      rows.push([k, `${v.length} values`]);
    }
  }
  const topValues = Object.entries(stats).find(([k]) => k === 'top_values');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-ink-900/70 border border-ink-700/70 px-2.5 py-2">
            <p className="text-2xs font-mono text-txt-dim">{k}</p>
            <p className="text-xs font-medium mt-0.5 tnum truncate" title={v}>{v}</p>
          </div>
        ))}
      </div>
      {topValues && (
        <div>
          <p className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1">Frequency distribution</p>
          {Array.isArray(topValues[1]) && (
            <ul className="space-y-1">
              {(topValues[1] as { value: string; count: number; pct?: number }[]).slice(0, 8).map((f, i) => {
                const p = f.pct ?? 0;
                return (
                  <li key={i} className="flex items-center gap-2 text-2xs">
                    <span className="w-28 truncate text-txt-muted font-mono" title={f.value}>{String(f.value)}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-ink-800 overflow-hidden min-w-[60px]">
                      <div className="h-full bg-accent/70 rounded-full" style={{ width: `${Math.min(100, p)}%` }} />
                    </div>
                    <span className="tnum text-txt-dim w-8 text-right shrink-0">{p >= 1 ? p.toFixed(1) : '<0'}%</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────── sample datasets pages ────────────────── */

export function IntelSamples() {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof intel.sampleCatalog>> | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => { void intel.sampleCatalog().then(setCatalog).catch(() => setCatalog({ samples: [] })); }, []);
  const seed = async () => {
    setSeeding(true);
    try {
      const r = await intel.seedSamples();
      setNote(`${r.seeded} sample dataset${r.seeded === 1 ? '' : 's'} imported.`);
      setTimeout(() => nav('/intelligence/datasets'), 900);
    } finally {
      setSeeding(false);
    }
  };
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Sample datasets</h1>
        <p className="text-xs text-txt-muted mt-0.5">
          Small, documented CSVs bundled with Vaultfolio. They go through the exact same import path
          as your own files and are labeled with their origin and license.
        </p>
      </header>
      {note && <InlineAlert kind="success">{note}</InlineAlert>}
      {!catalog ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-accent" size={20} /></div>
      ) : (
        <div className="space-y-2">
          {catalog.samples.map((s) => (
            <Card key={s.file}>
              <CardBody className="flex items-start gap-3">
                <CloudDownload size={16} className="text-accent shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">{s.title}</p>
                  <p className="text-2xs text-txt-muted mt-0.5">{s.description}</p>
                  <p className="text-2xs text-txt-dim font-mono mt-1">
                    {s.rows ?? '?'} rows · {TASK_TYPE(s.task)} · {s.license ?? 'bundled'}
                  </p>
                </div>
              </CardBody>
            </Card>
          ))}
          <Button variant="primary" size="sm" onClick={() => void seed()} loading={seeding} className="mt-2" disabled={seeding}>
            Import all samples
          </Button>
        </div>
      )}
    </div>
  );
}

const TASK_TYPE = (t: string) => (t === 'classification' ? 'classification target' : t === 'regression' ? 'regression target' : 'unsupervised');

