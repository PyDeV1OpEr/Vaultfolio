import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BrainCircuit,
  Database,
  FlaskConical,
  HardDrive,
  History,
  LineChart,
  Loader2,
  Plus,
  Upload,
} from 'lucide-react';
import { Button, Card, CardBody, InlineAlert, StatCard } from '../../components/ui';
import { intel, fmtBytes, fmtDate, fmtNumber, TASK_LABELS } from '../../lib/intel';

export function Intelligence() {
  const nav = useNavigate();
  const [stats, setStats] = useState<null | Awaited<ReturnType<typeof intel.workspaceStats>>>(null);
  const [engine, setEngine] = useState<null | Awaited<ReturnType<typeof intel.engineStatus>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [datasets, setDatasets] = useState<Awaited<ReturnType<typeof intel.listDatasets>>>([]);
  const [models, setModels] = useState<Awaited<ReturnType<typeof intel.listModels>>>([]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [s, e, d, m] = await Promise.all([
        intel.workspaceStats(),
        intel.engineStatus(),
        intel.listDatasets(),
        intel.listModels(),
      ]);
      setStats(s);
      setEngine(e);
      setDatasets(d.slice(0, 4));
      setModels(m.slice(0, 4));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const seed = async () => {
    setSeeding(true);
    try {
      await intel.seedSamples();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  };

  const empty = !!stats && stats.datasetCount === 0 && stats.modelCount === 0 && stats.runCount === 0;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <BrainCircuit size={20} className="text-accent" /> Intelligence
          </h1>
          <p className="text-xs text-txt-muted mt-0.5 max-w-xl">
            Local machine learning for your records — import CSV data, train and compare models,
            run predictions, and keep every result on this device. No network required.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => nav('/intelligence/import')}>
            <Upload size={14} /> Import Dataset
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void seed()} loading={seeding} disabled={seeding}>
            <Plus size={14} /> Load samples
          </Button>
        </div>
      </header>

      {error && <InlineAlert kind="error">{error}</InlineAlert>}

      {/* Engine + runtime status */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
          {(!engine || !engine.ready) ? (
            <>
              <span className="flex items-center gap-2 text-txt-muted">
                <Loader2 size={14} className="animate-spin text-accent" />
                Starting the local Python engine…
              </span>
              <span className="text-txt-dim">
                First start can take a few seconds while NumPy / pandas / scikit-learn load.
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Local ML engine ready
              </span>
              {engine.runtime?.python && <span className="text-txt-dim font-mono text-2xs">Python {engine.runtime.python}</span>}
              {engine.runtime?.sklearn && <span className="text-txt-dim font-mono text-2xs">scikit-learn {engine.runtime.sklearn}</span>}
              {engine.runtime?.pandas && <span className="text-txt-dim font-mono text-2xs">pandas {engine.runtime.pandas}</span>}
              {engine.runtime?.numpy && <span className="text-txt-dim font-mono text-2xs">NumPy {engine.runtime.numpy}</span>}
            </>
          )}
        </CardBody>
      </Card>

      {empty && (
        <Card>
          <CardBody className="py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center mx-auto mb-4">
              <BrainCircuit size={22} className="text-accent" />
            </div>
            <h2 className="text-sm font-semibold tracking-tight">Your Intelligence workspace is empty</h2>
            <p className="text-xs text-txt-muted mt-1 max-w-md mx-auto leading-relaxed">
              Start by importing a CSV file — for example a list of sales, measurements or
              inventory records. Then choose a target column to train a model, or let the
              engine discover groups in your data.
            </p>
            <div className="flex justify-center gap-2 mt-5">
              <Button variant="primary" size="sm" onClick={() => nav('/intelligence/import')}>
                <Upload size={14} /> Import your first dataset
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void seed()} loading={seeding}>
                Explore with sample datasets
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {stats && !empty && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Datasets" value={fmtNumber(stats.datasetCount, 0)} sub="imported CSVs" icon={<Database size={14} />} />
            <StatCard label="Models" value={fmtNumber(stats.modelCount, 0)} sub="saved models" icon={<FlaskConical size={14} />} />
            <StatCard label="Predictions" value={fmtNumber(stats.runCount, 0)} sub="prediction runs" icon={<LineChart size={14} />} />
            <StatCard label="Local storage" value={fmtBytes(stats.storageBytes)} sub="Intelligence data" icon={<HardDrive size={14} />} />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {stats.lastModelName && (
              <Card><CardBody className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-2xs uppercase tracking-wider text-txt-dim font-semibold">Most recent model</p>
                  <p className="text-xs font-medium mt-0.5 truncate">{stats.lastModelName}</p>
                </div>
                <Link to="/intelligence/models" className="text-2xs text-accent hover:underline shrink-0">Library →</Link>
              </CardBody></Card>
            )}
            {stats.lastRunAt && (
              <Card><CardBody className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-2xs uppercase tracking-wider text-txt-dim font-semibold">Last analysis</p>
                  <p className="text-xs font-medium mt-0.5">{fmtDate(stats.lastRunAt)}</p>
                </div>
                <Link to="/intelligence/history" className="text-2xs text-accent hover:underline shrink-0">History →</Link>
              </CardBody></Card>
            )}
          </div>
        </>
      )}

      {/* Recent datasets + models */}
      {!empty && (
        <div className="grid md:grid-cols-2 gap-3">
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim">Recent datasets</h2>
                <Link to="/intelligence/datasets" className="text-2xs text-accent hover:underline">All datasets →</Link>
              </div>
              {datasets.length === 0 ? (
                <p className="text-xs text-txt-dim py-4 text-center">Nothing imported yet.</p>
              ) : (
                <ul className="space-y-1">
                  {datasets.map((d) => (
                    <li key={d.id}>
                      <Link
                        to={`/intelligence/datasets/${d.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-ink-850 transition-colors"
                      >
                        <span className="text-xs font-medium truncate">{d.name}</span>
                        <span className="text-2xs text-txt-dim shrink-0 font-mono tnum">{fmtNumber(d.row_count, 0)} rows</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim">Recent models</h2>
                <Link to="/intelligence/models" className="text-2xs text-accent hover:underline">Model library →</Link>
              </div>
              {models.length === 0 ? (
                <p className="text-xs text-txt-dim py-4 text-center">No trained models yet.</p>
              ) : (
                <ul className="space-y-1">
                  {models.map((m) => (
                    <li key={m.id}>
                      <Link
                        to={`/intelligence/models/${m.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-ink-850 transition-colors"
                      >
                        <span className="text-xs font-medium truncate">{m.name}</span>
                        <span className="text-2xs text-txt-dim shrink-0 flex items-center gap-1.5">
                          <History size={11} className="hidden" />
                          {TASK_LABELS[m.task] ?? m.task}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <QuickAction
          to="/intelligence/import"
          icon={<Upload size={16} />}
          title="Import Dataset"
          body="Pick a CSV from disk or drag it into the window."
        />
        <QuickAction
          to="/intelligence/datasets"
          icon={<Database size={16} />}
          title="Open Existing Dataset"
          body="Inspect columns, previews and column statistics."
        />
        <QuickAction
          to="/intelligence/train"
          icon={<FlaskConical size={16} />}
          title="Train a Model"
          body="Compare algorithms, then save the winner."
        />
        <QuickAction
          to="/intelligence/predict"
          icon={<LineChart size={16} />}
          title="Run Predictions"
          body="Apply a saved model to records or a CSV."
        />
        <QuickAction
          to="/intelligence/models"
          icon={<FlaskConical size={16} />}
          title="View Model Library"
          body="Metrics, evaluation charts, rename or delete."
        />
        <QuickAction
          to="/intelligence/history"
          icon={<History size={16} />}
          title="View Prediction History"
          body="Every run with results you can reopen or export."
        />
      </div>
    </div>
  );
}

function QuickAction({ to, icon, title, body }: { to: string; icon: React.ReactNode; title: string; body: string }) {
  const nav = useNavigate();
  return (
    <button
      onClick={() => nav(to)}
      className="text-left rounded-xl border border-ink-700 bg-ink-900/70 hover:bg-ink-850 hover:border-ink-650 transition-all duration-120 p-4 group focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/60"
    >
      <span className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/25 flex items-center justify-center text-accent mb-2.5 group-hover:scale-105 transition-transform">
        {icon}
      </span>
      <p className="text-xs font-semibold tracking-tight">{title}</p>
      <p className="text-2xs text-txt-dim mt-0.5 leading-relaxed">{body}</p>
    </button>
  );
}
