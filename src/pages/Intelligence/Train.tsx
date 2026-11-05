import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FlaskConical, Info, Sparkles, Wand2 } from 'lucide-react';
import { Button, Card, CardBody, InlineAlert, Select } from '../../components/ui';
import { intel, fmtNumber, TASK_LABELS, onProgress } from '../../lib/intel';

export type Task = 'classification' | 'regression' | 'clustering';

const ALGOS: Record<Task, { id: string; label: string; hint: string }[]> = {
  classification: [
    { id: 'logistic_regression', label: 'Logistic Regression', hint: 'Fast, interpretable linear baseline' },
    { id: 'random_forest_classifier', label: 'Random Forest', hint: 'Robust ensemble, handles mixed types' },
    { id: 'decision_tree_classifier', label: 'Decision Tree', hint: 'Readable rule-based splits' },
    { id: 'gradient_boosting_classifier', label: 'Gradient Boosting', hint: 'Often highest accuracy' },
    { id: 'linear_svc', label: 'Linear SVC', hint: 'Linear support vector machine' },
  ],
  regression: [
    { id: 'linear_regression', label: 'Linear Regression', hint: 'Plain least squares baseline' },
    { id: 'ridge', label: 'Ridge Regression', hint: 'Least squares with regularization' },
    { id: 'random_forest_regressor', label: 'Random Forest Regressor', hint: 'Robust non-linear ensemble' },
    { id: 'decision_tree_regressor', label: 'Decision Tree Regressor', hint: 'Piecewise-constant estimates' },
    { id: 'gradient_boosting_regressor', label: 'Gradient Boosting Regressor', hint: 'Usually strongest predictor' },
  ],
  clustering: [
    { id: 'kmeans', label: 'K-Means', hint: 'Partitions into k groups by distance to centroids' },
    { id: 'dbscan', label: 'DBSCAN', hint: 'Density-based; finds clusters of any shape, flags noise' },
  ],
};

const PRIMARY_METRIC: Record<Task, string> = {
  classification: 'accuracy',
  regression: 'r2',
  clustering: 'silhouette',
};

interface DatasetProfileColumn {
  name: string;
  dtype: string;
  missing: number;
  missing_pct: number;
  unique: number;
}

export function IntelTrain() {
  const nav = useNavigate();
  const loc = useLocation() as { state?: { datasetId?: string } };
  const [datasets, setDatasets] = useState<Awaited<ReturnType<typeof intel.listDatasets>>>([]);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof intel.getDataset>> | null>(null);
  const [datasetId, setDatasetId] = useState<string>(loc.state?.datasetId ?? '');
  const [task, setTask] = useState<Task>('classification');
  const [target, setTarget] = useState('');
  const [features, setFeatures] = useState<Set<string>>(new Set());
  const [testSize, setTestSize] = useState(0.25);
  const [algoMode, setAlgoMode] = useState<'auto' | Task>('auto');
  const [algos, setAlgos] = useState<Set<string>>(new Set());
  const [nClusters, setNClusters] = useState(4);
  const [dbscanEps, setDbscanEps] = useState<number | ''>('');
  const [dbscanMinSamples, setDbscanMinSamples] = useState(5);
  const [modelName, setModelName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof intel.getModel>> | null>(null);

  useEffect(() => { void intel.listDatasets().then(setDatasets).catch(() => setDatasets([])); }, []);

  useEffect(() => {
    if (!datasetId) { setDetail(null); return; }
    setDetail(null);
    let alive = true;
    intel.getDataset(datasetId).then((d) => {
      if (!alive) return;
      setDetail(d);
      // Sensible defaults once the task is picked (see task effect below).
    }).catch(() => setDetail(null));
    return () => { alive = false; };
  }, [datasetId]);

  const cols = (detail?.profile?.columns ?? []) as DatasetProfileColumn[];
  const intendedTask: Task | 'auto' = algoMode === 'auto' ? 'auto' : algoMode;
  const isClustering = task === 'clustering';

  // When a dataset is loaded but no target chosen yet, withhold supervised
  // defaults until the user picks a task (the target effect handles it).
  useEffect(() => {
    // reset target when switching datasets
    if (detail && cols.length > 0) {
      if (!cols.some((c) => c.name === target)) setTarget('');
      // feature default: everything except target, IDs/notes/high-uniqueness text
      const guess = defaultFeatureSet(cols, task, target);
      setFeatures(new Set(guess));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, task]);

  useEffect(() => {
    // Re-derive features when the target changes too.
    if (detail && cols.length > 0 && target) {
      setFeatures((prev) => {
        const next = new Set(prev);
        next.delete(target);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const canTrain = useMemo(() => {
    if (!detail || features.size === 0) return false;
    if (task === 'clustering') return true;
    return cols.some((c) => c.name === target);
  }, [detail, features, task, target, cols]);

  useEffect(() => {
    // Live progress during long training jobs; safe no-op outside the desktop shell.
    return onProgress((p) => setProgress({ pct: p.pct, message: p.message }));
  }, []);

  const train = async () => {
    if (!detail || !canTrain) return;
    setBusy(true);
    setError(null);
    setProgress({ pct: 2, message: 'Submitting training job…' });
    try {
      const m = await intel.train({
        dataset_id: detail.id,
        task,
        target: task === 'clustering' ? undefined : target,
        features: [...features],
        test_size: isClustering ? undefined : testSize,
        algorithms: Array.from(algos).length > 0 && algoMode !== 'auto' ? Array.from(algos) : ['auto'],
        n_clusters: task === 'clustering' ? nClusters : undefined,
        dbscan_eps: typeof dbscanEps === 'number' ? dbscanEps : undefined,
        dbscan_min_samples: task === 'clustering' ? dbscanMinSamples : undefined,
        model_name: modelName.trim() || undefined,
      });
      setResult(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (result) return <TrainResult model={result} onList={() => nav('/intelligence/models')} onNew={() => setResult(null)} />;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Train a model</h1>
        <p className="text-xs text-txt-muted mt-0.5">
          Hold-out evaluation only — metrics you see are computed on records the model never saw.
        </p>
      </header>

      {datasets.length === 0 ? (
        <InlineAlert kind="info">Import a dataset first — training needs a table of columns to learn from.</InlineAlert>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-4">
              {/* dataset */}
              <Step n={1} title="Dataset">
                <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className="max-w-md" aria-label="Dataset">
                  <option value="">Select a dataset…</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} · {fmtNumber(d.row_count, 0)} rows</option>
                  ))}
                </Select>
                {!detail && datasetId && <p className="text-2xs text-txt-dim">Loading dataset…</p>}
              </Step>

              {detail && (
                <>
                  {/* task + target */}
                  <Step n={2} title="Task and target">
                    <div className="flex gap-2 flex-wrap">
                      {(['classification', 'regression', 'clustering'] as Task[]).map((t) => (
                        <TaskChip key={t} active={task === t} onClick={() => { setTask(t); if (t === 'clustering') setTarget(''); }}>
                          {t === 'classification' ? 'Predict a category' : t === 'regression' ? 'Predict a number' : 'Discover groups'}
                        </TaskChip>
                      ))}
                    </div>
                    {!isClustering && (
                      <div className="mt-2.5 max-w-md">
                        <label className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1 block">Target column</label>
                        <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target column">
                          <option value="">Select the column to predict…</option>
                          {cols.map((c) => (
                            <option key={c.name} value={c.name}>{c.name} ({c.dtype})</option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </Step>

                  {/* features */}
                  <Step n={3} title="Features" sub={`${features.size} of ${cols.length} columns selected`}>
                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
                      {cols.map((c) => {
                        const disabled = !isClustering && c.name === target;
                        const on = features.has(c.name);
                        const lowValue = c.unique <= 1;
                        return (
                          <button
                            key={c.name}
                            type="button"
                            disabled={disabled || lowValue}
                            onClick={() =>
                              setFeatures((prev) => {
                                const n = new Set(prev);
                                if (n.has(c.name)) n.delete(c.name); else n.add(c.name);
                                return n;
                              })
                            }
                            className={`px-2 py-1 rounded-md text-2xs border transition-colors ${
                              disabled
                                ? 'border-ink-700 text-txt-dim opacity-50 cursor-not-allowed'
                                : on
                                ? 'border-accent/40 bg-accent/12 text-accent'
                                : 'border-ink-700 text-txt-muted hover:border-ink-600'
                            }`}
                            title={lowValue ? 'Only one distinct value — no signal' : c.dtype}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                    {!isClustering && target && (
                      <p className="text-2xs text-txt-dim mt-1.5 flex items-center gap-1">
                        <Info size={11} /> The target column is excluded from the inputs so the model can never peek at it.
                      </p>
                    )}
                  </Step>

                  {/* eval split */}
                  {!isClustering && (
                    <Step n={4} title="Test split" sub={`${Math.round((1 - testSize) * 100)}% train · ${Math.round(testSize * 100)}% test`}>
                      <input
                        type="range"
                        min={5}
                        max={50}
                        step={5}
                        value={Math.round(testSize * 100)}
                        onChange={(e) => setTestSize(Number(e.target.value) / 100)}
                        className="w-64"
                        aria-label="Test split percentage"
                      />
                    </Step>
                  )}

                  {/* algorithms */}
                  <Step n={5} title={isClustering ? 'Clustering algorithm' : 'Models to compare'} sub={isClustering ? undefined : '“Compare candidates” trains several models on the same split and ranks them.'}>
                    <div className="flex gap-2 flex-wrap mb-2">
                      <TaskChip active={algoMode === 'auto'} onClick={() => setAlgoMode('auto')}>
                        <Sparkles size={12} /> Compare candidates
                      </TaskChip>
                      <TaskChip active={algoMode === task} onClick={() => setAlgoMode(task)}>
                        <Wand2 size={12} /> Choose manually
                      </TaskChip>
                    </div>
                    {algoMode === task && (
                      <div className="space-y-1.5 max-w-md">
                        {ALGOS[task].map((a) => (
                          <label key={a.id} className="flex items-start gap-2.5 text-xs p-2 rounded-lg border border-ink-700 hover:bg-ink-850 transition-colors cursor-pointer">
                            <input
                              type="checkbox"
                              checked={algos.has(a.id)}
                              onChange={() =>
                                setAlgos((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })
                              }
                              className="mt-1 accent-[var(--accent)]"
                            />
                            <span>
                              <span className="font-medium">{a.label}</span>
                              <span className="block text-2xs text-txt-dim mt-0.5">{a.hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    {isClustering && (
                      <div className="space-y-2 max-w-md text-xs">
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-txt-muted">Number of clusters (K-Means)</span>
                          <input type="number" min={2} max={20} value={nClusters} onChange={(e) => setNClusters(Math.max(2, Math.min(20, Number(e.target.value) || 4)))} className="w-20 bg-ink-950 border border-ink-700 rounded-lg px-2 py-1.5 tnum" />
                        </label>
                        {algos.has('dbscan') && (
                          <>
                            <label className="flex items-center justify-between gap-3">
                              <span className="text-txt-muted">DBSCAN eps (blank = auto)</span>
                              <input value={dbscanEps} onChange={(e) => setDbscanEps(e.target.value === '' ? '' : Number(e.target.value))} placeholder="auto on scaled data" className="w-40 bg-ink-950 border border-ink-700 rounded-lg px-2 py-1.5 tnum" />
                            </label>
                            <label className="flex items-center justify-between gap-3">
                              <span className="text-txt-muted">DBSCAN min samples</span>
                              <input type="number" min={2} max={50} value={dbscanMinSamples} onChange={(e) => setDbscanMinSamples(Math.max(2, Number(e.target.value) || 5))} className="w-20 bg-ink-950 border border-ink-700 rounded-lg px-2 py-1.5 tnum" />
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </Step>

                  {/* name + run */}
                  <Step n={isClustering ? 4 : 6} title="Name and run">
                    <div className="max-w-md">
                      <label className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1 block">Model name (optional)</label>
                      <input
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        placeholder={autoName(task, target, detail.name)}
                        className="w-full bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-xs focus:border-accent/50 outline-none"
                        maxLength={120}
                      />
                    </div>
                    {busy ? (
                      <div className="mt-3">
                        <div className="flex items-center gap-2 text-xs text-txt-muted">
                          <FlaskConical size={13} className="animate-pulse text-accent" /> {progress?.message ?? 'Training…'}
                        </div>
                        <div className="w-full max-w-md h-1.5 rounded-full bg-ink-800 mt-2 overflow-hidden">
                          <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress?.pct ?? 5}%` }} />
                        </div>
                      </div>
                    ) : (
                      <Button variant="primary" size="sm" className="mt-1" disabled={!canTrain} onClick={() => void train()}>
                        Start training
                      </Button>
                    )}
                    {!canTrain && task !== 'clustering' && !target && (
                      <p className="text-2xs text-txt-dim mt-1.5">Pick a target column to continue.</p>
                    )}
                  </Step>
                </>
              )}
            </CardBody>
          </Card>

          {error && <InlineAlert kind="error">{error}</InlineAlert>}

          <p className="text-2xs text-txt-dim max-w-xl">
            Metrics for algorithms that cannot be compared on the same scale (for example R² versus
            accuracy across different tasks) are never mixed: comparison only scores candidates for
            the same task. {intendedTask === 'auto' ? 'Manual selection is off — all candidates of this task are compared.' : 'Manual selection is active.'}
          </p>
        </>
      )}
    </div>
  );
}

function Step({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-ink-800 border border-ink-650 text-2xs font-mono tnum flex items-center justify-center text-txt-muted shrink-0 mt-0.5">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-tight">{title}{sub && <span className="text-2xs font-normal text-txt-dim ml-2">{sub}</span>}</p>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

function TaskChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-2xs font-medium border transition-colors ${
        active ? 'border-accent/40 bg-accent/12 text-accent' : 'border-ink-700 text-txt-muted hover:border-ink-600 hover:text-txt'
      }`}
    >
      {children}
    </button>
  );
}

function defaultFeatureSet(cols: DatasetProfileColumn[], task: Task, target: string): string[] {
  const exclude = new Set<string>(target ? [target] : []);
  for (const c of cols) {
    const n = c.name.toLowerCase();
    if (n === 'id' || n === 'index' || n.endsWith('_id') || n === 'timestamp' || n === 'row_id') continue;
    if (c.dtype === 'datetime') continue; // datetime features stay out of the first pass
    if (c.unique != null && c.unique <= 1) continue; // constant columns carry no signal
    exclude.add(c.name);
  }
  // If the exclusion was too aggressive keep at least numeric + low-cardinality categorical ones.
  let picks = cols.map((c) => c.name).filter((n) => !exclude.has(n));
  if (picks.length === 0) {
    picks = cols
      .filter((c) => (c.dtype === 'numeric' || c.dtype === 'categorical') && (!target || c.name !== target))
      .map((c) => c.name);
  }
  // For a supervised task also drop obvious leakage: columns too similar to the target.
  if (task !== 'clustering' && target) {
    const t = cols.find((c) => c.name === target);
    picks = picks.filter((n) => {
      const c = cols.find((x) => x.name === n);
      return !(c && t && c.unique === t.unique && c.dtype === t.dtype && c.unique != null && c.unique < 5 && Math.abs((c.missing ?? 0) - (t.missing ?? 0)) <= 1 && n.toLowerCase().includes(target.toLowerCase().split(/[^a-z]/)[0]));
    });
  }
  return picks;
}

function autoName(task: Task, target: string, datasetName: string): string {
  const t = TASK_LABELS[task] ?? task;
  return target ? `${target} · ${t} · ${datasetName}` : `${t} · ${datasetName}`;
}

/* ── step internals ── */

function TrainResult({
  model,
  onList,
  onNew,
}: {
  model: Awaited<ReturnType<typeof intel.getModel>>;
  onList: () => void;
  onNew: () => void;
}) {
  const primary = model.scoring ?? null;
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="rounded-xl border border-emerald-600/30 bg-emerald-500/5 p-4">
        <p className="text-xs font-semibold text-emerald-300 flex items-center gap-2"><Sparkles size={14} /> Model saved to your library</p>
        <p className="text-2xs text-txt-muted mt-1">
          {model.name} — evaluated on {model.test_rows == null ? '' : `${fmtNumber(model.test_rows, 0)} held-out rows`}.
        </p>
      </div>
      {primary != null && (
        <Card>
          <CardBody className="flex items-center justify-between gap-3">
            <div>
              <p className="text-2xs uppercase tracking-wider text-txt-dim font-semibold">{model.scoring_label ?? 'Score'}</p>
              <p className="text-lg font-semibold tnum">{fmtNumber(primary, 4)}</p>
            </div>
            <div className="text-2xs text-txt-dim text-right">
              <p>{fmtNumber(model.train_rows ?? 0, 0)} train rows</p>
              <p>{model.test_rows != null ? `${fmtNumber(model.test_rows, 0)} test rows` : 'no test split'}</p>
            </div>
          </CardBody>
        </Card>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={onList}>Open library</Button>
        <Button variant="secondary" size="sm" onClick={onNew}>Train another model</Button>
      </div>
    </div>
  );
}
