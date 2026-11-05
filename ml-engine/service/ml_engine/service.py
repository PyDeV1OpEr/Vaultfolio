"""NDJSON service loop run by the bundled Python runtime.

Protocol: one JSON object per line on stdin; one JSON object per line on
stdout. Any non-response stdout output is a bug — the loop flushes partial
progress events with the originating request id so the UI can render live
training/ingest progress. Fatal errors produce an error response on the line
instead of crashing the service so one bad request cannot take the engine
down for the rest of the session.
"""

from __future__ import annotations

import os
import platform
import sys
import time
from typing import Any, Dict, Optional

from .__init__ import ENGINE_NAME
from .csvio import EngineError, _jsonify


def _emit(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _versions() -> Dict[str, Any]:
    import joblib
    import numpy as np
    import pandas as pd
    import sklearn

    return {
        "engine": ENGINE_NAME,
        "engine_version": __import__("ml_engine", fromlist=["__version__"]).__version__,
        "python": platform.python_version(),
        "platform": platform.machine(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit-learn": sklearn.__version__,
        "joblib": joblib.__version__,
    }


def handle(cmd: str, args: Dict[str, Any], progress) -> Dict[str, Any]:
    """Dispatch a request; returns the response payload."""
    if cmd == "versions":
        return _versions()

    if cmd == "shutdown":
        return {"bye": True}

    if cmd == "ingest":
        from .csvio import load_csv, normalize_blank_strings, profile_frame, write_canonical_csv

        src = args["src_path"]
        dest = args["dest_path"]
        df, fmt = load_csv(src, delimiter=args.get("delimiter"), encoding=args.get("encoding"))
        original_rows = int(len(df))
        progress("parsing", 25, "Parsing CSV…")
        df = normalize_blank_strings(df)
        progress("profiling", 60, "Inferring column types and statistics…")
        profile = profile_frame(df)
        progress("writing", 85, "Writing normalized UTF-8 dataset copy…")
        rows = write_canonical_csv(df, dest, delimiter=fmt["delimiter"])
        size = os.path.getsize(dest)
        progress("done", 99, "Indexed")
        return {
            "profile": profile,
            "canonical_rows": rows,
            "canonical_bytes": size,
            "original_rows": original_rows,
            "delimiter": fmt["delimiter"],
            "encoding": fmt["encoding"],
        }

    if cmd == "preview":
        from .csvio import load_csv, paginate

        df, _ = load_csv(args["path"], delimiter=args.get("delimiter"))
        col_filter = args.get("columns")
        if col_filter:
            df = df[[c for c in col_filter if c in df.columns]]
        sort_col = args.get("sort")
        if sort_col:
            if sort_col not in df.columns:
                raise EngineError(f"Unknown sort column: {sort_col}")
            ascending = str(args.get("dir", "asc")).lower() != "desc"
            df = df.sort_values(
                sort_col, ascending=ascending, kind="stable", na_position="last"
            )
        search = args.get("search")
        if search:
            mask = _row_search_mask(df, str(search))
            df = df[mask]
        rows, total = paginate(df, int(args.get("page", 1)), min(500, int(args.get("page_size", 50))))
        return {"columns": list(df.columns), "rows": rows, "total": total}

    if cmd == "column_stats":
        from .csvio import load_csv, column_series_stats

        df, _ = load_csv(args["path"], delimiter=args.get("delimiter"))
        col = args["column"]
        if col not in df.columns:
            raise EngineError(f"Unknown column: {col}")
        return column_series_stats(df[col])

    if cmd == "train":
        from .csvio import load_csv, normalize_blank_strings
        from .supervised import train_supervised
        from .clustering import fit_clustering
        from .training import TrainSpec

        task = args["task"]
        spec = TrainSpec(
            task=task,
            target=args.get("target"),
            features=list(args.get("features") or []),
            test_size=float(args.get("test_size", 0.25)),
            random_state=int(args.get("random_state", 42)),
            algorithms=list(args.get("algorithms") or []),
            n_clusters=int(args.get("n_clusters") or 3),
            dbscan_eps=(float(args["dbscan_eps"]) if args.get("dbscan_eps") else None),
            dbscan_min_samples=int(args.get("dbscan_min_samples") or 5),
        )
        if task not in ("classification", "regression", "clustering"):
            raise EngineError(f"Unsupported task: {task}")
        df, _ = load_csv(args["dataset_path"], delimiter=args.get("delimiter"))
        df = normalize_blank_strings(df)
        progress("loading", 10, "Dataset loaded — building pipeline…")
        meta = args.get("meta") or {}
        if task == "clustering":
            result = fit_clustering(df, spec, args["save_path"], meta)
        else:
            result = train_supervised(df, spec, args["save_path"], meta)
        return result

    if cmd == "predict":
        from .inference import run_prediction

        return run_prediction(
            args["model_path"],
            args.get("sha256"),
            args["source"],
            args.get("model_meta") or {},
        )

    if cmd == "unseen_check":
        # Validate that prediction input columns are present before running.
        from .inference import _input_frame, _require_features
        from .training import load_bundle

        bundle = load_bundle(args["model_path"], args.get("sha256"))
        df, _, _ = _input_frame(bundle, args["source"])
        _require_features(bundle, df.columns.tolist())
        return {"ok": True, "columns": list(df.columns), "features": bundle["features"]}

    if cmd == "export_csv":
        # Used by export flows: takes rows (from prediction results stored by
        # the Rust side) and writes them to a validated path.
        import csv

        from .csvio import _jsonify

        rows = args.get("rows") or []
        if not rows or not isinstance(rows, list):
            raise EngineError("Nothing to export.")
        out = args["dest_path"]
        os.makedirs(os.path.dirname(out), exist_ok=True)
        columns = (args.get("columns") or list(rows[0].keys()))
        with open(out, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=columns)
            writer.writeheader()
            for r in rows:
                writer.writerow({c: (r.get(c) if r.get(c) is not None else "") for c in columns})
        return {"path": out, "rows": len(rows)}

    raise EngineError(f"Unknown command: {cmd}")


def _row_search_mask(df, search: str):
    import re

    try:
        pattern = re.compile(re.escape(search), re.IGNORECASE)
    except re.error:
        pattern = re.compile(re.escape(search))
    mask = None
    for col in df.columns:
        s = df[col].astype(str)
        hit = s.str.contains(pattern, na=False)
        mask = hit if mask is None else (mask | hit)
    if mask is None:
        mask = pd.Series(False, index=df.index)
    return mask


def main() -> None:
    """Engines run with `-u -B -m ml_engine.service` from the service dir."""
    import json

    _emit(json.dumps({"type": "ready", **_versions()}))
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            req_id = request.get("id")
            cmd = request.get("cmd")
            args = request.get("args") or {}
        except json.JSONDecodeError as exc:
            _emit(json.dumps({"type": "error", "id": None, "error": f"Malformed request: {exc}"}))
            continue

        def progress(stage: str, pct: int, message: str, _id: Any = req_id):
            _emit(json.dumps({"type": "progress", "id": _id, "stage": stage, "pct": pct, "message": message}, default=str))

        started = time.time()
        try:
            result = handle(cmd, args, progress)
            _emit(json.dumps({"type": "result", "id": req_id, "cmd": cmd, "ok": True, "duration": round(time.time() - started, 3), "result": _sanitize(result)}, default=str))
            if cmd == "shutdown":
                break
        except EngineError as exc:
            _emit(json.dumps({"type": "result", "id": req_id, "cmd": cmd, "ok": False, "error": str(exc)}))
        except (KeyboardInterrupt, EOFError):
            break
        except Exception as exc:  # noqa: BLE001 — engine must survive any request
            _emit(json.dumps({"type": "result", "id": req_id, "cmd": cmd, "ok": False, "error": f"Engine error: {type(exc).__name__}: {exc}"}))


def _sanitize(o: Any) -> Any:
    """Ensure nested values are JSON-safe (numpy scalars, NaN, Timestamps)."""
    import numpy as np
    import pandas as pd

    if o is None:
        return None
    if isinstance(o, (str, bool, int)):
        return o
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if (f != f) else f
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (np.ndarray,)):
        return [_sanitize(x) for x in o.tolist()]
    if isinstance(o, (pd.Timestamp,)):
        return str(o)
    if isinstance(o, float):
        return None if (o != o) else o
    if isinstance(o, dict):
        return {str(k): _sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_sanitize(v) for v in o]
    return o


if __name__ == "__main__":
    main()
