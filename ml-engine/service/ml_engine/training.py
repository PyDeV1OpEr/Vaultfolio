"""Training, evaluation, and model persistence for the local ML engine.

Every model is saved as a scikit-learn Pipeline wrapped in a versioned
bundle joblib file, so the exact preprocessing used during training travels
with the model and is reused verbatim at prediction time. Evaluation is
always computed on a held-out test split — training scores are never shown
as test scores.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple  # noqa: F401 (Optional used below)

import numpy as np
import pandas as pd
from joblib import dump, load
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.decomposition import PCA
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge, LinearRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    silhouette_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

from . import __version__
from .csvio import EngineError, load_csv, normalize_blank_strings

BUNDLE_VERSION = 2

# ─────────────────────────────────────────────────────────────────────────────
# Registry of supported, implemented algorithms. The UI renders exactly these.
# ─────────────────────────────────────────────────────────────────────────────

CLASSIFIERS: Dict[str, Tuple[type, bool]] = {
    # name -> (estimator factory key, needs_scaling, supports_proba)
    "logistic_regression": (LogisticRegression, True),
    "random_forest_classifier": (RandomForestClassifier, False),
    "decision_tree_classifier": (DecisionTreeClassifier, False),
    "gradient_boosting_classifier": (GradientBoostingClassifier, False),
    "linear_svc": (None, True),  # handled specially (probability calibration)
}

REGRESSORS: Dict[str, Tuple[type, bool]] = {
    "linear_regression": (LinearRegression, True),
    "ridge": (Ridge, True),
    "random_forest_regressor": (RandomForestRegressor, False),
    "decision_tree_regressor": (DecisionTreeRegressor, False),
    "gradient_boosting_regressor": (GradientBoostingRegressor, False),
}

ALGORITHM_LABELS: Dict[str, str] = {
    "logistic_regression": "Logistic Regression",
    "random_forest_classifier": "Random Forest",
    "decision_tree_classifier": "Decision Tree",
    "gradient_boosting_classifier": "Gradient Boosting",
    "linear_svc": "Linear SVC",
    "linear_regression": "Linear Regression",
    "ridge": "Ridge Regression",
    "random_forest_regressor": "Random Forest Regressor",
    "decision_tree_regressor": "Decision Tree Regressor",
    "gradient_boosting_regressor": "Gradient Boosting Regressor",
    "kmeans": "K-Means",
    "dbscan": "DBSCAN",
}

DEFAULT_COMPARE_SETS: Dict[str, List[str]] = {
    "classification": ["logistic_regression", "random_forest_classifier", "decision_tree_classifier", "gradient_boosting_classifier"],
    "regression": ["linear_regression", "ridge", "random_forest_regressor", "decision_tree_regressor", "gradient_boosting_regressor"],
    "clustering": ["kmeans", "dbscan"],
}


class DateToNumeric(BaseEstimator, TransformerMixin):
    """Convert datetime series (DataFrame-compatible) to epoch seconds.

    Pickled together with the model so the exact same conversion runs at
    prediction time.
    """

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        X = X.copy()
        for col in X.columns:
            converted = pd.to_datetime(X[col], errors="coerce")
            if converted.notna().any():
                origin = converted.min()
                X[col] = (converted - origin).dt.total_seconds()
            else:
                X[col] = pd.to_numeric(X[col], errors="coerce")
        return X


@dataclass
class TrainSpec:
    task: str  # classification | regression | clustering
    target: Optional[str]
    features: List[str]
    test_size: float
    random_state: int
    algorithms: List[str]
    # clustering hyperparameters
    n_clusters: int = 3
    dbscan_eps: Optional[float] = None
    dbscan_min_samples: int = 5


def resolve_row_cap(n_rows: int) -> Dict[str, Any]:
    """Performance guard rails; RF/SVC tree sizes scale badly on huge data."""
    return {
        "n_estimators": 200 if n_rows < 200_000 else 60,
        "max_depth": None if n_rows < 200_000 else 24,
        "svc_calibratable": n_rows <= 5_000,
    }


def make_estimator(name: str, task: str, n_rows: int, random_state: int, n_features: int):
    caps = resolve_row_cap(n_rows)
    if task == "classification":
        if name == "logistic_regression":
            return LogisticRegression(max_iter=1000, random_state=random_state)
        if name == "random_forest_classifier":
            return RandomForestClassifier(
                n_estimators=caps["n_estimators"], max_depth=caps["max_depth"],
                n_jobs=1, random_state=random_state,
            )
        if name == "decision_tree_classifier":
            return DecisionTreeClassifier(max_depth=caps["max_depth"], random_state=random_state)
        if name == "gradient_boosting_classifier":
            return GradientBoostingClassifier(random_state=random_state)
        if name == "linear_svc":
            from sklearn.svm import LinearSVC
            from sklearn.calibration import CalibratedClassifierCV
            # Calibrated (sigmoid) wrapper gives meaningful probabilities;
            # only used when the caller deems the dataset small enough.
            base = LinearSVC(max_iter=5000, random_state=random_state)
            return CalibratedClassifierCV(base, cv=3, method="sigmoid")
        raise EngineError(f"Unknown classification algorithm: {name}")
    if task == "regression":
        if name == "linear_regression":
            return LinearRegression()
        if name == "ridge":
            return Ridge(alpha=1.0, random_state=random_state)
        if name == "random_forest_regressor":
            return RandomForestRegressor(
                n_estimators=caps["n_estimators"], max_depth=caps["max_depth"],
                n_jobs=1, random_state=random_state,
            )
        if name == "decision_tree_regressor":
            return DecisionTreeRegressor(max_depth=caps["max_depth"], random_state=random_state)
        if name == "gradient_boosting_regressor":
            return GradientBoostingRegressor(random_state=random_state)
        raise EngineError(f"Unknown regression algorithm: {name}")
    raise EngineError(f"Algorithm {name} is not applicable to task {task}")


def build_pipeline(
    name: str,
    task: str,
    numeric: Sequence[str],
    categorical: Sequence[str],
    datetime_cols: Sequence[str],
    n_rows: int,
    random_state: int,
    scale_numeric: bool,
    n_clusters: int = 3,
    dbscan_eps: Optional[float] = None,
    dbscan_min_samples: int = 5,
) -> Pipeline:
    """ColumnTransformer + estimator, saved as one Pipeline for consistency."""
    numeric_pipeline: List[Tuple[str, Any]] = [("impute", SimpleImputer(strategy="median"))]
    if scale_numeric and numeric:
        numeric_pipeline.append(("scale", StandardScaler()))
    categorical_pipeline = [
        ("impute", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=True)),
    ]
    transformers: List[Tuple[str, Any, List[str]]] = []
    if numeric:
        transformers.append(("numeric", Pipeline(numeric_pipeline), list(numeric)))
    if categorical:
        transformers.append(("categorical", Pipeline(categorical_pipeline), list(categorical)))
    if datetime_cols:
        transformers.append(("datetime", Pipeline([("to_epoch", DateToNumeric()), ("impute", SimpleImputer(strategy="median"))]), list(datetime_cols)))
    if not transformers:
        raise EngineError("No usable feature columns were selected for training.")
    preprocessor = ColumnTransformer(transformers=transformers, remainder="drop", sparse_threshold=1.0)
    if task == "clustering":
        from .clustering import make_clusterer
        estimator = make_clusterer(name, TrainSpec(task=task, target=None, features=[], test_size=0, random_state=random_state, algorithms=[name], n_clusters=n_clusters, dbscan_eps=dbscan_eps, dbscan_min_samples=dbscan_min_samples))
    else:
        estimator = make_estimator(name, task, n_rows, random_state, len(numeric) + len(categorical) + len(datetime_cols))
    return Pipeline([("preprocess", preprocessor), ("model", estimator)])


def prepare_supervised(df: pd.DataFrame, spec: TrainSpec) -> Tuple[pd.DataFrame, pd.Series, List[str]]:
    features = list(spec.features)
    if spec.target in features:
        raise EngineError("Target leakage detected: the target column must not be selected as a feature.")
    if spec.target not in df.columns:
        raise EngineError(f"Target column '{spec.target}' was not found in the dataset.")
    for f in features:
        if f not in df.columns:
            raise EngineError(f"Feature column '{f}' was not found in the dataset.")
    if not features:
        raise EngineError("Select at least one feature column.")
    work = normalize_blank_strings(df[[*features, spec.target]].copy())
    # Split the raw columns by inferred type (re-derived on the working frame).
    m = work[spec.target].isna()
    dropped = int(m.sum())
    if dropped:
        work = work[~m]
    y = work[spec.target].reset_index(drop=True)
    X = work[features].reset_index(drop=True)
    return X, y, features


def split_frame(X: pd.DataFrame, y: pd.Series, spec: TrainSpec):
    stratify = None
    if spec.task == "classification":
        counts = y.value_counts(dropna=False)
        # stratify requires >= 2 members of every class in the test split
        if counts.min() >= int(np.ceil(2 / max(spec.test_size, 0.01))) and counts.size > 1:
            stratify = y
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=max(0.1, min(0.5, spec.test_size)), random_state=spec.random_state, stratify=stratify
    )
    return X_train, X_test, y_train, y_test


def numeric_categorical_split(df: pd.DataFrame, features: Sequence[str], target: Optional[str] = None):
    work = df[list(features) + ([target] if target and target in df.columns else [])]
    work = normalize_blank_strings(work)
    parts = {"numeric": [], "categorical": [], "datetime": []}
    for f in features:
        s = work[f]
        non_null = s.dropna()
        if non_null.dtype.kind in ("M",):
            parts["datetime"].append(f)
            continue
        num = pd.to_numeric(non_null, errors="coerce")
        if not non_null.empty and num.notna().mean() >= 0.95:
            parts["numeric"].append(f)
        elif non_null.astype(str).str.strip().str.lower().isin(("true", "false", "yes", "no", "t", "f", "y", "n")).all() and non_null.dtype == object:
            parts["categorical"].append(f)
        else:
            parts["categorical"].append(f)
    return work, parts


def classification_metrics(y_test, y_pred, proba, classes) -> Dict[str, Any]:
    present_classes = list(classes) if classes is not None else sorted(set(y_test) | set(y_pred))
    labels = list(present_classes)
    cm = confusion_matrix(y_test, y_pred, labels=labels)
    report_rows = []
    from sklearn.metrics import classification_report
    if len(labels) >= 2:
        rep = classification_report(y_test, y_pred, labels=labels, output_dict=True, zero_division=0)
        for label in labels:
            r = rep.get(str(label)) or rep.get(label)
            if r:
                report_rows.append({
                    "class": str(label),
                    "precision": float(r["precision"]),
                    "recall": float(r["recall"]),
                    "f1": float(r["f1-score"]),
                    "support": int(r["support"]),
                })
    out: Dict[str, Any] = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision_macro": float(precision_score(y_test, y_pred, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_test, y_pred, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
        "confusion_matrix": cm.tolist(),
        "confusion_labels": [str(x) for x in labels],
        "classification_report": report_rows,
        "roc_auc": None,
        "roc_curve": None,
        "pr_curve": None,
        "y_true": [str(v) for v in y_test[:2000]],
        "y_pred": [str(v) for v in y_pred[:2000]],
    }
    if len(labels) == 2 and proba is not None:
        from sklearn.metrics import precision_recall_curve, roc_auc_score, roc_curve
        pos = str(classes[classes.index(max(classes))] if hasattr(classes, "index") else max(present_classes))
        try:
            pos_label = present_classes[1]
            pos_index = present_classes.index(pos_label)
            probs_pos = np.asarray(proba)[:, pos_index] if np.asarray(proba).ndim == 2 else np.asarray(proba)
            auc = float(roc_auc_score(y_test == pos_label, probs_pos))
            out["roc_auc"] = auc
            fpr, tpr, _ = roc_curve(y_test == pos_label, probs_pos)
            idx = np.linspace(0, len(fpr) - 1, min(300, len(fpr))).astype(int)
            out["roc_curve"] = [
                {"fpr": float(fpr[i]), "tpr": float(tpr[i])} for i in idx
            ]
            p, r, _ = precision_recall_curve(y_test == pos_label, probs_pos)
            idx = np.linspace(0, len(p) - 1, min(300, len(p))).astype(int)
            out["pr_curve"] = [{"precision": float(p[i]), "recall": float(r[i])} for i in idx]
        except Exception:
            out["roc_auc"] = None
    elif len(labels) > 2 and proba is not None:
        from sklearn.metrics import roc_auc_score
        try:
            y_enc = np.array([present_classes.index(str(v)) for v in y_test])
            out["roc_auc"] = float(
                roc_auc_score(y_enc, proba, multi_class="ovr", average="macro", labels=range(len(present_classes)))
            )
        except Exception:
            out["roc_auc"] = None
    return out


def regression_metrics(y_test, y_pred) -> Dict[str, Any]:
    mse = float(mean_squared_error(y_test, y_pred))
    y_test_a = np.asarray(y_test, dtype=float)
    y_pred_a = np.asarray(y_pred, dtype=float)
    residual = y_test_a - y_pred_a
    sample = min(len(y_test_a), 2000)
    idx = np.linspace(0, len(y_test_a) - 1, sample).astype(int)
    return {
        "mae": float(mean_absolute_error(y_test, y_pred)),
        "mse": mse,
        "rmse": float(np.sqrt(mse)),
        "r2": float(r2_score(y_test, y_pred)),
        "residual_mean": float(np.mean(residual)),
        "residual_std": float(np.std(residual)),
        "actual": [_jsonify(v) for v in y_test_a[idx]],
        "predicted": [_jsonify(v) for v in y_pred_a[idx]],
    }


def _jsonify(v: Any) -> Any:
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if np.isnan(f) else f
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


def save_bundle(path: str, bundle: Dict[str, Any]) -> str:
    """Persist the bundle atomically; returns the SHA-256 of the written file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    dump(bundle, tmp)
    os.replace(tmp, path)
    return sha256_file(path)


def sha256_file(path: str) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def load_bundle(path: str, expected_sha256: Optional[str] = None) -> Dict[str, Any]:
    """Load a model bundle we wrote earlier.

    Pickle-based formats execute code on load, so integrity must be proven:
    the caller (Rust, from SQLite) supplies the SHA-256 recorded at save time
    and a mismatched file is refused. Models from outside the app's own model
    store do not have a recorded hash and are treated as untrusted: the UI
    must show an explicit warning before a user chooses to try them.
    """
    if not os.path.exists(path):
        raise EngineError("Model file is missing on disk.")
    if expected_sha256:
        actual = sha256_file(path)
        if actual != expected_sha256:
            raise EngineError(
                "This model file does not match the checksum recorded when it "
                "was saved. It may have been modified — refusing to load it."
            )
    return load(path)
