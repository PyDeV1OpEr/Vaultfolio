import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, Download, Table2, Upload } from 'lucide-react';
import { Button, Card, CardBody, EmptyState, InlineAlert, Select } from '../../components/ui';
import { intel, fmtNumber, TASK_LABELS } from '../../lib/intel';

export function IntelPredict() {
  const [params, setParams] = useSearchParams();
  const [models, setModels] = useState<Awaited<ReturnType<typeof intel.listModels>>>([]);
  const [datasets, setDatasets] = useState<Awaited<ReturnType<typeof intel.listDatasets>>>([]);
  const [modelId, setModelId] = useState(params.get('model') ?? '');
  const [mode, setMode] = useState<'dataset' | 'csv' | 'rows'>('dataset');
  const [datasetId, setDatasetId] = useState('');
  const [csvPath, setCsvPath] = useState<string | null>(null);
  const [rowsText, setRowsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof intel.predict>> | null>(null);
  const [page, setPage] = useState(0);
  const PAGE = 50;

  useEffect(() => {
    void intel.listModels().then(setModels).catch(() => setModels([]));
    void intel.listDatasets().then(setDatasets).catch(() => setDatasets([]));
  }, []);

  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);
  const canRun = !!model && (mode === 'dataset' ? !!datasetId : mode === 'csv' ? !!csvPath : rowsText.trim().length > 0);

  const run = async () => {
    if (!model || !canRun) return;
    setBusy(true);
    setError(null);
    try {
      const args: Record<string, unknown> = { model_id: model.id };
      if (mode === 'dataset') { args.dataset_id = datasetId; setParams({ model: model.id }); }
      else if (mode === 'csv') { args.csv_path = csvPath!; setParams({ model: model.id }); }
      else { args.rows = parseRows(rowsText); if (!Array.isArray(args.rows) || args.rows.length === 0) throw new Error('Add at least one record of column:value pairs.'); }
      const r = await intel.predict(args as never);
      setResult(r);
      setPage(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    if (!result) return;
    try {
      const dest = await intel.pickSavePath(`predictions-${result.runId.slice(0, 8)}.csv`);
      if (!dest) return;
      await intel.export('prediction', result.runId, dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (models.length > 0 && !modelId) {
    return (
      <EmptyState
        icon={<Activity size={20} />}
        title="Choose a model"
        body="Predictions are always made with a saved model from your library."
        action={<Button variant="primary" size="sm" onClick={() => setModelId(models[0].id)}>Use most recent model</Button>}
      />
    );
  }
  if (models.length === 0) {
    return (
      <EmptyState
        icon={<Activity size={20} />}
        title="No models to predict with"
        body="Train a model first — the prediction engine applies a saved preprocessing pipeline to new records."
        action={<Link to="/intelligence/train" className="text-accent underline underline-offset-2 text-sm">Train a model</Link>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Run predictions</h1>
        <p className="text-xs text-txt-muted mt-0.5">
          The saved pipeline (imputation, encoding, scaling) is applied exactly as during training — no manual preprocessing.
        </p>
      </header>

      <Card>
        <CardBody className="grid md:grid-cols-[1fr_260px] gap-4">
          <div className="space-y-3">
            <div>
              <label className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1 block">Model</label>
              <Select value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="Model">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} · {TASK_LABELS[m.task] ?? m.task}</option>
                ))}
              </Select>
            </div>

            {model && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-2xs text-txt-dim font-medium w-full md:w-auto">Input records:</span>
                {(['dataset', 'csv', 'rows'] as const).map((mo) => (
                  <button key={mo} onClick={() => setMode(mo)} className={`px-2.5 py-1 rounded-md text-2xs border transition-colors ${mode === mo ? 'border-accent/40 bg-accent/12 text-accent' : 'border-ink-700 text-txt-muted hover:border-ink-600'}`}>
                    {mo === 'dataset' ? 'From imported dataset' : mo === 'csv' ? 'From a CSV file' : 'Single records (JSON)'}
                  </button>
                ))}
              </div>
            )}

            {mode === 'dataset' && (
              <div>
                <label className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1 block">Dataset</label>
                <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} aria-label="Batch dataset">
                  <option value="">Select a dataset…</option>
                  {datasets.map((d) => (<option key={d.id} value={d.id}>{d.name} · {fmtNumber(d.row_count, 0)} rows</option>))}
                </Select>
                {datasets.length === 0 && <p className="text-2xs text-txt-dim mt-1">No datasets imported yet.</p>}
              </div>
            )}

            {mode === 'csv' && (
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={async () => {
                  const p = await intel.pickCsv();
                  if (p) setCsvPath(p);
                }}>
                  <Upload size={13} /> Choose CSV…
                </Button>
                {csvPath && <span className="text-2xs font-mono text-txt-muted truncate">{(csvPath ?? '').split('/').pop()}</span>}
              </div>
            )}

            {mode === 'rows' && (
              <div>
                <label className="text-2xs uppercase tracking-wider text-txt-dim font-semibold mb-1 block">JSON records</label>
                <textarea
                  rows={4}
                  value={rowsText}
                  onChange={(e) => setRowsText(e.target.value)}
                  placeholder={'[{"age": 42, "region": "north", "price": 125000}]'}
                  className="w-full bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-2xs font-mono focus:border-accent/50 outline-none"
                />
                <p className="text-2xs text-txt-dim mt-1">Use the model's saved feature names: {model?.target ? `anything except “${model.target}”` : 'the model’s features'}. Missing columns are imputed by the pipeline only if they trained with imputation.</p>
              </div>
            )}

            {/* confidence expectation note */}
            {model && (
              <p className="text-2xs text-txt-dim">
                {model.task === 'classification' && 'Classification results include class probabilities when the algorithm supports them.'}
                {model.task === 'regression' && 'Regression results show predictions only — a reliable interval is not estimated by these models.'}
                {model.task === 'clustering' && 'Clustering results include the assigned group and distance to it.'}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end justify-end gap-2">
            <Button variant="primary" size="md" disabled={!canRun || busy} onClick={() => void run()} loading={busy}>
              <Activity size={14} /> Run predictions
            </Button>
          </div>
        </CardBody>
      </Card>

      {error && <InlineAlert kind="error">{error}</InlineAlert>}

      {result && <PredictResults result={result} page={page} setPage={setPage} pageSize={PAGE} onExport={() => void exportCsv()} />}
    </div>
  );
}

function parseRows(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text.trim());
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object') return [parsed as Record<string, unknown>];
  throw new Error('Records must be a JSON object or an array of objects.');
}

function PredictResults({
  result, page, setPage, pageSize, onExport,
}: {
  result: Awaited<ReturnType<typeof intel.predict>>;
  page: number;
  setPage: (n: number) => void;
  pageSize: number;
  onExport: () => void;
}) {
  const paged = result.rows.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(result.rows.length / pageSize));
  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <span className="font-semibold text-emerald-300">{fmtNumber(result.recordCount, 0)} records predicted</span>
          <span className="text-txt-dim">{TASK_LABELS[result.task] ?? result.task} · {result.algorithm}</span>
          <span className="text-txt-dim tnum">{result.durationSeconds != null ? `${result.durationSeconds.toFixed(2)}s` : ''}</span>
          {result.predictionNote && <span className="text-txt-muted text-2xs w-full sm:w-auto">{result.predictionNote}</span>}
          <Button variant="secondary" size="xs" className="ml-auto" onClick={onExport}>
            <Download size={12} /> Export CSV
          </Button>
        </CardBody>
      </Card>

      <div className="rounded-xl border border-ink-700 overflow-x-auto bg-ink-950/60">
        <table className="w-full text-2xs min-w-[480px]">
          <thead>
            <tr className="border-b border-ink-700 bg-ink-900/80 text-left">
              {result.columns.map((c) => (
                <th key={c} className={`px-2.5 py-2 font-semibold whitespace-nowrap ${c.startsWith('_') ? 'text-accent' : ''}`}>
                  {prettyCol(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} className={i % 2 ? 'bg-ink-900/40' : ''}>
                {result.columns.map((c) => {
                  const v = row[c];
                  const isPred = c.startsWith('_');
                  return (
                    <td key={c} className={`px-2.5 py-1.5 whitespace-nowrap max-w-[220px] truncate ${isPred ? 'font-semibold text-accent' : 'font-mono text-txt-muted'}`} title={String(v ?? '')}>
                      {v == null || v === '' ? <span className="text-ink-600">—</span> : typeof v === 'number' ? fmtNumber(v) : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-2xs text-txt-dim">
        <span className="flex items-center gap-1.5"><Table2 size={12} /> Predicted columns in <span className="text-accent font-medium">accent</span></span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
            <span className="tnum font-mono">{page + 1} / {totalPages}</span>
            <Button variant="ghost" size="xs" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </div>

      <Link to="/intelligence/history" className="text-2xs text-accent hover:underline">This run is saved in Prediction History →</Link>
    </div>
  );
}

function prettyCol(c: string): string {
  if (c === '_prediction') return 'prediction';
  if (c === '_confidence') return 'confidence';
  if (c === '_uncertainty') return 'uncertainty ±';
  if (c === '_cluster_distance') return 'cluster distance';
  return c;
}
