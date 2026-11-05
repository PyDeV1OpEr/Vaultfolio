//! Tauri IPC commands for the Intelligence workspace.
//!
//! Security invariants:
//! • The renderer only ever passes entity ids, or paths that came from a
//!   Tauri-native dialog / drag-drop event (validated: real file, .csv,
//!   size cap). It cannot cause reads of arbitrary filesystem paths.
//! • Model files are never loaded without the SHA-256 recorded at save time.
//! • All writes go to the app data directory, or a user-selected save target.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db;
use crate::mlengine::Engine;

pub struct Db(pub Mutex<rusqlite::Connection>);
pub struct IntelPaths(pub PathBuf);

const MAX_IMPORT_BYTES: u64 = 512 * 1024 * 1024; // 512 MiB per-file import cap
const MAX_ROWS: usize = 2_000_000;

fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_iso(secs)
}

fn format_iso(secs: u64) -> String {
    // Civil-from-days algorithm (Howard Hinnant) — no external date library.
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem / 60) % 60, rem % 60);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 365_24 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, s)
}

fn lock_err(_: std::sync::PoisonError<std::sync::MutexGuard<'_, rusqlite::Connection>>) -> String {
    "An internal lock is unavailable.".into()
}

fn db_err(e: rusqlite::Error) -> String {
    format!("Database error: {}", e)
}

use rusqlite::OptionalExtension;

fn emit_progress(app: &AppHandle, stage: &str, pct: i64, message: &str) {
    let _ = app.emit(
        crate::mlengine::PROGRESS_EVENT,
        json!({"type": "progress", "stage": stage, "pct": pct, "message": message}),
    );
}

/* ────────────── status & workspace overview ────────────── */

#[tauri::command]
pub fn intel_engine_status(engine: State<'_, Engine>) -> Result<Value, String> {
    let versions = engine.request("versions", json!({})).unwrap_or(Value::Null);
    Ok(json!({ "ready": engine.is_ready(), "runtime": versions }))
}

#[tauri::command]
pub fn intel_workspace_stats(db: State<'_, Db>, paths: State<'_, IntelPaths>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    let s = db::workspace_stats(&conn).map_err(db_err)?;
    let mut storage_bytes: u64 = 0;
    for dir in ["datasets", "models", "predictions"] {
        storage_bytes += dir_size(&paths.0.join(dir));
    }
    Ok(json!({
        "datasetCount": s.dataset_count,
        "modelCount": s.model_count,
        "runCount": s.run_count,
        "lastRunAt": s.last_run_at,
        "lastModelName": s.last_model_name,
        "storageBytes": storage_bytes,
    }))
}

fn dir_size(p: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(p) {
        for e in entries.flatten() {
            total += match e.metadata() {
                Ok(m) if m.is_dir() => dir_size(&e.path()),
                Ok(m) => m.len(),
                _ => 0,
            };
        }
    }
    total
}

/* ────────────── import (shared core) ────────────── */

fn run_import(
    app: &AppHandle,
    engine: &Engine,
    db: &Db,
    paths: &IntelPaths,
    src: &str,
    name: Option<String>,
) -> Result<Value, String> {
    let src_path = PathBuf::from(src);
    let meta = fs::metadata(&src_path).map_err(|_| "That file could not be found.".to_string())?;
    if !meta.is_file() {
        return Err("Only a real CSV file can be imported.".into());
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err("This file exceeds the 512 MB import limit.".into());
    }
    let ext_ok = src_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("csv"))
        .unwrap_or(false);
    if !ext_ok {
        return Err("Only .csv files are supported.".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let stem = src_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("dataset")
        .trim();
    let candidate = name.filter(|s| !s.trim().is_empty()).map(|s| s.trim().to_string());
    let mut dataset_name: String = candidate.unwrap_or_else(|| {
        if stem.is_empty() { "dataset".into() } else { stem.to_string() }
    });

    let dest = paths.0.join("datasets").join(format!("{}.csv", id));

    emit_progress(app, "parsing", 5, "Reading and parsing the CSV…");
    let result = engine
        .request(
            "ingest",
            json!({
                "src_path": src_path.to_string_lossy(),
                "dest_path": dest.to_string_lossy(),
            }),
        )
        .map_err(|e| format!("Import failed: {}", e))?;
    let profile = result.get("profile").cloned().unwrap_or(Value::Null);
    let rows = profile.get("row_count").and_then(Value::as_i64).unwrap_or(0);
    if rows == 0 {
        let _ = fs::remove_file(&dest);
        return Err("The CSV contains no data rows.".into());
    }
    if rows as usize > MAX_ROWS {
        let _ = fs::remove_file(&dest);
        return Err(format!("This dataset has {} rows, above the {}-row limit.", rows, MAX_ROWS));
    }

    let columns: Vec<db::ColumnMeta> = profile
        .get("columns")
        .and_then(Value::as_array)
        .map(|cols| {
            cols.iter()
                .filter_map(|c| {
                    Some(db::ColumnMeta {
                        name: c.get("name")?.as_str()?.to_string(),
                        dtype: c.get("type")?.as_str()?.to_string(),
                        missing: c.get("missing")?.as_i64()?,
                        missing_pct: c.get("missing_pct")?.as_f64()?,
                        unique: c.get("unique")?.as_i64()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let mut conn = db.0.lock().map_err(lock_err)?;
    ensure_unique_name(&conn, "datasets", &mut dataset_name);
    db::insert_dataset(
        &conn,
        &db::DatasetInsert {
            id: id.clone(),
            name: dataset_name.clone(),
            canonical_path: dest.to_string_lossy().to_string(),
            original_name: src_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("file")
                .to_string(),
            original_path: src_path.to_string_lossy().to_string(),
            byte_size: result
                .get("canonical_bytes")
                .and_then(Value::as_i64)
                .unwrap_or(meta.len() as i64),
            row_count: rows,
            delimiter: result.get("delimiter").and_then(Value::as_str).unwrap_or(",").to_string(),
            encoding: result.get("encoding").and_then(Value::as_str).unwrap_or("utf-8").to_string(),
            profile: profile.clone(),
            missing_total: profile.get("missing_total").and_then(Value::as_i64).unwrap_or(0),
            duplicate_rows: profile.get("duplicate_rows").and_then(Value::as_i64).unwrap_or(0),
            imported_at: now_iso(),
            columns,
        },
    )
    .map_err(db_err)?;
    drop(conn);

    emit_progress(app, "done", 100, &format!("Imported {}", dataset_name));
    fetch_dataset(db, &id)
}

#[derive(Deserialize)]
pub struct ImportArgs {
    /// Path resolved by the native file dialog or a Tauri drag-drop event.
    pub src: String,
    pub name: Option<String>,
}

#[tauri::command]
pub fn intel_import_csv(
    app: AppHandle,
    engine: State<'_, Engine>,
    db: State<'_, Db>,
    paths: State<'_, IntelPaths>,
    args: ImportArgs,
) -> Result<Value, String> {
    run_import(&app, &engine, &db, &paths, &args.src, args.name.clone())
}

fn ensure_unique_name(conn: &MutexGuard<'_, rusqlite::Connection>, table: &str, name: &mut String) {
    let stmt = format!("SELECT COUNT(*) FROM {} WHERE name = ?1", table);
    let base = name.clone();
    let mut n = 1;
    loop {
        let count: i64 = conn.query_row(&stmt, [base.clone()], |r| r.get(0)).unwrap_or(0);
        if count == 0 {
            *name = base;
            return;
        }
        n += 1;
        *name = format!("{} ({})", base, n);
    }
}

fn fetch_dataset(db: &Db, id: &str) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    let rec = db::get_dataset(&conn, id).map_err(db_err)?;
    match rec {
        None => Err("Dataset not found.".into()),
        Some(d) => Ok(json!({
            "id": d.summary.id,
            "name": d.summary.name,
            "originalName": d.summary.original_name,
            "byteSize": d.summary.byte_size,
            "rowCount": d.summary.row_count,
            "missingTotal": d.summary.missing_total,
            "duplicateRows": d.summary.duplicate_rows,
            "importedAt": d.summary.imported_at,
            "delimiter": d.delimiter,
            "encoding": d.encoding,
            "profile": d.profile,
        })),
    }
}

#[tauri::command]
pub fn intel_get_dataset(db: State<'_, Db>, id: String) -> Result<Value, String> {
    fetch_dataset(&db, &id)
}

#[tauri::command]
pub fn intel_list_datasets(db: State<'_, Db>) -> Result<Vec<db::DatasetSummary>, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    Ok(db::list_datasets(&conn).map_err(db_err)?)
}

#[tauri::command]
pub fn intel_delete_dataset(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, IntelPaths>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    let rec = db::get_dataset(&conn, &id).map_err(db_err)?;
    if rec.is_none() {
        return Err("Dataset not found.".into());
    }
    conn.execute("DELETE FROM datasets WHERE id = ?1", [&id]).map_err(db_err)?;
    // Models that referenced this dataset survive with dataset_id = NULL.
    let _ = fs::remove_file(paths.0.join("datasets").join(format!("{}.csv", id)));
    drop(conn);
    emit_progress(&app, "done", 100, "Dataset deleted");
    Ok(json!({"ok": true}))
}

#[derive(Deserialize)]
pub struct PreviewArgs {
    pub dataset_id: String,
    pub page: i64,
    pub page_size: i64,
    pub sort: Option<String>,
    pub dir: Option<String>,
    pub search: Option<String>,
    pub columns: Option<Vec<String>>,
}

#[tauri::command]
pub fn intel_preview(engine: State<'_, Engine>, db: State<'_, Db>, args: PreviewArgs) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    let rec = db::get_dataset(&conn, &args.dataset_id).map_err(db_err)?;
    let Some(d) = rec else { return Err("Dataset not found.".into()) };
    drop(conn);

    engine
        .request(
            "preview",
            json!({
                "path": d.canonical_path,
                "delimiter": d.delimiter,
                "page": args.page.max(1),
                "page_size": args.page_size.clamp(10, 500),
                "sort": args.sort,
                "dir": args.dir,
                "search": args.search,
                "columns": args.columns,
            }),
        )
        .map_err(|e| format!("Preview failed: {}", e))
}

#[tauri::command]
pub fn intel_column_stats(
    engine: State<'_, Engine>,
    db: State<'_, Db>,
    dataset_id: String,
    column: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    let rec = db::get_dataset(&conn, &dataset_id).map_err(db_err)?;
    let Some(d) = rec else { return Err("Dataset not found.".into()) };
    drop(conn);
    engine
        .request("column_stats", json!({"path": d.canonical_path, "delimiter": d.delimiter, "column": column}))
        .map_err(|e| format!("Statistics failed: {}", e))
}

/* ────────────── sample datasets ────────────── */

#[tauri::command]
pub fn intel_sample_catalog(app: AppHandle) -> Result<Value, String> {
    let manifest = app
        .path()
        .resolve("ml-engine/samples/manifest.json", tauri::path::BaseDirectory::Resource)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok());
    match manifest {
        Some(text) => serde_json::from_str(&text).map_err(|e| format!("Sample manifest invalid: {}", e)),
        None => Ok(json!({"samples": []})),
    }
}

#[tauri::command]
pub fn intel_seed_samples(
    app: AppHandle,
    engine: State<'_, Engine>,
    db: State<'_, Db>,
    paths: State<'_, IntelPaths>,
) -> Result<Value, String> {
    // Sample CSVs ship inside the application bundle; copy each through the
    // real engine so they behave exactly like user imports.
    let res = app
        .path()
        .resolve("ml-engine/samples", tauri::path::BaseDirectory::Resource)
        .map_err(|_| "Application resources missing.".to_string())?;
    if !res.is_dir() {
        return Err("Sample datasets are not present in this build.".into());
    }
    let manifest: Value = intel_sample_catalog(app.clone()).unwrap_or(json!({"samples": []}));
    let titles: std::collections::HashMap<String, String> = manifest
        .get("samples")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    Some((
                        s.get("file")?.as_str()?.to_string(),
                        s.get("title")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    let mut seeded = 0;
    for entry in fs::read_dir(&res).map_err(|e| format!("Samples unreadable: {}", e))? {
        let Ok(entry) = entry else { continue };
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("csv")) != Some(true) {
            continue;
        }
        let file_name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let title = titles.get(&file_name).map(|t| t.to_string());
        run_import(&app, &engine, &db, &paths, &p.to_string_lossy(), title)?;
        seeded += 1;
    }
    Ok(json!({"seeded": seeded}))
}

/* ────────────── training ────────────── */

#[derive(Deserialize)]
pub struct TrainArgs {
    pub dataset_id: String,
    pub task: String, // classification | regression | clustering
    pub target: Option<String>,
    pub features: Vec<String>,
    #[serde(default = "default_test_size")]
    pub test_size: f64,
    #[serde(default = "default_state")]
    pub random_state: i64,
    /// Explicit algorithm ids, or ["auto"] for the baseline comparison.
    #[serde(default = "empty_vec")]
    pub algorithms: Vec<String>,
    pub n_clusters: Option<i64>,
    pub dbscan_eps: Option<f64>,
    pub dbscan_min_samples: Option<i64>,
    pub model_name: Option<String>,
}

fn default_test_size() -> f64 { 0.25 }
fn default_state() -> i64 { 42 }
fn empty_vec() -> Vec<String> { vec![] }

const TASKS: [&str; 3] = ["classification", "regression", "clustering"];

fn algo_label_of(task: &str, algo: &str) -> String {
    let labels = match task {
        "classification" => vec![
            ("logistic_regression", "Logistic Regression"),
            ("random_forest_classifier", "Random Forest"),
            ("decision_tree_classifier", "Decision Tree"),
            ("gradient_boosting_classifier", "Gradient Boosting"),
            ("linear_svc", "Linear SVC"),
        ],
        "regression" => vec![
            ("linear_regression", "Linear Regression"),
            ("ridge", "Ridge Regression"),
            ("random_forest_regressor", "Random Forest Regressor"),
            ("decision_tree_regressor", "Decision Tree Regressor"),
            ("gradient_boosting_regressor", "Gradient Boosting Regressor"),
        ],
        _ => vec![("kmeans", "K-Means"), ("dbscan", "DBSCAN")],
    };
    labels
        .iter()
        .find(|(id, _)| *id == algo)
        .map(|(_, label)| label.to_string())
        .unwrap_or_else(|| algo.to_string())
}

#[tauri::command]
pub fn intel_train(
    app: AppHandle,
    engine: State<'_, Engine>,
    db: State<'_, Db>,
    paths: State<'_, IntelPaths>,
    args: TrainArgs,
) -> Result<Value, String> {
    if !TASKS.contains(&args.task.as_str()) {
        return Err(format!("Unsupported task: {}", args.task));
    }
    if args.features.is_empty() {
        return Err("Select at least one feature column.".into());
    }
    let (dataset_path, dataset_delim, dataset_name) = {
        let conn = db.0.lock().map_err(lock_err)?;
        let rec = db::get_dataset(&conn, &args.dataset_id).map_err(db_err)?;
        match rec {
            None => return Err("Dataset not found.".into()),
            Some(d) => (d.canonical_path, d.delimiter, d.summary.name),
        }
    };

    let mut algorithms = args.algorithms.clone();
    if algorithms.len() == 1 && algorithms[0] == "auto" {
        algorithms = vec![];
    }

    let model_id = uuid::Uuid::new_v4().to_string();
    let mut model_name = args
        .model_name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string());
    let user_named = model_name.is_some();

    emit_progress(&app, "loading", 8, "Loading dataset into the engine…");
    let result = engine
        .request(
            "train",
            json!({
                "task": args.task,
                "dataset_path": dataset_path,
                "delimiter": dataset_delim,
                "target": args.target,
                "features": args.features,
                "test_size": args.test_size.clamp(0.05, 0.5),
                "random_state": args.random_state,
                "algorithms": algorithms,
                "n_clusters": args.n_clusters.unwrap_or(3),
                "dbscan_eps": args.dbscan_eps,
                "dbscan_min_samples": args.dbscan_min_samples,
                "save_path": paths.0.join("models").join(&model_id).join("model.joblib").to_string_lossy(),
                "meta": { "dataset": dataset_name, "engine": "vaultfolio-intelligence" },
            }),
        )
        .map_err(|e| format!("Training failed: {}", e))?;

    let selected = result
        .get("selected")
        .and_then(Value::as_str)
        .ok_or_else(|| "Engine returned no selected model.".to_string())?
        .to_string();
    let selected_metrics = result.get("selected_metrics").cloned().unwrap_or(Value::Null);
    let sha = result
        .get("sha256")
        .and_then(Value::as_str)
        .ok_or_else(|| "Engine returned no model checksum.".to_string())?
        .to_string();

    let model_name = match model_name {
        Some(n) => n,
        None => format!(
            "{} · {}",
            algo_label_of(&args.task, &selected),
            dataset_name
        ),
    };

    let mut conn = db.0.lock().map_err(lock_err)?;
    let mut unique = model_name.clone();
    ensure_unique_name(&conn, "models", &mut unique);
    let file_path = paths.0.join("models").join(&model_id).join("model.joblib");
    db::insert_model(
        &conn,
        &db::ModelInsert {
            id: model_id.clone(),
            name: unique.clone(),
            dataset_id: Some(args.dataset_id.clone()),
            dataset_name,
            task: args.task.clone(),
            algorithm: selected.clone(),
            algorithm_label: algo_label_of(&args.task, &selected),
            target: args
                .target
                .clone()
                .filter(|_| args.task != "clustering"),
            features: args.features.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            sha256: sha,
            metrics: selected_metrics.clone(),
            comparison: result.get("comparison").cloned(),
            train_rows: result.get("train_rows").and_then(Value::as_i64),
            test_rows: result.get("test_rows").and_then(Value::as_i64),
            classes: result.get("classes").cloned(),
            n_clusters: args.n_clusters,
            test_size: Some(args.test_size.clamp(0.05, 0.5)),
            random_state: Some(args.random_state),
            duration_seconds: result.get("duration").and_then(Value::as_f64),
            bundle_version: result.get("bundle_version").and_then(Value::as_i64),
            engine_version: result.get("engine_version").and_then(Value::as_str).map(String::from),
            created_at: now_iso(),
        },
    )
    .map_err(db_err)?;
    drop(conn);

    emit_progress(&app, "done", 100, &format!("Saved model {}", model_name));
    let _ = user_named;
    get_model_full(&db, &model_id)
}

/* ────────────── models ────────────── */

#[tauri::command]
pub fn intel_list_models(db: State<'_, Db>) -> Result<Vec<db::ModelSummary>, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    Ok(db::list_models(&conn).map_err(db_err)?)
}

pub fn get_model_full(db: &Db, id: &str) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    let row = db::get_model_row(&conn, id).map_err(db_err)?;
    let Some(r) = row else { return Err("Model not found.".into()) };
    let comparison = r
        .comparison
        .as_ref()
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .unwrap_or(Value::Null);
    let metrics: Value = serde_json::from_str::<Value>(&r.metrics).unwrap_or(Value::Null);
    let classes = r
        .classes
        .as_ref()
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .unwrap_or(Value::Null);
    let features_parsed: Value =
        serde_json::from_str::<Vec<String>>(&r.features).map(|l| json!(l)).unwrap_or(Value::Null);
    let scoring = match metrics.get("test_score").and_then(Value::as_f64) {
        Some(f) => json!(f),
        None => Value::Null,
    };
    let scoring_label = json!(db::scoring_label(&r.task));
    let mut v = serde_json::to_value(&r).map_err(|e| format!("serialization: {}", e))?;
    if let Some(obj) = v.as_object_mut() {
        obj.remove("file_path");
        obj.remove("sha256");
        obj.remove("features");
        obj.insert("comparison".into(), comparison);
        obj.insert("metrics".into(), metrics);
        obj.insert("classes".into(), classes);
        obj.insert("scoring".into(), scoring);
        obj.insert("scoring_label".into(), scoring_label);
        obj.insert("featuresParsed".into(), features_parsed);
    }
    drop(conn);
    Ok(v)
}

#[tauri::command]
pub fn intel_get_model(db: State<'_, Db>, id: String) -> Result<Value, String> {
    get_model_full(&db, &id)
}

#[tauri::command]
pub fn intel_rename_model(db: State<'_, Db>, id: String, name: String) -> Result<Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 120 {
        return Err("Model name must be 1–120 characters.".into());
    }
    let conn = db.0.lock().map_err(lock_err)?;
    conn.execute("UPDATE models SET name = ?1 WHERE id = ?2", [&name, &id]).map_err(db_err)?;
    Ok(json!({"ok": true, "name": name}))
}

#[tauri::command]
pub fn intel_delete_model(db: State<'_, Db>, id: String) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    let row = db::get_model_row(&conn, &id).map_err(db_err)?;
    let Some(row) = row else { return Err("Model not found.".into()) };
    conn.execute("DELETE FROM models WHERE id = ?1", [&id]).map_err(db_err)?;
    drop(conn);
    if let Some(parent) = Path::new(&row.file_path).parent() {
        let _ = fs::remove_dir_all(parent);
    }
    Ok(json!({"ok": true}))
}

/* ────────────── prediction runs ────────────── */

#[derive(Deserialize)]
pub struct PredictArgs {
    pub model_id: String,
    /// Single-record input: array of {column: value} objects.
    #[serde(default)]
    pub rows: Vec<Value>,
    /// Batch source resolved to a dataset in the local library.
    pub dataset_id: Option<String>,
    /// Batch source path selected via dialog or drag-drop.
    pub csv_path: Option<String>,
}

#[tauri::command]
pub fn intel_predict(
    app: AppHandle,
    engine: State<'_, Engine>,
    db: State<'_, Db>,
    paths: State<'_, IntelPaths>,
    args: PredictArgs,
) -> Result<Value, String> {
    let (model_path, model_sha, model_name, model_task, model_algo) = {
        let conn = db.0.lock().map_err(lock_err)?;
        let row = db::get_model_row(&conn, &args.model_id).map_err(db_err)?;
        let Some(row) = row else { return Err("Model not found.".into()) };
        (row.file_path, row.sha256, row.name, row.task.clone(), row.algorithm.clone())
    };

    // Resolve the batch source (dataset library, picked file, or inline rows).
    let mut source = json!(null);
    let mut run_dataset_name: Option<String> = None;
    let mut run_dataset_id: Option<String> = args.dataset_id.clone();
    if let Some(dataset_id) = &args.dataset_id {
        let conn = db.0.lock().map_err(lock_err)?;
        let rec = db::get_dataset(&conn, dataset_id).map_err(db_err)?;
        let Some(d) = rec else { return Err("Dataset not found.".into()) };
        drop(conn);
        run_dataset_name = Some(d.summary.name.clone());
        source = json!({"type": "csv", "path": d.canonical_path, "delimiter": d.delimiter, "encoding": d.encoding});
    } else if let Some(csv_path) = &args.csv_path {
        let p = PathBuf::from(csv_path);
        let meta = fs::metadata(&p).map_err(|_| "The prediction file could not be found.".to_string())?;
        if !meta.is_file() || meta.len() > MAX_IMPORT_BYTES {
            return Err("The prediction file is missing or too large.".into());
        }
        if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("csv")) != Some(true) {
            return Err("Only .csv files can be used for batch predictions.".into());
        }
        run_dataset_name = Some(p.file_name().and_then(|s| s.to_str()).unwrap_or("file").to_string());
        run_dataset_id = None;
        source = json!({"type": "csv", "path": csv_path});
    } else if !args.rows.is_empty() {
        source = json!({"type": "rows", "rows": args.rows});
    } else {
        return Err("Provide records or a source dataset for prediction.".into());
    }

    emit_progress(&app, "predicting", 30, "Applying the saved preprocessing pipeline…");
    let started = std::time::Instant::now();
    let result = engine
        .request(
            "predict",
            json!({
                "model_path": model_path,
                "sha256": model_sha,
                "source": source,
                "model_meta": {},
            }),
        )
        .map_err(|e| format!("Prediction failed: {}", e))?;
    let duration = started.elapsed().as_secs_f64();

    let out_cols_arr = result
        .get("columns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let out_cols: Vec<String> = out_cols_arr
        .iter()
        .filter_map(Value::as_str)
        .map(String::from)
        .collect();
    let rows_out = result
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let record_count = rows_out.len() as i64;
    if record_count == 0 {
        return Err("No input rows were available for prediction.".into());
    }

    // Persist the run + results. Up to 5,000 rows go into SQLite; the CSV on
    // disk always contains the full set.
    let run_id = uuid::Uuid::new_v4().to_string();
    let results_path = paths.0.join("predictions").join(format!("{}.csv", run_id));
    write_results_csv(&results_path, &rows_out)?;

    let mut conn = db.0.lock().map_err(lock_err)?;
    let stored_rows: Vec<Value> = rows_out.iter().take(5000).cloned().collect();
    db::insert_run(
        &conn,
        &db::RunInsert {
            id: run_id.clone(),
            model_id: args.model_id.clone(),
            model_name: model_name.clone(),
            dataset_id: run_dataset_id.clone(),
            dataset_name: run_dataset_name.clone(),
            task: model_task.clone(),
            record_count,
            duration: Some(duration),
            summary: format!(
                "{} records · {}",
                record_count,
                result.get("prediction_note").and_then(Value::as_str).unwrap_or("")
            ),
            results_path: Some(results_path.to_string_lossy().to_string()),
            created_at: now_iso(),
            rows: stored_rows,
        },
    )
    .map_err(db_err)?;
    drop(conn);

    emit_progress(&app, "done", 100, &format!("Predicted {} records", record_count));
    let table: Vec<Value> = rows_out
        .into_iter()
        .map(|row| {
            if let Some(obj) = row.as_object() {
                let mut out = serde_json::Map::new();
                for c in &out_cols {
                    out.insert(c.clone(), obj.get(c).cloned().unwrap_or(Value::Null));
                }
                for key in ["_prediction", "_confidence", "_uncertainty", "_cluster_distance"] {
                    if let Some(v) = obj.get(key) {
                        out.insert(key.to_string(), v.clone());
                    }
                }
                Value::Object(out)
            } else {
                row
            }
        })
        .collect();
    Ok(json!({
        "runId": run_id,
        "recordCount": record_count,
        "durationSeconds": (duration * 1000.0).round() / 1000.0,
        "task": model_task,
        "algorithm": algo_label_of(&model_task, &model_algo),
        "predictionNote": result.get("prediction_note").and_then(Value::as_str).unwrap_or(""),
        "columns": out_cols_arr,
        "rows": table,
    }))
}

/// RFC 4180-style CSV writer (explicit escaping; no external dependency).
fn write_results_csv(dest: &Path, rows: &Vec<Value>) -> Result<(), String> {
    const EXTRA_KEYS: [&str; 4] = ["_prediction", "_confidence", "_uncertainty", "_cluster_distance"];
    let mut cols: Vec<String> = Vec::new();
    if let Some(first) = rows.first().and_then(Value::as_object) {
        for k in first.keys() {
            if k.starts_with('_') {
                continue;
            }
            cols.push(k.clone());
        }
        for key in EXTRA_KEYS {
            if first.contains_key(key) {
                cols.push(key.to_string());
            }
        }
    }
    if cols.is_empty() {
        return Err("Nothing to write.".into());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not write results: {}", e))?;
    }
    let mut text = String::new();
    text.push_str(&cols.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","));
    text.push('\n');
    for row in rows {
        let mut line = String::new();
        for (i, c) in cols.iter().enumerate() {
            if i > 0 {
                line.push(',');
            }
            let rendered = match row.get(c) {
                None | Some(Value::Null) => String::new(),
                Some(Value::String(s)) => s.clone(),
                Some(other) => other.to_string(),
            };
            line.push_str(&csv_escape(&rendered));
        }
        text.push_str(&line);
        text.push('\n');
    }
    fs::write(dest, text).map_err(|e| format!("Could not write results: {}", e))
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

#[tauri::command]
pub fn intel_list_runs(db: State<'_, Db>) -> Result<Vec<db::RunSummary>, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    Ok(db::list_runs(&conn, 200).map_err(db_err)?)
}

#[tauri::command]
pub fn intel_get_run(db: State<'_, Db>, id: String) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    let info: Option<(String, String, Option<String>, String, i64, Option<f64>, String, Option<String>, String)> = conn
        .query_row(
            "SELECT id, model_name, dataset_name, task, record_count, duration, summary, results_path, created_at
             FROM prediction_runs WHERE id = ?1",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
        )
        .optional()
        .map_err(db_err)?;
    let Some((id, model_name, dataset_name, task, record_count, duration, summary, results_file, created_at)) =
        info
    else {
        return Err("Prediction run not found.".into());
    };
    let rows = db::get_run_rows(&conn, &id).map_err(db_err)?;
    Ok(json!({
        "id": id,
        "modelName": model_name,
        "datasetName": dataset_name,
        "task": task,
        "recordCount": record_count,
        "durationSeconds": duration,
        "summary": summary,
        "resultsFile": results_file,
        "createdAt": created_at,
        "rows": rows,
    }))
}

#[tauri::command]
pub fn intel_delete_run(db: State<'_, Db>, id: String) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    conn.execute("DELETE FROM prediction_runs WHERE id = ?1", [&id]).map_err(db_err)?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub fn intel_clear_runs(db: State<'_, Db>, paths: State<'_, IntelPaths>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(lock_err)?;
    conn.execute("DELETE FROM prediction_runs", []).map_err(db_err)?;
    drop(conn);
    let _ = fs::remove_dir_all(paths.0.join("predictions"));
    let _ = fs::create_dir_all(paths.0.join("predictions"));
    Ok(json!({"ok": true}))
}

/* ────────────── dialogs & documentation ────────────── */

/// Native open dialog restricted to CSV files. Returns the absolute path the
/// user picked (renderer gets nothing until the user has chosen).
#[tauri::command]
pub fn intel_pick_csv(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .add_filter("CSV files", &["csv"])
        .blocking_pick_file();
    Ok(picked.and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}

/// Native save dialog for exports.
#[tauri::command]
pub fn intel_pick_save_path(app: AppHandle, default_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let safe = default_name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect::<String>();
    let dest = app
        .dialog()
        .file()
        .add_filter("CSV files", &["csv"])
        .set_file_name(&safe)
        .blocking_save_file();
    Ok(dest.and_then(|f| match f {
        FilePath::Path(p) => Some(p.to_string_lossy().to_string()),
        FilePath::Url(_) => None,
    }))
}

/// The bundled offline documentation bundle (guides + glossary + licenses).
#[tauri::command]
pub fn intel_docs(app: AppHandle) -> Result<Value, String> {
    let p = app
        .path()
        .resolve("ml-engine/documentation/docs.json", tauri::path::BaseDirectory::Resource)
        .ok();
    match p.and_then(|p| fs::read_to_string(p).ok()) {
        Some(text) => serde_json::from_str(&text).map_err(|e| format!("Documentation bundle invalid: {}", e)),
        None => Ok(json!({"docs": []})),
    }
}

/* ────────────── export ────────────── */

#[derive(Deserialize)]
pub struct ExportArgs {
    /// What to export: a prediction run's full result file, or a whole dataset.
    pub kind: String, // prediction | dataset
    pub id: String,
    /// Destination chosen through the native save dialog.
    pub dest: String,
}

#[tauri::command]
pub fn intel_export(db: State<'_, Db>, paths: State<'_, IntelPaths>, args: ExportArgs) -> Result<Value, String> {
    if Path::new(&args.dest)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("csv"))
        != Some(true)
    {
        return Err("Only .csv exports are supported.".into());
    }
    let src: Option<String> = match args.kind.as_str() {
        "prediction" => {
            let conn = db.0.lock().map_err(lock_err)?;
            conn.query_row(
                "SELECT results_path FROM prediction_runs WHERE id = ?1",
                [&args.id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(db_err)?
            .flatten()
        }
        "dataset" => {
            let conn = db.0.lock().map_err(lock_err)?;
            db::get_dataset(&conn, &args.id).map_err(db_err)?.map(|d| d.canonical_path)
        }
        _ => return Err("Unknown export kind.".into()),
    };
    let Some(src) = src else { return Err("Nothing to export.".into()) };
    // Security: copy only from inside the app-owned data directory — the only
    // paths the app itself created for this entity id.
    let src_path = PathBuf::from(&src);
    if src_path.starts_with(&paths.0) && src_path.is_file() {
        fs::copy(&src_path, &args.dest).map_err(|e| format!("Export failed: {}", e))?;
    } else if args.kind == "prediction" {
        // The full result file may no longer exist; rebuild from the stored rows.
        let conn = db.0.lock().map_err(lock_err)?;
        let rows = db::get_run_rows(&conn, &args.id).map_err(db_err)?;
        if rows.is_empty() {
            return Err("No stored results to export.".into());
        }
        write_results_csv(Path::new(&args.dest), &rows)?;
    } else {
        return Err("The export file is no longer available.".into());
    }
    Ok(json!({"ok": true, "dest": args.dest}))
}