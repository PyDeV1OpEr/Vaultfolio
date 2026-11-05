"""Clustering (unsupervised) training + evaluation.

K-Means: inertia, silhouette, PCA-2D projection for the scatter view and
cluster-centre distances for predictions. DBSCAN: eps/min_samples, cluster
sizes, silhouette only when there are at least two non-noise clusters, and
the noise fraction is reported honestly.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN, KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score

from .__init__ import __version__
from .csvio import EngineError
from .training import save_bundle
from .training import TrainSpec, build_pipeline, numeric_categorical_split

BUNDLE_VERSION = 2


def make_clusterer(name: str, spec: TrainSpec):
    if name == "kmeans":
        return KMeans(n_clusters=max(2, spec.n_clusters), random_state=spec.random_state, n_init=10)
    if name == "dbscan":
        eps = spec.dbscan_eps if spec.dbscan_eps and spec.dbscan_eps > 0 else None
        if eps is None:
            raise EngineError("DBSCAN needs an eps neighbourhood size.")
        return DBSCAN(eps=eps, min_samples=spec.dbscan_min_samples)
    raise EngineError(f"Unknown clustering algorithm: {name}")


def cluster_metrics(pipe: Pipeline, X_eval, algo: str, spec: TrainSpec) -> Dict[str, Any]:
    """Evaluate a fitted clustering pipeline on its dataset."""
    model = pipe.named_steps["model"]
    labels = np.asarray(model.labels_)
    metrics: Dict[str, Any] = {"algorithm": algo}
    sizes = pd.Series(labels).value_counts().sort_index()
    metrics["cluster_sizes"] = [
        {"cluster": str(int(c)), "count": int(cnt)} for c, cnt in sizes.items()
    ]
    unique = sorted({int(u) for u in np.unique(labels)})
    valid = [u for u in unique if u != -1]
    metrics["n_clusters"] = len(valid)
    metrics["noise_count"] = int((labels == -1).sum())
    metrics["silhouette"] = None

    non_noise = labels != -1
    nn = non_noise.sum()
    counts_nn = pd.Series(labels[non_noise]).value_counts() if nn else pd.Series(dtype=int)
    if len(valid) >= 2 and nn >= len(valid) + 1 and counts_nn.min() >= 2:
        try:
            X_dense = _densify(X_eval)
            if X_dense is not None:
                metrics["silhouette"] = float(
                    silhouette_score(
                        X_dense[non_noise], labels[non_noise],
                        sample_size=min(5000, int(nn)), random_state=spec.random_state,
                    )
                )
        except Exception:
            metrics["silhouette"] = None

    if algo == "kmeans" and hasattr(model, "inertia_"):
        metrics["inertia"] = float(model.inertia_)

    try:
        X_dense = _densify(X_eval)
        if X_dense is not None and X_dense.shape[1] > 2:
            pca = PCA(n_components=2, random_state=spec.random_state)
            coords = pca.fit_transform(np.nan_to_num(X_dense))
            metrics["pca_explained_variance"] = [
                float(x) for x in pca.explained_variance_ratio_[:2]
            ]
        else:
            coords = X_dense if X_dense is not None else np.zeros((len(labels), 2))
        sample_idx = np.linspace(0, len(coords) - 1, min(3000, len(coords))).astype(int)
        metrics["points"] = [
            {"x": float(coords[i][0]), "y": float(coords[i][1]), "cluster": str(int(labels[i]))}
            for i in sample_idx
        ]
    except Exception:
        metrics["points"] = []
    return metrics


def _densify(X_eval):
    if hasattr(X_eval, "toarray"):
        if X_eval.nnz > 4_000_000:
            return None
        return X_eval.toarray()
    return np.asarray(X_eval)


def fit_clustering(df: pd.DataFrame, spec: TrainSpec, save_path: str, meta: Dict[str, Any]) -> Dict[str, Any]:
    """Train the requested clustering algorithms on the full dataset."""
    from .training import build_pipeline, save_bundle

    features = list(spec.features)
    if not features:
        raise EngineError("Select at least one feature column for clustering.")
    if spec.target and spec.target in features:
        raise EngineError("The target column must not be selected as a feature.")

    work, parts = numeric_categorical_split(df, features)
    n_rows = len(work)
    if n_rows < 10:
        raise EngineError("Clustering needs at least 10 rows.")
    if spec.algorithms and "kmeans" in spec.algorithms and spec.n_clusters > n_rows:
        raise EngineError(f"Cannot form {spec.n_clusters} clusters from only {n_rows} rows.")

    results: List[Dict[str, Any]] = []
    best_name: Optional[str] = None
    best_score: Optional[float] = None
    fitted_pipes: Dict[str, Pipeline] = {}

    for algo in (spec.algorithms or ["kmeans"]):
        t0 = time.time()
        pipe = build_pipeline(algo, "clustering", parts["numeric"], parts["categorical"], parts["datetime"], n_rows, spec.random_state, scale_numeric=False, n_clusters=spec.n_clusters, dbscan_eps=spec.dbscan_eps, dbscan_min_samples=spec.dbscan_min_samples)
        pipe.fit(work[features])
        duration = round(time.time() - t0, 3)
        fitted_pipes[algo] = pipe
        X_eval = pipe.named_steps["preprocess"].transform(work[features])
        m = cluster_metrics(pipe, X_eval, algo, spec)
        m["duration_seconds"] = duration
        results.append({"algorithm": algo, "label": ALGO_LABELS[algo], "metrics": m})
        if m["silhouette"] is not None and (best_score is None or m["silhouette"] > best_score):
            best_score, best_name = m["silhouette"], algo

    if best_name is None:
        best_name = results[0]["algorithm"]

    best_pipe = fitted_pipes[best_name]
    bundle = {
        "bundle_version": BUNDLE_VERSION,
        "engine_version": __version__,
        "task": "clustering",
        "algorithm": best_name,
        "features": features,
        "pipeline": best_pipe,
        "spec": {
            "n_clusters": spec.n_clusters,
            "dbscan_eps": spec.dbscan_eps,
            "dbscan_min_samples": spec.dbscan_min_samples,
        },
        "meta": meta,
    }
    sha = save_bundle(save_path, bundle)
    return {
        "comparison": results,
        "selected": best_name,
        "selected_metrics": next(r["metrics"] for r in results if r["algorithm"] == best_name),
        "sha256": sha,
    }


ALGO_LABELS = {"kmeans": "K-Means", "dbscan": "DBSCAN"}
