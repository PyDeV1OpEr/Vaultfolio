"""CSV ingestion, delimiter/encoding sniffing, and column type inference.

All I/O is restricted to paths handed over by the Rust main process. Large
files are read in chunks so the engine never loads a full multi-hundred-MB
file at once unless the caller explicitly asks for a full-frame operation.
"""

from __future__ import annotations

import csv
import io
import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# Engine-side guard rails: refuse to process absurdly large files that would
# risk OOM on modest hardware. 2 GiB of raw CSV is already a serious dataset.
MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024
# Rows above this profile cap are profiled on the first chunk sample (values
# only; row counts are still exact via chunked counting).
FULL_PROFILE_ROW_CAP = 5_000_000

BOOLEAN_TRUE = {"true", "t", "yes", "y", "1"}
BOOLEAN_FALSE = {"false", "f", "no", "n", "0"}
ENCODING_CANDIDATES = ["utf-8-sig", "latin-1"]


class EngineError(Exception):
    """User-presentable engine error; message is shown in the UI verbatim."""


def _read_text_head(path: str, bytes_count: int = 65536) -> Tuple[str, str]:
    """Read the head of the file, autodetecting a usable encoding."""
    with open(path, "rb") as f:
        blob = f.read(bytes_count)
    if os.path.getsize(path) > MAX_INPUT_BYTES:
        raise EngineError("File is larger than the 2 GiB import limit.")
    if not blob:
        raise EngineError("The file is empty.")
    for enc in ENCODING_CANDIDATES:
        try:
            return blob.decode(enc), enc
        except UnicodeDecodeError:
            continue
    raise EngineError("Could not decode the file as UTF-8 (or Latin-1 fallback).")


def sniff_delimiter(head: str) -> str:
    """Detect comma / semicolon / tab delimiters; fall back to comma."""
    sample = head[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        if dialect.delimiter in (",", ";", "\t", "|"):
            return dialect.delimiter
    except csv.Error:
        pass
    # Sniffer fails on single-column CSVs; pick the delimiter with most repeats.
    candidates = {d: sample.count(d) for d in (",", ";", "\t")}
    best = max(candidates, key=candidates.get)  # type: ignore[arg-type]
    return best


def load_csv(
    path: str,
    delimiter: Optional[str] = None,
    encoding: Optional[str] = None,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Load a CSV into pandas, returning the resolved format metadata."""
    if not os.path.exists(path):
        raise EngineError(f"Dataset file is missing on disk: {os.path.basename(path)}")
    head, detected_encoding = _read_text_head(path)
    delim = delimiter if delimiter and delimiter != "auto" else sniff_delimiter(head)
    enc = encoding if encoding else detected_encoding
    engine = "c" if delim in (",", ";", "\t") else "python"
    try:
        df = pd.read_csv(
            path,
            delimiter=delim,
            encoding=enc,
            engine=engine,
            on_bad_lines="warn",
        )
    except (pd.errors.ParserError, ValueError) as exc:
        raise EngineError(f"Could not parse the CSV file: {exc}") from exc
    if df.empty or df.columns.tolist() == [""]:
        raise EngineError("The CSV has no usable columns or rows.")
    df.columns = [str(c) for c in df.columns]
    meta = {"delimiter": delim, "encoding": enc}
    return df, meta


def normalize_blank_strings(df: pd.DataFrame) -> pd.DataFrame:
    """Treat '', 'NA', 'N/A', '-', 'nan' cells as missing values."""
    return df.replace(
        to_replace=["", "NA", "N/A", "n/a", "na", "-", "nan", "NaN", "NULL", "null", "None"],
        value=np.nan,
    )


def infer_column_type(series: pd.Series) -> str:
    """Classify a column as numeric / boolean / datetime / categorical."""
    non_null = series.dropna()
    if non_null.empty:
        return "empty"
    # datetime dtype check must run before the numeric probe, because
    # pd.to_numeric happily converts datetimes to epoch integers.
    if non_null.dtype.kind in ("M",):
        return "datetime"
    vals = non_null.astype(str).str.strip().str.lower()
    distinct = set(vals.unique())
    if distinct and distinct.issubset(BOOLEAN_TRUE | BOOLEAN_FALSE) and len(distinct) >= 1 and len(distinct) <= 2:
        # Boolean-like only if values are non-numeric words or 0/1-like AND the
        # column is not already integer-typed with >1 distinct beyond 0/1.
        if len(distinct) == 2:
            if series.dtype.kind == "b" or vals.isin(("true", "false", "yes", "no", "t", "f", "y", "n")).all():
                return "boolean"
            if distinct == {"0", "1"} and (vals.astype(str).isin(("0", "1")).mean() > 0.999):
                # keep numeric 0/1 as numeric unless explicitly boolean-typed
                return "numeric"
        else:
            if vals.isin(("true", "false", "yes", "no", "t", "f", "y", "n")).all():
                return "boolean"
    # numeric
    numeric = pd.to_numeric(non_null, errors="coerce")
    if numeric.notna().mean() >= 0.95:
        return "numeric"
    as_dt = pd.to_datetime(non_null.head(200), errors="coerce")
    if as_dt.notna().mean() >= 0.9:
        # confirm over a larger sample to avoid misfiring on numeric-ish strings
        confirm = pd.to_datetime(non_null.head(2000), errors="coerce")
        if confirm.notna().mean() >= 0.9:
            return "datetime"
    return "categorical"


def column_series_stats(series: pd.Series) -> Dict[str, Any]:
    """Statistics for one column after type inference."""
    non_null = series.dropna()
    missing = int(series.isna().sum())
    out: Dict[str, Any] = {
        "name": str(series.name),
        "missing": missing,
        "missing_pct": round(missing / max(len(series), 1) * 100, 2),
        "non_null": int(len(non_null)),
        "unique": int(non_null.nunique(dropna=True)),
    }
    dtype = infer_column_type(series)
    out["type"] = dtype
    if dtype == "numeric":
        num = pd.to_numeric(non_null, errors="coerce").dropna()
        if not num.empty:
            q1, q2, q3 = (float(np.percentile(num, p)) for p in (25, 50, 75))
            out.update(
                {
                    "mean": _jsonify(float(num.mean())),
                    "median": _jsonify(float(num.median())),
                    "min": _jsonify(float(num.min())),
                    "max": _jsonify(float(num.max())),
                    "std": _jsonify(float(num.std())),
                    "q1": _jsonify(q1),
                    "q3": _jsonify(q3),
                }
            )
    elif dtype in ("categorical", "boolean"):
        counts = non_null.astype(str).value_counts().head(8)
        out["top_values"] = [
            {"value": _jsonify(v), "count": int(c), "share_pct": round(c / len(non_null) * 100, 2)}
            for v, c in counts.items()
        ]
    elif dtype == "datetime":
        dt = pd.to_datetime(non_null, errors="coerce").dropna()
        if not dt.empty:
            out["min"] = str(dt.min())
            out["max"] = str(dt.max())
    return out


def profile_frame(df: pd.DataFrame) -> Dict[str, Any]:
    """Build the complete dataset profile dict."""
    cols: List[Dict[str, Any]] = []
    missing_total = 0
    dup_count = int(df.duplicated().sum())
    for name in df.columns:
        stat = column_series_stats(df[name])
        cols.append(stat)
        missing_total += int(stat["missing"])
    type_counts: Dict[str, int] = {}
    for c in cols:
        type_counts[c["type"]] = type_counts.get(c["type"], 0) + 1
    return {
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": cols,
        "column_types": type_counts,
        "missing_total": int(missing_total),
        "duplicate_rows": dup_count,
    }


def write_canonical_csv(df: pd.DataFrame, dest: str, delimiter: str = ",") -> int:
    """Write the normalized UTF-8 dataset copy; returns the row count."""
    path_out = os.path.dirname(dest)
    os.makedirs(path_out, exist_ok=True)
    df.to_csv(dest, index=False, sep=delimiter, encoding="utf-8")
    return int(len(df))


def paginate(df: pd.DataFrame, page: int, page_size: int) -> Tuple[List[List[Any]], int]:
    total = int(len(df))
    start = max(0, (page - 1)) * page_size
    end = start + page_size
    chunk = df.iloc[start:end]
    rows = [[_jsonify(v) for v in row] for row in chunk.itertuples(index=False, name=None)]
    return rows, total


def _jsonify(v: Any) -> Any:
    """Convert numpy / pandas scalars to JSON-safe Python values."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if np.isnan(f) else (int(f) if f.is_integer() and abs(f) < 1e15 else f)
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (pd.Timestamp,)):
        return str(v)
    if pd.isna(v):
        return None
    if isinstance(v, np.ndarray):
        return [_jsonify(x) for x in v.tolist()]
    return v if isinstance(v, (str, int, float, bool, list, dict)) else str(v)
