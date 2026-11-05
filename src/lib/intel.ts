/**
 * Typed bridge to the Intelligence backend (Rust commands + Python engine).
 * In the desktop app this calls Tauri IPC; in a plain browser (dev server or
 * tests) `invoke` resolves to a rejection so pages degrade to their empty/
 * error states without crashing.
 */

/* ---------- types shared with the Rust layer ---------- */

export interface ColumnMeta {
  name: string;
  dtype: 'numeric' | 'categorical' | 'datetime' | 'boolean' | string;
  missing: number;
  missing_pct: number;
  unique: number;
}

export interface DatasetSummary {
  id: string;
  name: string;
  original_name: string;
  byte_size: number;
  row_count: number;
  column_count: number;
  missing_total: number;
  duplicate_rows: number;
  imported_at: string;
}

export interface DatasetDetail {
  id: string;
  name: string;
  originalName: string;
  byteSize: number;
  rowCount: number;
  missingTotal: number;
  duplicateRows: number;
  importedAt: string;
  delimiter: string;
  encoding: string;
  profile: {
    row_count: number;
    column_count: number;
    missing_total: number;
    duplicate_rows: number;
    columns: ColumnMeta[];
    warnings?: string[];
  };
}

export interface PreviewResult {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ModelSummary {
  id: string;
  name: string;
  dataset_id?: string | null;
  dataset_name: string | null;
  task: 'classification' | 'regression' | 'clustering';
  algorithm: string;
  algorithm_label: string;
  target: string | null;
  train_rows: number | null;
  test_rows: number | null;
  scoring: number | null;
  scoring_label: string | null;
  created_at: string;
  duration_seconds: number | null;
}

export interface CompareRow {
  algorithm: string;
  label: string;
  duration_seconds?: number;
  score: number | null;
  saved?: boolean;
  error?: string | null;
  metrics: Record<string, unknown> | null;
}

export interface ModelFull extends Omit<ModelSummary, 'id' | 'created_at'> {
  id: string;
  dataset_id: string | null;
  metrics: Record<string, unknown> | null;
  comparison: CompareRow[] | null;
  classes: (string | number)[] | null;
  n_clusters: number | null;
  test_size: number | null;
  random_state: number | null;
  bundle_version: number | null;
  engine_version: string | null;
  featuresParsed: string[];
  created_at: string;
}

export interface RunSummary {
  id: string;
  model_id?: string;
  model_name: string;
  dataset_name: string | null;
  task: string;
  record_count: number;
  duration: number | null;
  summary?: string;
  created_at: string;
}

export interface WorkspaceStats {
  datasetCount: number;
  modelCount: number;
  runCount: number;
  lastRunAt: string | null;
  lastModelName: string | null;
  storageBytes: number;
}

export interface EngineStatus {
  ready: boolean;
  runtime: {
    python?: string;
    numpy?: string;
    pandas?: string;
    sklearn?: string;
    scipy?: string;
    joblib?: string;
  } | null;
}

export interface PredictResult {
  runId: string;
  recordCount: number;
  durationSeconds: number;
  task: string;
  algorithm: string;
  predictionNote: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface SampleEntry {
  file: string;
  title: string;
  task: string;
  description: string;
  rows?: number;
  license?: string;
}

/* ---------- invoke wrapper ---------- */

type Cmd = { cmd: string; args?: Record<string, unknown> };
const queue: Cmd[] = [];

/** Invoke a Rust command via Tauri; `undefined` outside the desktop shell. */
export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
  const internals = w.__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    const err = new Error('Intelligence requires the Vaultfolio desktop app (Tauri shell not detected).');
    // Keep a bounded queue of skipped commands for dev-tooling diagnostics.
    if (queue.length < 50) queue.push({ cmd, args });
    throw err;
  }
  return internals.invoke(cmd, args) as Promise<T>;
}

/* ---------- command helpers ---------- */

export const intel = {
  engineStatus: () => invoke<EngineStatus>('intel_engine_status'),
  workspaceStats: () => invoke<WorkspaceStats>('intel_workspace_stats'),

  pickCsv: () => invoke<string | null>('intel_pick_csv'),
  importCsv: (src: string, name?: string) => invoke<DatasetDetail>('intel_import_csv', { args: { src, name } }),
  listDatasets: () => invoke<DatasetSummary[]>('intel_list_datasets'),
  getDataset: (id: string) => invoke<DatasetDetail>('intel_get_dataset', { id }),
  deleteDataset: (id: string) => invoke<unknown>('intel_delete_dataset', { id }),
  preview: (args: {
    dataset_id: string;
    page: number;
    page_size: number;
    sort?: string;
    dir?: string;
    search?: string;
    columns?: string[];
  }) => invoke<PreviewResult>('intel_preview', { args }),
  columnStats: (dataset_id: string, column: string) =>
    invoke<Record<string, unknown>>('intel_column_stats', { dataset_id, column }),

  sampleCatalog: () => invoke<{ samples: SampleEntry[] }>('intel_sample_catalog'),
  seedSamples: () => invoke<{ seeded: number }>('intel_seed_samples'),

  train: (args: {
    dataset_id: string;
    task: 'classification' | 'regression' | 'clustering';
    target?: string;
    features: string[];
    test_size?: number;
    random_state?: number;
    algorithms?: string[];
    n_clusters?: number;
    dbscan_eps?: number;
    dbscan_min_samples?: number;
    model_name?: string;
  }) => invoke<ModelFull>('intel_train', { args }),

  listModels: () => invoke<ModelSummary[]>('intel_list_models'),
  getModel: (id: string) => invoke<ModelFull>('intel_get_model', { id }),
  renameModel: (id: string, name: string) => invoke<unknown>('intel_rename_model', { id, name }),
  deleteModel: (id: string) => invoke<unknown>('intel_delete_model', { id }),

  predict: (args: {
    model_id: string;
    rows?: Record<string, unknown>[];
    dataset_id?: string;
    csv_path?: string;
  }) => invoke<PredictResult>('intel_predict', { args }),

  listRuns: () => invoke<RunSummary[]>('intel_list_runs'),
  getRun: (id: string) => invoke<Record<string, unknown>>('intel_get_run', { id }),
  deleteRun: (id: string) => invoke<unknown>('intel_delete_run', { id }),
  clearRuns: () => invoke<unknown>('intel_clear_runs'),

  pickSavePath: (defaultName: string) => invoke<string | null>('intel_pick_save_path', { default_name: defaultName }),
  export: (kind: 'prediction' | 'dataset', id: string, dest: string) =>
    invoke<unknown>('intel_export', { args: { kind, id, dest } }),

  docs: () => invoke<{ docs: { slug: string; title: string; body: string }[] }>('intel_docs'),
};

/* ---------- progress events (training / import / prediction) ---------- */

export interface IntelProgress {
  stage: string;
  pct: number;
  message: string;
}

/** Subscribe to the Rust `intel://progress` event stream. */
export function onProgress(cb: (p: IntelProgress) => void): () => void {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: { event: { listen: (e: string, h: (ev: { payload: IntelProgress }) => void) => Promise<() => void> } } };
  const tauri = w.__TAURI__;
  if (tauri?.event?.listen) {
    const un = tauri.event.listen('intel://progress', (ev) => cb(ev.payload));
    return () => { void un.then((f) => f()).catch(() => {}); };
  }
  // Browser/dev fallback: tolerate absence (progress simply never fires).
  return () => {};
}

/* ---------- formatting helpers ---------- */

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let v = n / 1024;
  for (const u of units) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} TiB`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtNumber(v: number | null | undefined, digits = 3): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export const TASK_LABELS: Record<string, string> = {
  classification: 'Classification',
  regression: 'Regression',
  clustering: 'Clustering',
};
