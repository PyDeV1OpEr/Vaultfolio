import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  Download,
  FlaskConical,
  LineChart,
  Loader2,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
} from '../../components/ui';
import { intel, fmtDate, fmtNumber, TASK_LABELS } from '../../lib/intel';

import { ClassificationEval } from '../../components/intel/EvalCharts';
import { RegressionEval } from '../../components/intel/EvalCharts';
import { ClusteringEval } from '../../components/intel/EvalCharts';

export function IntelModels() {
  const [models, setModels] = useState<Awaited<ReturnType<typeof intel.listModels>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const nav = useNavigate();

  const load = useCallback(async () => {
    try { setModels(await intel.listModels()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Model library</h1>
        <p className="text-xs text-txt-muted mt-0.5">Saved models with their preprocessing pipeline, held-out metrics and checksum.</p>
      </header>
      {error && <InlineAlert kind="error">{error}</InlineAlert>}
      {!models ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-accent" size={20} /></div>
      ) : models.length === 0 ? (
        <EmptyState
          icon={<FlaskConical size={20} />}
          title="No models yet"
          body="Train a model on one of your datasets to see it here."
          action={<Button variant="primary" size="sm" onClick={() => nav('/intelligence/train')}>Train a model</Button>}
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {models.map((m) => (
            <ModelCard key={m.id} model={m} onDelete={() => setConfirmId(m.id)} />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmId != null}
        onClose={() => setConfirmId(null)}
        title="Delete this model?"
        description={<span>The model file and its metrics are removed from this device. Datasets and prediction history are kept. This cannot be undone.</span>}
        confirmLabel="Delete model"
        loading={deleting}
        onConfirm={async () => {
          if (!confirmId) return;
          setDeleting(true);
          try { await intel.deleteModel(confirmId); await load(); }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); }
          finally { setDeleting(false); setConfirmId(null); }
        }}
      />
    </div>
  );
}

function ModelCard({ model, onDelete }: { model: Awaited<ReturnType<typeof intel.listModels>>[number]; onDelete: () => void }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <Link to={`/intelligence/models/${model.id}`} className="min-w-0 group">
            <p className="text-xs font-semibold truncate group-hover:text-accent transition-colors">{model.name}</p>
            <p className="text-2xs text-txt-dim mt-0.5">{fmtDate(model.created_at)}</p>
          </Link>
          <span onClick={onDelete} role="button" tabIndex={0} aria-label="Delete model" onKeyDown={(e) => e.key === 'Enter' && onDelete()} className="p-1.5 rounded-lg text-txt-dim hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer">
            <Trash2 size={14} />
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <Badge tone="accent">{TASK_LABELS[model.task] ?? model.task}</Badge>
          <Badge>{model.algorithm_label}</Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-2xs">
          <div>
            <p className="text-txt-dim uppercase tracking-wider font-semibold">{model.scoring_label?.split(' ').slice(0, 3).join(' ') ?? 'Score'}</p>
            <p className="tnum font-medium mt-0.5">{model.scoring != null ? fmtNumber(model.scoring, 4) : '—'}</p>
          </div>
          <div>
            <p className="text-txt-dim uppercase tracking-wider font-semibold">Trained on</p>
            <p className="mt-0.5 truncate" title={model.dataset_name ?? 'Independent sample'}>{model.dataset_name ?? '—'}</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/* ────────────────── model detail (evaluation) ────────────────── */

export function IntelModelDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [model, setModel] = useState<Awaited<ReturnType<typeof intel.getModel>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    intel.getModel(id)
      .then((m) => { if (alive) { setModel(m); setName(m.name); } })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
    return () => { alive = false; };
  }, [id]);

  if (error) return <div className="max-w-xl space-y-3"><InlineAlert kind="error">{error}</InlineAlert><Button size="sm" onClick={() => nav('/intelligence/models')}>Back to library</Button></div>;
  if (!model) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-accent" size={22} /></div>;

  const metrics = model.metrics as Record<string, unknown> | null;
  const comparison = model.comparison ?? [];

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{model.name}</h1>
          <p className="text-xs text-txt-muted mt-0.5">
            {TASK_LABELS[model.task]} · {model.algorithm_label} · trained {fmtDate(model.created_at)} ·
            {model.duration_seconds != null ? ` ${(model.duration_seconds).toFixed(1)}s` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => nav(`/intelligence/predict?model=${model.id}`)}>
            <Activity size={14} /> Run predictions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              setExportNote(null);
              const dest = await intel.pickSavePath(`${model.name}-results-note.csv`);
              setExportNote(dest ? 'Model artifacts stay on this device; use Predict → Export for result files.' : '');
            }}
            title="Export details"
          >
            <Download size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRenaming(!renaming)} aria-expanded={renaming}>
            <Pencil size={14} /> Rename
          </Button>
        </div>
      </header>

      {renaming && (
        <Card>
          <CardBody className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="model-name-input" className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1 block">Model name</label>
              <input id="model-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="w-full bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-xs focus:border-accent/50 outline-none" />
            </div>
            <Button variant="primary" size="sm" disabled={!name.trim()} onClick={async () => {
              await intel.renameModel(model.id, name.trim());
              setModel({ ...model, name: name.trim() });
              setRenaming(false);
            }}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => { setName(model.name); setRenaming(false); }}>Cancel</Button>
          </CardBody>
        </Card>
      )}

      {exportNote && <InlineAlert kind="info">{exportNote}</InlineAlert>}

      {/* metric summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricTile label={model.scoring_label ?? 'Score'} value={model.scoring} digits={Math.abs(model.scoring ?? 0) > 2 ? 2 : 4} />
        <MetricTile label="Train rows" value={model.train_rows} digits={0} />
        <MetricTile label="Test rows" value={model.test_rows} digits={0} />
        <MetricTile label="Features" value={model.featuresParsed?.length ?? 0} digits={0} />
      </div>

      {/* task-specific evaluation */}
      {model.task === 'classification' && <ClassificationEval metrics={metrics as never} />}
      {model.task === 'regression' && <RegressionEval metrics={metrics as never} />}
      {model.task === 'clustering' && <ClusteringEval metrics={metrics as never} nClusters={model.n_clusters} />}

      {/* algorithm comparison */}
      {comparison.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Algorithm comparison (same split)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-2xs">
                <thead>
                  <tr className="border-b border-ink-700 text-txt-dim text-left">
                    <th className="px-2.5 py-2 font-semibold">Algorithm</th>
                    <th className="px-2.5 py-2 font-semibold">Duration</th>
                    <th className="px-2.5 py-2 font-semibold">{model.scoring_label?.split(' ').slice(0, 2).join(' ') ?? 'Score'}</th>
                    <th className="px-2.5 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((c, i) => (
                    <tr key={i} className={`border-b border-ink-800 ${c.algorithm === model.algorithm ? 'bg-accent/8' : ''}`}>
                      <td className="px-2.5 py-2 whitespace-nowrap font-medium flex items-center gap-1.5">
                        {c.algorithm === model.algorithm && <Star size={12} className="text-accent fill-accent shrink-0" />}
                        <span>{c.label ?? c.algorithm}</span>
                      </td>
                      <td className="px-2.5 py-2 tnum whitespace-nowrap">{c.duration_seconds != null ? `${c.duration_seconds.toFixed(1)}s` : '—'}</td>
                      <td className="px-2.5 py-2 tnum">{fmtNumber(c.score, 4)}</td>
                      <td className="px-2.5 py-2">{c.error ? <span className="text-rose-400">{c.error}</span> : c.saved ? 'saved' : 'evaluated'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-2xs text-txt-dim mt-2">All candidates were trained and evaluated on the exact same split. Metrics are task-specific and never mixed across tasks.</p>
          </CardBody>
        </Card>
      )}

      {/* meta */}
      <Card>
        <CardBody className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-2xs">
          <Kv k="Target column" v={model.target ?? '— (clustering)'} />
          <Kv k="Test split" v={model.test_size != null ? `${Math.round(model.test_size * 100)}%` : '—'} />
          <Kv k="Random seed" v={String(model.random_state ?? '—')} />
          <Kv k="Pipeline version" v={String(model.bundle_version ?? '—')} />
          <Kv k="Engine version" v={model.engine_version ?? '—'} />
          <Kv k="Training dataset" v={model.dataset_name ?? '—'} />
        </CardBody>
      </Card>

      {/* features */}
      <Card>
        <CardBody>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Feature schema (saved with the pipeline)</h2>
          <div className="flex flex-wrap gap-1.5">
            {(model.featuresParsed ?? []).map((f) => <Badge key={f}>{f}</Badge>)}
          </div>
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={() => nav(`/intelligence/predict?model=${model.id}`)}>
          <LineChart size={14} /> Predict with this model
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
          <Trash2 size={14} /> Delete model
        </Button>
      </div>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this model?"
        description={<span>{model.name} and its saved pipeline will be removed. Prediction history stays. This cannot be undone.</span>}
        confirmLabel="Delete model"
        onConfirm={async () => {
          try { await intel.deleteModel(model.id); nav('/intelligence/models'); }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); setDeleting(false); }
        }}
      />
    </div>
  );
}

function MetricTile({ label, value, digits = 3 }: { label: string; value: number | null; digits?: number }) {
  return (
    <Card>
      <CardBody>
        <p className="text-2xs uppercase tracking-wider text-txt-dim font-semibold">{label}</p>
        <p className="text-base font-semibold tnum mt-0.5">{value != null ? fmtNumber(value, digits) : '—'}</p>
      </CardBody>
    </Card>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-ink-800 pb-1">
      <span className="text-txt-dim">{k}</span>
      <span className="font-mono truncate" title={v}>{v}</span>
    </div>
  );
}
