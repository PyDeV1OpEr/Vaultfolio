import { useMemo } from 'react';
import { BarChart2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardBody, EmptyState } from '../ui';
import { CHART_PALETTE } from '../Charts';
import { fmtNumber } from '../../lib/intel';

/* ---------- classification ---------- */

export function ClassificationEval({ metrics }: { metrics: Record<string, any> | null }) {
  if (!metrics || metrics.accuracy == null) return <EvaluateEmpty />;

  const labels: string[] = Array.isArray(metrics.confusion_labels) ? metrics.confusion_labels : [];
  const cm: number[][] | null = Array.isArray(metrics.confusion_matrix) ? metrics.confusion_matrix : null;
  // Engine shape: classification_report: [{class, precision, recall, f1, support}]
  const report: { class: string; precision: number; recall: number; f1: number; support: number }[] =
    Array.isArray(metrics.classification_report) ? metrics.classification_report : [];
  const rocCurve: { fpr: number; tpr: number }[] | null = Array.isArray(metrics.roc_curve) && metrics.roc_curve.length > 0 ? metrics.roc_curve : null;
  const prCurve: { precision: number; recall: number }[] | null = Array.isArray(metrics.pr_curve) && metrics.pr_curve.length > 0 ? metrics.pr_curve : null;

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card>
        <CardBody>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Hold-out metrics</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Metric label="Accuracy" v={numOf(metrics.accuracy)} />
            <Metric label="ROC-AUC" v={numOf(metrics.roc_auc)} hint={numOf(metrics.roc_auc) == null ? 'not available for this model' : 'OvR macro-mean for multiclass'} />
            <Metric label="Macro precision" v={numOf(metrics.precision_macro)} />
            <Metric label="Macro recall" v={numOf(metrics.recall_macro)} />
            <Metric label="Macro F1" v={numOf(metrics.f1_macro)} hint="primary ranking score" />
            <Metric label="Train / test rows" v={null} hint={`${fmtNumber(metrics.train_rows, 0)} / ${fmtNumber(metrics.test_rows, 0)}`} />
          </div>
        </CardBody>
      </Card>

      {cm && labels.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Confusion matrix</h2>
            <div className="overflow-auto">
              <table className="text-2xs border-separate" style={{ borderSpacing: 3 }}>
                <thead>
                  <tr>
                    <th className="text-txt-dim font-medium px-1">actual ↓ · pred →</th>
                    {labels.map((l) => (
                      <th key={l} className="text-txt-muted font-mono px-1.5 pb-1">{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cm.map((row, i) => (
                    <tr key={i}>
                      <td className="text-txt-muted font-mono px-1.5 text-right">{String(labels[i])}</td>
                      {row.map((v, j) => {
                        const rowSum = row.reduce((a: number, b: number) => a + b, 0) || 1;
                        const intensity = v / rowSum;
                        return (
                          <td
                            key={j}
                            title={`predicted ${String(labels[j])} · ${v} of ${rowSum} actual ${String(labels[i])}`}
                            className="px-1.5 py-1 rounded text-center tnum font-medium"
                            style={{
                              background: v === 0 ? 'rgb(28 31 38 / 80%)' : `color-mix(in oklab, rgb(52 211 153) ${Math.round(10 + intensity * 65)}%, rgb(21 24 29))`,
                              color: intensity > 0.5 || (v > 0 && intensity < 0.2) ? '#0f1115' : '#e5e7eb',
                            }}
                          >
                            {v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-2xs text-txt-dim mt-2">Diagonal = correct predictions. Off-diagonal cells show which classes get confused.</p>
          </CardBody>
        </Card>
      )}

      {rocCurve && (
        <Card>
          <CardBody>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">ROC curve (binary)</h2>
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(55 62 74 / 50%)" />
                <XAxis dataKey="fpr" type="number" domain={[0, 1]} name="false positive rate" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => v.toFixed(1)} />
                <YAxis dataKey="tpr" type="number" domain={[0, 1]} name="true positive rate" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => v.toFixed(1)} />
                <RTooltip contentStyle={{ background: 'rgb(21 24 29)', border: '1px solid rgb(61 69 82)', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => fmtNumber(v, 3)} />
                <Scatter data={rocCurve} line stroke={CHART_PALETTE[0]} strokeWidth={2} fill={CHART_PALETTE[0]} fillOpacity={0.4} />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-2xs text-txt-dim mt-1">AUC = {numOf(metrics.roc_auc) != null ? fmtNumber(metrics.roc_auc, 3) : 'unavailable'} — 0.5 is coin-flip, 1.0 is perfect.</p>
          </CardBody>
        </Card>
      )}

      {prCurve && (
        <Card>
          <CardBody>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Precision–recall curve (binary)</h2>
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(55 62 74 / 50%)" />
                <XAxis dataKey="recall" type="number" domain={[0, 1]} name="recall" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => v.toFixed(1)} />
                <YAxis dataKey="precision" type="number" domain={[0, 1]} name="precision" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => v.toFixed(1)} />
                <RTooltip contentStyle={{ background: 'rgb(21 24 29)', border: '1px solid rgb(61 69 82)', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => fmtNumber(v, 3)} />
                <Scatter data={prCurve} line stroke={CHART_PALETTE[1]} strokeWidth={2} fill={CHART_PALETTE[1]} fillOpacity={0.4} />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-2xs text-txt-dim mt-1">Higher and flatter toward the top-right is better when classes are imbalanced.</p>
          </CardBody>
        </Card>
      )}

      {report.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Per-class report</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-2xs">
                <thead>
                  <tr className="border-b border-ink-700 text-txt-dim text-left">
                    <th className="px-2 py-1.5 font-semibold">class</th>
                    <th className="px-2 py-1.5 font-semibold">precision</th>
                    <th className="px-2 py-1.5 font-semibold">recall</th>
                    <th className="px-2 py-1.5 font-semibold">f1-score</th>
                    <th className="px-2 py-1.5 font-semibold">support</th>
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.class} className="border-b border-ink-800">
                      <td className="px-2 py-1.5 font-mono">{r.class}</td>
                      <td className="px-2 py-1.5 tnum">{fmtNumber(r.precision, 3)}</td>
                      <td className="px-2 py-1.5 tnum">{fmtNumber(r.recall, 3)}</td>
                      <td className="px-2 py-1.5 tnum">{fmtNumber(r.f1, 3)}</td>
                      <td className="px-2 py-1.5 tnum">{r.support}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* ---------- regression ---------- */

export function RegressionEval({ metrics }: { metrics: Record<string, any> | null }) {
  if (!metrics || (metrics.mae == null && metrics.r2 == null)) return <EvaluateEmpty />;
  // Engine shape: sampled arrays actual[] and predicted[] (same length).
  const actual: number[] | null = Array.isArray(metrics.actual) ? metrics.actual : null;
  const predicted: number[] | null = Array.isArray(metrics.predicted) ? metrics.predicted : null;
  const pairs = actual && predicted && actual.length === predicted.length ? actual.map((x, i) => ({ x, y: predicted[i] })) : null;

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card>
        <CardBody>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Hold-out metrics</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Metric label="MAE" v={numOf(metrics.mae)} hint="mean absolute error" />
            <Metric label="MSE" v={numOf(metrics.mse)} />
            <Metric label="RMSE" v={numOf(metrics.rmse)} />
            <Metric label="R²" v={numOf(metrics.r2)} hint="variance explained (1.0 perfect, ≤0 worse than the mean)" />
            <Metric label="Residual mean" v={numOf(metrics.residual_mean)} hint="should sit near 0" />
            <Metric label="Residual std" v={numOf(metrics.residual_std)} hint="typical miss size" />
          </div>
        </CardBody>
      </Card>

      {pairs && (
        <Card>
          <CardBody>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Actual vs predicted</h2>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 6, right: 10, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(55 62 74 / 50%)" />
                <XAxis dataKey="x" type="number" name="actual" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => fmtNumber(v, 1)} />
                <YAxis dataKey="y" type="number" name="predicted" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => fmtNumber(v, 1)} />
                <RTooltip
                  contentStyle={{ background: 'rgb(21 24 29)', border: '1px solid rgb(61 69 82)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, n: string) => [fmtNumber(v, 3), n === 'x' ? 'actual' : 'predicted']}
                />
                <Scatter data={pairs} fill={CHART_PALETTE[0]} fillOpacity={0.75} />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-2xs text-txt-dim mt-1">Dots on the diagonal would be perfect predictions.</p>
          </CardBody>
        </Card>
      )}

      {pairs && (
        <Card>
          <CardBody className="lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Residuals (actual − predicted)</h2>
            <ResponsiveContainer width="100%" height={180}>
              <ScatterChart margin={{ top: 6, right: 10, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(55 62 74 / 50%)" />
                <XAxis dataKey="x" type="number" name="actual" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => fmtNumber(v, 1)} />
                <YAxis dataKey="y" type="number" name="residual" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => fmtNumber(v, 1)} />
                <RTooltip contentStyle={{ background: 'rgb(21 24 29)', border: '1px solid rgb(61 69 82)', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => fmtNumber(v, 3)} />
                <Scatter data={pairs.map((p) => ({ x: p.x, y: p.x - p.y }))} fill={CHART_PALETTE[3]} fillOpacity={0.75} />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-2xs text-txt-dim mt-1">Residuals scattered evenly around zero indicate a well-behaved fit; curved or funnel-shaped patterns suggest the model is missing structure.</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* ---------- clustering ---------- */

export function ClusteringEval({ metrics, nClusters }: { metrics: Record<string, any> | null; nClusters: number | null }) {
  if (!metrics) return <EvaluateEmpty />;
  // Engine shape: cluster_sizes: [{cluster, count}], points: [{x,y,cluster}],
  // n_clusters, noise_count, silhouette, inertia (kmeans), pca_explained_variance.
  const sizes: { cluster: string; count: number }[] | null = Array.isArray(metrics.cluster_sizes) ? metrics.cluster_sizes : null;
  const counts: number[] | null = sizes ? sizes.map((s) => s.count) : null;
  const points: { x: number; y: number; cluster: string }[] | null = Array.isArray(metrics.points) ? metrics.points : null;

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card>
        <CardBody>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Cluster quality</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Metric label="Silhouette" v={numOf(metrics.silhouette)} hint={metrics.silhouette == null ? 'needs ≥ 2 labelled groups of ≥ 2 points' : '−1 … 1'} />
            <Metric label="Groups found" v={numOf(metrics.n_clusters) ?? nClusters} digits={0} />
            <Metric label="Inertia (K-Means)" v={numOf(metrics.inertia)} digits={1} hint="within-cluster sum of squares" />
            {counts && (
              <>
                <Metric label="Largest group" v={Math.max(...counts)} digits={0} />
                <Metric label="Smallest group" v={Math.min(...counts)} digits={0} />
              </>
            )}
            {metrics.noise_count != null && (
              <Metric label="Noise points" v={metrics.noise_count} digits={0} hint={metrics.noise_count > 0 ? 'DBSCAN flags these as not part of any group' : undefined} />
            )}
          </div>
        </CardBody>
      </Card>

      {sizes && (
        <Card>
          <CardBody>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Cluster sizes</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sizes.map((s) => ({ name: s.cluster === '-1' ? 'noise' : `G${s.cluster}`, count: s.count }))} margin={{ top: 4, right: 6, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(55 62 74 / 50%)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" />
                <YAxis tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" />
                <RTooltip contentStyle={{ background: 'rgb(21 24 29)', border: '1px solid rgb(61 69 82)', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {sizes.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {points && points.length > 0 && (
        <Card>
          <CardBody className="lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim mb-2">Cluster map (2-D projection)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 6, right: 10, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(55 62 74 / 50%)" />
                <XAxis dataKey="x" type="number" name="d1" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => fmtNumber(v, 1)} />
                <YAxis dataKey="y" type="number" name="d2" tick={{ fontSize: 10, fill: 'currentColor' }} stroke="rgb(90 100 115)" tickFormatter={(v: number) => fmtNumber(v, 1)} />
                <RTooltip
                  contentStyle={{ background: 'rgb(21 24 29)', border: '1px solid rgb(61 69 82)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, n: string) => [fmtNumber(v, 3), n === 'd1' ? 'projection axis 1' : 'projection axis 2']}
                />
                {[-1, ...new Set(points.map((p) => p.cluster).filter((c) => c !== '-1'))].map((group) => (
                  <Scatter
                    key={String(group)}
                    name={group === -1 ? 'noise' : `Group ${group}`}
                    data={points.filter((p) => p.cluster === String(group)).map((p) => ({ x: p.x, y: p.y }))}
                    fill={group === -1 ? 'rgb(120 128 140)' : CHART_PALETTE[Number(group) % CHART_PALETTE.length]}
                    fillOpacity={0.7}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-2xs text-txt-dim mt-1">
              Each point is one record projected to two dimensions from the feature space. Colour = assigned group (noise points are labelled separately).
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* ---------- shared ---------- */

function EvaluateEmpty() {
  return (
    <Card>
      <CardBody>
        <EmptyState
          icon={<BarChart2 size={24} className="text-txt-dim" />}
          title="No evaluation data"
          body="This model was saved without held-out metrics. Train a new model with a test split to get evaluation charts."
          size="md"
        />
      </CardBody>
    </Card>
  );
}

function Metric({ label, v, hint, digits }: { label: string; v: number | null; hint?: string; digits?: number }) {
  return (
    <div>
      <p className="text-txt-dim text-2xs">
        {label}
        {hint && <span className="text-txt-dim/60 font-normal"> ({hint})</span>}
      </p>
      <p className={`font-semibold mt-0.5 ${v == null ? '' : 'tnum'}`}>{v != null ? fmtNumber(v, digits ?? (Math.abs(v) > 2 ? 2 : 4)) : 'unavailable'}</p>
    </div>
  );
}

function numOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function macroOf(report: Record<string, Record<string, number>> | null, key: string): number | null {
  if (!report) return null;
  const parts: number[] = [];
  const s: number[] = [];
  for (const [k, v] of Object.entries(report)) {
    if (['accuracy', 'macro avg', 'weighted avg'].includes(k)) continue;
    if (v[key] != null) { parts.push(v[key]); s.push(v.support ?? 1); }
  }
  if (parts.length === 0) return null;
  return (parts as number[]).reduce((a, b) => a + b, 0) / (parts as number[]).length;
}
function wAvgOf(report: Record<string, Record<string, number>> | null, key: string): number | null {
  if (!report) return null;
  let num = 0, den = 0;
  for (const [k, v] of Object.entries(report)) {
    if (['accuracy', 'macro avg', 'weighted avg'].includes(k)) continue;
    if (v[key] != null) { num += v[key] * (v.support ?? 1); den += v.support ?? 1; }
  }
  return den > 0 ? num / den : null;
}

