"""Supervised training orchestrator (classification + regression).

Trains one or more algorithms on the same split, evaluates every candidate
on the held-out test set only, and saves the best (or requested) model as a
versioned joblib bundle that includes the full preprocessing pipeline.
"""

from __future__ import annotations

import time
import warnings
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .__init__ import __version__
from .csvio import EngineError, normalize_blank_strings
from .training import (
    ALGORITHM_LABELS,
    BUNDLE_VERSION,
    DEFAULT_COMPARE_SETS,
    build_pipeline,
    classification_metrics,
    load_bundle,
    numeric_categorical_split,
    prepare_supervised,
    regression_metrics,
    save_bundle,
    split_frame,
    TrainSpec,
)


def train_supervised(
    df: pd.DataFrame,
    spec: TrainSpec,
    save_path: str,
    meta: Dict[str, Any],
) -> Dict[str, Any]:
    X, y, features = prepare_supervised(df, spec)
    n_rows = len(X)

    if spec.task == "classification":
        classes = sorted(pd.unique(y.astype(str)).tolist())
        if len(classes) < 2:
            raise EngineError(
                "The target column needs at least two distinct classes for classification."
            )
    else:
        y_num = pd.to_numeric(y, errors="coerce")
        if y_num.isna().any():
            raise EngineError(
                "The target column contains non-numeric values; regression needs a numeric target."
            )
        y = y_num.reset_index(drop=True)
    if n_rows < 20:
        raise EngineError(
            f"Only {n_rows} usable rows after cleaning. Training needs at least 20 rows to make a meaningful train/test split."
        )

    X_train, X_test, y_train, y_test = split_frame(X, y, spec)
    _, parts = numeric_categorical_split(X, features)
    numeric, categorical, datetime_cols = parts["numeric"], parts["categorical"], parts["datetime"]
    if not (numeric or categorical or datetime_cols):
        raise EngineError("None of the selected features are usable for training.")

    requested = spec.algorithms or DEFAULT_COMPARE_SETS[spec.task]
    invalid = [a for a in requested if a not in ALGORITHM_LABELS]
    if invalid:
        raise EngineError(f"Unsupported algorithm requested: {', '.join(invalid)}")

    comparison: List[Dict[str, Any]] = []
    fitted: Dict[str, Any] = {}

    for algo in requested:
        t0 = time.time()
        pipe = build_pipeline(
            algo, spec.task, numeric, categorical, datetime_cols, n_rows, spec.random_state,
            scale_numeric=(spec.task != "regression" or algo in ("linear_regression", "ridge", "linear_svc")),
        )
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                pipe.fit(X_train, y_train)
        except (ValueError, TypeError) as exc:
            comparison.append({
                "algorithm": algo,
                "label": ALGORITHM_LABELS[algo],
                "error": f"Could not train: {str(exc)[:280]}",
                "duration_seconds": round(time.time() - t0, 3),
                "saved": False,
            })
            continue
        duration = round(time.time() - t0, 3)
        fitted[algo] = pipe

        # ── evaluation: held-out test set only ─────────────────────────────
        y_pred = pipe.predict(X_test)
        proba = pipe.predict_proba(X_test) if hasattr(pipe, "predict_proba") and spec.task == "classification" else None
        if spec.task == "classification":
            metrics = classification_metrics(y_test, y_pred, proba, classes)
            score = metrics["f1_macro"]
        else:
            metrics = regression_metrics(y_test, y_pred)
            metrics["max_error"] = None
            from sklearn.metrics import max_error
            try:
                metrics["max_error"] = float(max_error(y_test, y_pred))
            except Exception:
                pass
            score = metrics["r2"]
        comparison.append({
            "algorithm": algo,
            "label": ALGORITHM_LABELS[algo],
            "duration_seconds": duration,
            "score": None if score is None else float(score),
            "metrics": metrics,
            "saved": False,
            "error": None,
        })

    trained = [c for c in comparison if c.get("error") is None]
    if not trained:
        raise EngineError("No algorithm could train on this dataset selection. Check the feature/target configuration.")

    if spec.task == "classification":
        best_key = "score"
        best = max(trained, key=lambda c: c["score"] or 0.0)
    else:
        best = max(trained, key=lambda c: c["score"] if c["score"] is not None else -1e18)

    best_pipeline = fitted[best["algorithm"]]
    y_pred_best = best_pipeline.predict(X_test)
    from sklearn.metrics import mean_absolute_error
    resid_std = None
    if spec.task == "regression":
        resid_std = float(np.std(np.asarray(y_test, dtype=float) - np.asarray(y_pred_best, dtype=float)))

    # Feature names for the transform output (debugging / prediction schema).
    sha = save_bundle(save_path, {
        "bundle_version": BUNDLE_VERSION,
        "engine_version": __version__,
        "task": spec.task,
        "algorithm": best["algorithm"],
        "features": features,
        "target": spec.target,
        "model_classes": classes if spec.task == "classification" else None,
        "pipeline": best_pipeline,
        "meta": meta,
        "metrics": {
            "test_score": best["score"],
            "residual_std": resid_std,
        },
    })

    return {
        "comparison": [
            {**c, "metrics": _slim(c["metrics"] if c.get("metrics") else None)} for c in comparison
        ],
        "selected": best["algorithm"],
        "selected_metrics": best["metrics"],
        "row_count": int(n_rows),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "classes": classes if spec.task == "classification" else None,
        "residual_std": resid_std,
        "sha256": sha,
        "bundle_version": BUNDLE_VERSION,
        "engine_version": __version__,
    }


def _slim(metrics: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Trim chart-heavy arrays out of per-comparison metrics (best model keeps everything)."""
    if not metrics:
        return None
    slim = {k: v for k, v in metrics.items()}
    for key in ("y_true", "y_pred", "actual", "predicted", "roc_curve", "pr_curve"):
        slim.pop(key, None)
    slim["confusion_matrix"] = metrics.get("confusion_matrix")
    return slim
