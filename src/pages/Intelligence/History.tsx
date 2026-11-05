import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, History as HistoryIcon, Loader2, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardBody, ConfirmDialog, EmptyState, InlineAlert } from '../../components/ui';
import { intel, fmtDate, fmtNumber, TASK_LABELS } from '../../lib/intel';

const EXTRA = ['_prediction', '_confidence', '_uncertainty', '_cluster_distance'];

export function IntelHistory() {
  const nav = useNavigate();
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof intel.listRuns>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRuns(await intel.listRuns()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = async (id: string) => {
    setOpenId(openId === id ? null : id);
    if (openId === id) { setRunDetail(null); return; }
    setLoadingDetail(true);
    try { setRunDetail(await intel.getRun(id)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoadingDetail(false); }
  };

  const exportRun = async (id: string) => {
    try {
      const dest = await intel.pickSavePath(`prediction-${id.slice(0, 8)}.csv`);
      if (!dest) return;
      await intel.export('prediction', id, dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const columnsOf = (rows: Record<string, unknown>[]): string[] => {
    if (rows.length === 0) return [];
    const base = Object.keys(rows[0]).filter((c) => !EXTRA.includes(c));
    for (const e of EXTRA) if (e in rows[0]) base.push(e);
    return base;
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Prediction history</h1>
          <p className="text-xs text-txt-muted mt-0.5">Every run with its model, dataset and full result set — stored locally.</p>
        </div>
        {runs && runs.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={busy}>
            <Trash2 size={14} /> Clear history
          </Button>
        )}
      </header>

      {error && <InlineAlert kind="error">{error}</InlineAlert>}

      {!runs ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-accent" size={20} /></div>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon size={20} />}
          title="No prediction runs yet"
          body="Run your first batch prediction to see it recorded here."
          action={<Link to="/intelligence/predict" className="text-accent underline underline-offset-2 text-sm">Run predictions</Link>}
        />
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="rounded-xl border border-ink-700 bg-ink-900/60 overflow-hidden">
              <button onClick={() => void open(r.id)} className="w-full text-left p-3.5 flex items-center gap-3 hover:bg-ink-850 transition-colors" aria-expanded={openId === r.id}>
                <span className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
                  <HistoryIcon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{r.model_name}</p>
                  <p className="text-2xs text-txt-dim mt-0.5">
                    {fmtDate(r.created_at)} · {r.dataset_name ?? 'inline records'} · {fmtNumber(r.record_count, 0)} records
                    {r.duration != null ? ` · ${r.duration.toFixed(2)}s` : ''}
                  </p>
                </div>
                <Badge tone={r.task === 'classification' ? 'accent' : r.task === 'regression' ? 'warning' : 'positive'}>
                  {TASK_LABELS[r.task] ?? r.task}
                </Badge>
              </button>

              {openId === r.id && (
                <div className="border-t border-ink-700 p-3.5 space-y-3">
                  {loadingDetail ? (
                    <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-accent" size={16} /></div>
                  ) : runDetail ? (
                    <RunResultTable
                      columns={columnsOf((runDetail.rows as Record<string, unknown>[]) ?? [])}
                      rows={((runDetail.rows as Record<string, unknown>[]) ?? []).slice(0, 25)}
                      total={runDetail.recordCount as number}
                    />
                  ) : (
                    <p className="text-2xs text-txt-dim">Result preview unavailable — use Export to write the saved CSV.</p>
                  )}
                  <div className="flex gap-2">
                    <Button variant="secondary" size="xs" onClick={() => void exportRun(r.id)}><Download size={12} /> Export CSV</Button>
                    <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(r.id)}><Trash2 size={12} /> Delete entry</Button>
                    {r.task === 'clustering' && <span className="text-2xs text-txt-dim self-center">Cluster IDs use the engine’s canonical ordering.</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this prediction run?"
        description={<span>Its result CSV and stored rows are removed. The model stays in your library.</span>}
        confirmLabel="Delete entry"
        loading={busy}
        onConfirm={async () => {
          if (!confirmDelete) return;
          setBusy(true);
          try {
            await intel.deleteRun(confirmDelete);
            if (openId === confirmDelete) { setOpenId(null); setRunDetail(null); }
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally { setBusy(false); setConfirmDelete(null); }
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear all prediction history?"
        description={<span>Every run and result file from Prediction History is removed. Models and datasets are kept.</span>}
        confirmLabel="Clear history"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await intel.clearRuns();
            setOpenId(null); setRunDetail(null);
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally { setBusy(false); setConfirmClear(false); }
        }}
      />
    </div>
  );
}

function RunResultTable({ columns, rows, total }: { columns: string[]; rows: Record<string, unknown>[]; total: number }) {
  const nav = useNavigate();
  if (columns.length === 0 || rows.length === 0) return <Card><CardBody className="py-6 text-center"><p className="text-2xs text-txt-dim">No stored rows for this run.</p></CardBody></Card>;
  return (
    <div className="rounded-lg border border-ink-700 overflow-x-auto">
      <table className="w-full text-2xs min-w-[420px]">
        <thead>
          <tr className="bg-ink-900 text-left border-b border-ink-700">
            {columns.map((c) => (
              <th key={c} className={`px-2.5 py-2 font-semibold whitespace-nowrap ${c.startsWith('_') ? 'text-accent' : ''}`}>
                {c.startsWith('_') ? c.replace('_', '') : c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 ? 'bg-ink-900/40' : ''}>
              {columns.map((c) => {
                const v = row[c];
                return (
                  <td key={c} className={`px-2.5 py-1.5 whitespace-nowrap max-w-[200px] truncate ${c.startsWith('_') ? 'font-semibold text-accent' : 'font-mono text-txt-muted'}`}>
                    {v == null || v === '' ? '—' : typeof v === 'number' ? fmtNumber(v) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length && (
        <p className="px-3 py-2 text-2xs text-txt-dim border-t border-ink-800">
          Showing first {rows.length} of {fmtNumber(total, 0)} rows — export the CSV for the full set.
        </p>
      )}
      <div className="px-3 py-2 text-2xs">
        <button className="text-accent hover:underline" onClick={() => nav('/intelligence/predict')}>Run another prediction →</button>
      </div>
    </div>
  );
}
