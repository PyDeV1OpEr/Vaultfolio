"""Prediction (inference) for saved classification/regression bundles.

The saved Pipeline carries the exact preprocessing chain, so prediction
always runs the identical transformation path as training. Missing input
columns are a hard error; unknown categorical values are handled by the
OneHotEncoder(handle_unknown='ignore') inside the pipeline.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from .csvio import EngineError, load_csv, normalize_blank_strings, _jsonify
from .training import load_bundle


def _require_features(bundle: Dict[str, Any], source_cols: Sequence[str]):
    features = bundle.get("features") or []
    missing = [f for f in features if f not in source_cols]
    if missing:
        raise EngineError(
            "The input data is missing required feature columns: "
            + ", ".join(missing[:8])
            + ("" if len(missing) <= 8 else f" (+{len(missing) - 8} more)")
        )


def _input_frame(bundle: Dict[str, Any], source: Dict[str, Any]) -> Tuple[pd.DataFrame, List[str], List[str]]:
    st = source.get("type")
    if st == "rows":
        rows = source.get("rows")
        if not rows or not isinstance(rows, list):
            raise EngineError("No input rows were provided.")
        df = pd.DataFrame(rows)
    elif st == "csv":
        path = source.get("path")
        if not path:
            raise EngineError("No input file path was provided.")
        df, _ = load_csv(path, delimiter=source.get("delimiter"), encoding=source.get("encoding"))
        df = normalize_blank_strings(df)
    else:
        raise EngineError("Unsupported prediction source.")
    present = [c for c in df.columns if c in (bundle.get("features") or [])]
    # Keep original column order for the results table (minus target column).
    drop_target = bundle.get("target")
    display_cols = [c for c in df.columns if c != drop_target]
    return df, present, display_cols


def run_prediction(
    model_path: str,
    expected_sha256: Optional[str],
    source: Dict[str, Any],
    model_meta: Dict[str, Any],
) -> Dict[str, Any]:
    bundle = load_bundle(model_path, expected_sha256)
    task = bundle["task"]
    df, _, display_cols = _input_frame(bundle, source)
    _require_features(bundle, df.columns.tolist())
    features = bundle["features"]
    X = df[features]

    pipeline = bundle["pipeline"]
    model = pipeline.named_steps["model"]
    preds = pipeline.predict(X)

    out_rows: List[Dict[str, Any]] = []
    confidences: Optional[List[Optional[float]]] = None
    extra_note: Optional[str] = None
    proba_note = None

    if task == "classification":
        classes = list(model.classes_)
        has_proba = hasattr(model, "predict_proba")
        if has_proba:
            proba = pipeline.predict_proba(X)
            confidences = [float(p.max()) for p in proba]
            proba_note = "Confidence = probability of the predicted class."
        else:
            confidences = None
            proba_note = "This model type has no probability output; confidence is unavailable."
        for i, row in df.iterrows():
            rec = {c: _jsonify(row[c]) for c in display_cols}
            rec["_prediction"] = _jsonify(preds[i]) if not hasattr(preds[i], "item") else _jsonify(preds[i])
            if confidences is not None:
                rec["_confidence"] = round(confidences[i], 4)
            out_rows.append(rec)
    elif task == "regression":
        # Honest uncertainty: residual std of the held-out test split, recorded
        # in the bundle at training time. An average-scale estimate, never a
        # per-record interval guarantee.
        resid_std_metric = (bundle.get("metrics") or {}).get("residual_std", None)
        for i, row in df.iterrows():
            rec = {c: _jsonify(row[c]) for c in display_cols}
            p = _jsonify(preds[i])
            rec["_prediction"] = p
            if resid_std_metric is not None:
                rec["_uncertainty"] = f"± {round(float(resid_std_metric), 4)}"
            out_rows.append(rec)
    elif task == "clustering":
        distances: Optional[np.ndarray] = None
        if hasattr(model, "transform"):
            # Distances must be measured in the SAME preprocessed feature
            # space the clusterer was fitted on — never against raw input.
            X_proc = pipeline.named_steps["preprocess"].transform(X)
            distances = np.asarray(model.transform(X_proc))
            extra_note = "Distance = separation from the assigned cluster centre (dissimilarity)."
        elif hasattr(model, "components_"):
            extra_note = "DBSCAN points marked -1 are labelled as noise."
        for i, row in df.iterrows():
            rec = {c: _jsonify(row[c]) for c in display_cols}
            rec["_prediction"] = _jsonify(int(preds[i]))
            if distances is not None:
                rec["_cluster_distance"] = round(float(distances[i][int(preds[i])]), 6)
            out_rows.append(rec)
    else:
        raise EngineError(f"Unsupported model task: {task}")

    results_csv_rows = len(out_rows)
    return {
        "task": task,
        "algorithm": bundle.get("algorithm"),
        "prediction_note": proba_note or extra_note,
        "columns": list(display_cols),
        "rows": out_rows,
        "row_count": results_csv_rows,
        "classes": [str(c) for c in model.classes_] if task == "classification" else None,
    }
