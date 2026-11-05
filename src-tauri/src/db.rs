//! SQLite persistence for the Intelligence workspace.
//!
//! A dedicated `intelligence.db` lives in the app data directory and is
//! completely separate from the user's encrypted vault (which stays in the
//! webview browser storage). Metadata only — CSV contents and model binaries
//! are files on disk next to the database.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value as Json;

pub type DbResult<T> = Result<T, rusqlite::Error>;

pub const CURRENT_VERSION: i64 = 1;

/// Open (creating if needed) and migrate the intelligence database.
pub fn open(path: &std::path::Path) -> DbResult<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> DbResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS datasets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            canonical_path TEXT NOT NULL,
            original_name TEXT NOT NULL,
            original_path TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            row_count INTEGER NOT NULL,
            delimiter TEXT NOT NULL,
            encoding TEXT NOT NULL,
            profile TEXT NOT NULL,
            missing_total INTEGER NOT NULL,
            duplicate_rows INTEGER NOT NULL,
            imported_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dataset_columns (
            dataset_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            name TEXT NOT NULL,
            dtype TEXT NOT NULL,
            missing INTEGER NOT NULL,
            missing_pct REAL NOT NULL,
            `unique` INTEGER NOT NULL,
            PRIMARY KEY (dataset_id, name),
            FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_dataset_columns_ds ON dataset_columns(dataset_id);

        CREATE TABLE IF NOT EXISTS models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            dataset_id TEXT,
            dataset_name TEXT NOT NULL,
            task TEXT NOT NULL,
            algorithm TEXT NOT NULL,
            algorithm_label TEXT NOT NULL,
            target TEXT,
            features TEXT NOT NULL,
            file_path TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            metrics TEXT NOT NULL,
            comparison TEXT,
            train_rows INTEGER,
            test_rows INTEGER,
            classes TEXT,
            n_clusters INTEGER,
            test_size REAL,
            random_state INTEGER,
            duration_seconds REAL,
            bundle_version INTEGER,
            engine_version TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_models_task ON models(task);

        CREATE TABLE IF NOT EXISTS prediction_runs (
            id TEXT PRIMARY KEY,
            model_id TEXT NOT NULL,
            model_name TEXT NOT NULL,
            dataset_id TEXT,
            dataset_name TEXT,
            task TEXT NOT NULL,
            record_count INTEGER NOT NULL,
            duration REAL,
            summary TEXT NOT NULL,
            results_path TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runs_created ON prediction_runs(created_at);

        CREATE TABLE IF NOT EXISTS prediction_results (
            run_id TEXT NOT NULL,
            row_index INTEGER NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (run_id, row_index),
            FOREIGN KEY (run_id) REFERENCES prediction_runs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )?;
    conn.pragma_update(None, "user_version", rusqlite::types::Value::Integer(CURRENT_VERSION))?;
    Ok(())
}

/* ─────────────── record types ─────────────── */

#[derive(Debug, Clone, Serialize)]
pub struct DatasetSummary {
    pub id: String,
    pub name: String,
    pub original_name: String,
    pub byte_size: i64,
    pub row_count: i64,
    pub missing_total: i64,
    pub duplicate_rows: i64,
    pub imported_at: String,
    pub task_hint: Option<String>,
}

pub struct DatasetRecord {
    pub summary: DatasetSummary,
    pub canonical_path: String,
    pub delimiter: String,
    pub encoding: String,
    pub profile: Json,
    pub columns: Vec<ColumnMeta>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnMeta {
    pub name: String,
    pub dtype: String,
    pub missing: i64,
    pub missing_pct: f64,
    #[serde(rename = "unique")]
    pub unique: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelSummary {
    pub id: String,
    pub name: String,
    pub dataset_id: Option<String>,
    pub dataset_name: String,
    pub task: String,
    pub algorithm: String,
    pub algorithm_label: String,
    pub target: Option<String>,
    pub scoring: Option<f64>,
    pub scoring_label: Option<String>,
    pub created_at: String,
    pub train_rows: Option<i64>,
    pub test_rows: Option<i64>,
    pub duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n_clusters: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct RunSummary {
    pub id: String,
    pub model_id: String,
    pub model_name: String,
    pub dataset_name: Option<String>,
    pub task: String,
    pub record_count: i64,
    pub duration: Option<f64>,
    pub summary: String,
    pub created_at: String,
}

/* ─────────────── repo helpers ─────────────── */

pub fn insert_dataset(conn: &Connection, d: &DatasetInsert) -> DbResult<()> {
    conn.execute(
        r#"INSERT INTO datasets
           (id, name, canonical_path, original_name, original_path, byte_size, row_count,
            delimiter, encoding, profile, missing_total, duplicate_rows, imported_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)"#,
        params![
            d.id, d.name, d.canonical_path, d.original_name, d.original_path, d.byte_size,
            d.row_count, d.delimiter, d.encoding, d.profile.to_string(), d.missing_total,
            d.duplicate_rows, d.imported_at
        ],
    )?;
    for (i, c) in d.columns.iter().enumerate() {
        conn.execute(
            "INSERT INTO dataset_columns (dataset_id, position, name, dtype, missing, missing_pct, `unique`)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![d.id, i as i64, c.name, c.dtype, c.missing, c.missing_pct, c.unique],
        )?;
    }
    Ok(())
}

pub struct DatasetInsert {
    pub id: String,
    pub name: String,
    pub canonical_path: String,
    pub original_name: String,
    pub original_path: String,
    pub byte_size: i64,
    pub row_count: i64,
    pub delimiter: String,
    pub encoding: String,
    pub profile: Json,
    pub missing_total: i64,
    pub duplicate_rows: i64,
    pub imported_at: String,
    pub columns: Vec<ColumnMeta>,
}

pub fn get_dataset(conn: &Connection, id: &str) -> DbResult<Option<DatasetRecord>> {
    let row = conn
        .query_row(
            "SELECT id, name, canonical_path, original_name, original_path, byte_size, row_count,
                    delimiter, encoding, profile, missing_total, duplicate_rows, imported_at
             FROM datasets WHERE id = ?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, i64>(10)?,
                    r.get::<_, i64>(11)?,
                    r.get::<_, String>(12)?,
                ))
            },
        )
        .optional()?;
    let Some((id_, name, canonical, original_name, _original_path, size, rows, delim, enc, profile_s, missing, dups, imported)) = row
    else {
        return Ok(None);
    };
    let profile: Json = serde_json::from_str(&profile_s).unwrap_or(Json::Null);
    let mut stmt = conn.prepare(
        "SELECT name, dtype, missing, missing_pct, `unique` FROM dataset_columns WHERE dataset_id = ?1 ORDER BY position",
    )?;
    let columns = stmt
        .query_map([id_.as_str()], |r| {
            Ok(ColumnMeta {
                name: r.get(0)?,
                dtype: r.get(1)?,
                missing: r.get(2)?,
                missing_pct: r.get(3)?,
                unique: r.get(4)?,
            })
        })?
        .collect::<DbResult<Vec<_>>>()?;
    let task_hint: Option<String> = None;
    Ok(Some(DatasetRecord {
        summary: DatasetSummary {
            id: id_,
            name,
            original_name,
            byte_size: size,
            row_count: rows,
            missing_total: missing,
            duplicate_rows: dups,
            imported_at: imported,
            task_hint: None,
        },
        canonical_path: canonical,
        delimiter: delim,
        encoding: enc,
        profile,
        columns,
    }))
}

pub fn list_datasets(conn: &Connection) -> DbResult<Vec<DatasetSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, original_name, byte_size, row_count, missing_total, duplicate_rows, imported_at
         FROM datasets ORDER BY imported_at DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DatasetSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                original_name: r.get(2)?,
                byte_size: r.get(3)?,
                row_count: r.get(4)?,
                missing_total: r.get(5)?,
                duplicate_rows: r.get(6)?,
                imported_at: r.get(7)?,
                task_hint: None,
            })
        })?
        .collect::<DbResult<Vec<_>>>()?;
    Ok(rows)
}

pub struct ModelInsert {
    pub id: String,
    pub name: String,
    pub dataset_id: Option<String>,
    pub dataset_name: String,
    pub task: String,
    pub algorithm: String,
    pub algorithm_label: String,
    pub target: Option<String>,
    pub features: Vec<String>,
    pub file_path: String,
    pub sha256: String,
    pub metrics: Json,
    pub comparison: Option<Json>,
    pub train_rows: Option<i64>,
    pub test_rows: Option<i64>,
    pub classes: Option<Json>,
    pub n_clusters: Option<i64>,
    pub test_size: Option<f64>,
    pub random_state: Option<i64>,
    pub duration_seconds: Option<f64>,
    pub bundle_version: Option<i64>,
    pub engine_version: Option<String>,
    pub created_at: String,
}

pub fn scoring_label(task: &str) -> &'static str {
    match task {
        "classification" => "F1 (macro, test)",
        "regression" => "R² (test)",
        _ => "Silhouette",
    }
}

pub fn insert_model(conn: &Connection, m: &ModelInsert) -> DbResult<()> {
    conn.execute(
        r#"INSERT INTO models
           (id, name, dataset_id, dataset_name, task, algorithm, algorithm_label, target, features,
            file_path, sha256, metrics, comparison, train_rows, test_rows, classes, n_clusters,
            test_size, random_state, duration_seconds, bundle_version, engine_version, created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)"#,
        params![
            m.id, m.name, m.dataset_id, m.dataset_name, m.task, m.algorithm, m.algorithm_label,
            m.target, serde_json::to_string(&m.features).unwrap_or_else(|_| "[]".into()),
            m.file_path, m.sha256, m.metrics.to_string(),
            m.comparison.as_ref().map(|c| c.to_string()),
            m.train_rows, m.test_rows, m.classes.as_ref().map(|c| c.to_string()), m.n_clusters,
            m.test_size, m.random_state, m.duration_seconds, m.bundle_version,
            m.engine_version, m.created_at
        ],
    )
    .map(|_| ())
}

pub fn get_model_row(conn: &Connection, id: &str) -> DbResult<Option<ModelRow>> {
    conn.query_row(
        r#"SELECT id, name, dataset_id, dataset_name, task, algorithm, algorithm_label, target, features,
                  file_path, sha256, metrics, comparison, train_rows, test_rows, classes, n_clusters,
                  test_size, random_state, duration_seconds, bundle_version, engine_version, created_at
           FROM models WHERE id = ?1"#,
        [id],
        |r| Ok(ModelRow { id: r.get(0)?, name: r.get(1)?, dataset_id: r.get(2)?, dataset_name: r.get(3)?, task: r.get(4)?, algorithm: r.get(5)?, algorithm_label: r.get(6)?, target: r.get(7)?, features: r.get(8)?, file_path: r.get(9)?, sha256: r.get(10)?, metrics: r.get(11)?, comparison: r.get(12)?, train_rows: r.get(13)?, test_rows: r.get(14)?, classes: r.get(15)?, n_clusters: r.get(16)?, test_size: r.get(17)?, random_state: r.get(18)?, duration_seconds: r.get(19)?, bundle_version: r.get(20)?, engine_version: r.get(21)?, created_at: r.get(22)? }),
    )
    .optional()
}

#[derive(Serialize, Clone)]
pub struct ModelRow {
    pub id: String,
    pub name: String,
    pub dataset_id: Option<String>,
    pub dataset_name: String,
    pub task: String,
    pub algorithm: String,
    pub algorithm_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub features: String,
    pub file_path: String,
    pub sha256: String,
    pub metrics: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub train_rows: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_rows: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n_clusters: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub random_state: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine_version: Option<String>,
    pub created_at: String,
}

pub fn list_models(conn: &Connection) -> DbResult<Vec<ModelSummary>> {
    let mut stmt = conn.prepare(
        r#"SELECT id, name, dataset_id, dataset_name, task, algorithm, algorithm_label, target,
                  metrics, created_at, train_rows, test_rows, duration_seconds, n_clusters
           FROM models ORDER BY created_at DESC"#,
    )?;
    let rows = stmt
        .query_map([], map_model_summary)?
        .collect::<DbResult<Vec<_>>>()?;
    Ok(rows)
}

fn map_model_summary(r: &Row) -> DbResult<ModelSummary> {
    let task: String = r.get(4)?;
    let metrics: String = r.get::<_, String>(8)?;
    let score = serde_json::from_str::<Json>(&metrics)
        .ok()
        .and_then(|m| m.get("test_score").and_then(|v| v.as_f64()));
    Ok(ModelSummary {
        id: r.get(0)?,
        name: r.get(1)?,
        dataset_id: r.get(2)?,
        dataset_name: r.get(3)?,
        scoring: score,
        scoring_label: Some(scoring_label(&task).to_string()),
        task,
        algorithm: r.get(5)?,
        algorithm_label: r.get(6)?,
        target: r.get(7)?,
        created_at: r.get(9)?,
        train_rows: r.get(10)?,
        test_rows: r.get(11)?,
        duration_seconds: r.get(12)?,
        n_clusters: r.get(13)?,
    })
}

pub fn list_runs(conn: &Connection, limit: i64) -> DbResult<Vec<RunSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, model_id, model_name, dataset_name, task, record_count, duration, summary, created_at
         FROM prediction_runs ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(RunSummary {
                id: r.get(0)?,
                model_id: r.get(1)?,
                model_name: r.get(2)?,
                dataset_name: r.get(3)?,
                task: r.get(4)?,
                record_count: r.get(5)?,
                duration: r.get(6)?,
                summary: r.get(7)?,
                created_at: r.get(8)?,
            })
        })?
        .collect::<DbResult<Vec<_>>>()?;
    Ok(rows)
}

pub struct RunInsert {
    pub id: String,
    pub model_id: String,
    pub model_name: String,
    pub dataset_id: Option<String>,
    pub dataset_name: Option<String>,
    pub task: String,
    pub record_count: i64,
    pub duration: Option<f64>,
    pub summary: String,
    pub results_path: Option<String>,
    pub created_at: String,
    pub rows: Vec<Json>,
}

pub fn insert_run(conn: &Connection, r: &RunInsert) -> DbResult<()> {
    conn.execute(
        r#"INSERT INTO prediction_runs
           (id, model_id, model_name, dataset_id, dataset_name, task, record_count, duration, summary, results_path, created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"#,
        params![r.id, r.model_id, r.model_name, r.dataset_id, r.dataset_name, r.task,
                r.record_count, r.duration, r.summary, r.results_path, r.created_at],
    )?;
    for (i, row) in r.rows.iter().enumerate() {
        conn.execute(
            "INSERT INTO prediction_results (run_id, row_index, payload) VALUES (?1,?2,?3)",
            params![r.id, i as i64, row.to_string()],
        )?;
    }
    Ok(())
}

pub fn get_run_rows(conn: &Connection, run_id: &str) -> DbResult<Vec<Json>> {
    let mut stmt = conn.prepare("SELECT payload FROM prediction_results WHERE run_id = ?1 ORDER BY row_index ASC")?;
    let rows = stmt
        .query_map([run_id], |r| {
            let s: String = r.get(0)?;
            Ok(serde_json::from_str::<Json>(&s).unwrap_or(Json::Null))
        })?
        .collect::<DbResult<Vec<_>>>()?;
    Ok(rows)
}

/// Workspace counters for the Intelligence overview card.
pub struct WorkspaceStats {
    pub dataset_count: i64,
    pub model_count: i64,
    pub run_count: i64,
    pub last_run_at: Option<String>,
    pub last_model_name: Option<String>,
}

pub fn workspace_stats(conn: &Connection) -> DbResult<WorkspaceStats> {
    Ok(WorkspaceStats {
        dataset_count: conn.query_row("SELECT COUNT(*) FROM datasets", [], |r| r.get(0))?,
        model_count: conn.query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0))?,
        run_count: conn.query_row("SELECT COUNT(*) FROM prediction_runs", [], |r| r.get(0))?,
        last_run_at: conn
            .query_row("SELECT created_at FROM prediction_runs ORDER BY created_at DESC LIMIT 1", [], |r| r.get(0))
            .optional()?,
        last_model_name: conn
            .query_row("SELECT name FROM models ORDER BY created_at DESC LIMIT 1", [], |r| r.get(0))
            .optional()?,
    })
}

pub fn get_setting(conn: &Connection, key: &str) -> DbResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1,?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(name: &str) -> (Connection, tempfile_dir_guard::Guard) {
        let dir = tempfile_dir_guard::make(name);
        let conn = open(&dir.path.join("intelligence.db")).unwrap();
        (conn, dir)
    }

    mod tempfile_dir_guard {
        use std::path::PathBuf;

        pub struct Guard {
            pub path: PathBuf,
        }

        impl Drop for Guard {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.path);
            }
        }

        pub fn make(name: &str) -> Guard {
            let base = std::env::temp_dir()
                .join(format!("vf-db-test-{}-{}", name, std::process::id()));
            let _ = std::fs::remove_dir_all(&base);
            std::fs::create_dir_all(&base).unwrap();
            Guard { path: base }
        }
    }

    fn sample_dataset(id: &str) -> DatasetInsert {
        DatasetInsert {
            id: id.into(),
            name: "prices".into(),
            canonical_path: "/test/prices.csv".into(),
            original_name: "prices.csv".into(),
            original_path: "/x/prices.csv".into(),
            byte_size: 1234,
            row_count: 100,
            delimiter: ",".into(),
            encoding: "utf-8".into(),
            profile: serde_json::json!({"row_count": 100}),
            missing_total: 3,
            duplicate_rows: 1,
            imported_at: "2026-11-05T00:00:00Z".into(),
            columns: vec![ColumnMeta { name: "a".into(), dtype: "numeric".into(), missing: 3, missing_pct: 3.0, unique: 40 }],
        }
    }

    #[test]
    fn migrate_and_crud_roundtrip() {
        let (conn, _guard) = temp_db("crud");
        insert_dataset(&conn, &sample_dataset("d1")).unwrap();
        let ds = get_dataset(&conn, "d1").unwrap().unwrap();
        assert_eq!(ds.summary.row_count, 100);
        assert_eq!(ds.columns.len(), 1);
        assert_eq!(ds.columns[0].dtype, "numeric");
        assert!(get_dataset(&conn, "nope").unwrap().is_none());

        let all = list_datasets(&conn).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn delete_dataset_cascades() {
        let (conn, _guard) = temp_db("cascade");
        insert_dataset(&conn, &sample_dataset("d1")).unwrap();
        conn.execute("DELETE FROM datasets WHERE id='d1'", []).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM dataset_columns", [], |r| r.get::<_, i64>(0)).unwrap(),
            0
        );
    }

    #[test]
    fn model_insert_and_summary() {
        let (conn, _guard) = temp_db("models");
        insert_dataset(&conn, &sample_dataset("d1")).unwrap();
        insert_model(&conn, &ModelInsert {
            id: "m1".into(),
            name: "RF test".into(),
            dataset_id: Some("d1".into()),
            dataset_name: "prices".into(),
            task: "regression".into(),
            algorithm: "random_forest_regressor".into(),
            algorithm_label: "Random Forest Regressor".into(),
            target: Some("price".into()),
            features: vec!["area".into(), "rooms".into()],
            file_path: "/models/m1/model.joblib".into(),
            sha256: "abc".into(),
            metrics: serde_json::json!({"test_score": 0.87, "r2": 0.87}),
            comparison: Some(serde_json::json!([{"algorithm": "ridge", "score": 0.5}])),
            train_rows: Some(75),
            test_rows: Some(25),
            classes: None,
            n_clusters: None,
            test_size: Some(0.25),
            random_state: Some(42),
            duration_seconds: Some(1.2),
            bundle_version: Some(2),
            engine_version: Some("1.0.0".into()),
            created_at: "2026-11-05T00:00:01Z".into(),
        })
        .unwrap();
        let all = list_models(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].scoring_label.as_deref(), Some("R² (test)"));
        let (score) = all[0].scoring.unwrap();
        assert!((score - 0.87).abs() < 1e-9);
        let row = get_model_row(&conn, "m1").unwrap().unwrap();
        assert_eq!(row.sha256, "abc");
    }

    #[test]
    fn runs_store_rows_and_cascade() {
        let (conn, _guard) = temp_db("runs");
        struct Empty;
        insert_run(&conn, &RunInsert {
            id: "r1".into(),
            model_id: "m1".into(),
            model_name: "RF".into(),
            dataset_id: None,
            dataset_name: Some("batch.csv".into()),
            task: "regression".into(),
            record_count: 2,
            duration: Some(0.2),
            summary: "batch.csv".into(),
            results_path: Some("/p/r1.csv".into()),
            created_at: "2026-11-05T02:00:00Z".into(),
            rows: vec![serde_json::json!({"x": 1, "_prediction": 2.0}), serde_json::json!({"x": 2, "_prediction": 4.0})],
        })
        .unwrap();
        let runs = list_runs(&conn, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].record_count, 2);
        let rows = get_run_rows(&conn, "r1").unwrap();
        assert_eq!(rows.len(), 2);
        conn.execute("DELETE FROM prediction_runs WHERE id='r1'", []).unwrap();
        assert_eq!(get_run_rows(&conn, "r1").unwrap().len(), 0);
        drop(Empty);
    }

    #[test]
    fn stats_and_settings() {
        let (conn, _guard) = temp_db("stats");
        let s = workspace_stats(&conn).unwrap();
        assert_eq!(s.dataset_count, 0);
        set_setting(&conn, "last_model", "m1").unwrap();
        assert_eq!(get_setting(&conn, "last_model").unwrap().as_deref(), Some("m1"));
    }
}
