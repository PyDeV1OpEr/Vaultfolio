//! Library entry so the same shell can be reused for mobile targets.
//!
//! The frontend is the existing self-contained SPA (React + Supabase JS
//! client). On top of that shell, the Intelligence workspace adds:
//! • a dedicated SQLite metadata store (own database file, never the vault)
//! • a bundled Python ML engine sidecar started from the application resources
//! • explicit, validated IPC commands only — no arbitrary renderer access

pub mod commands;
pub mod db;
pub mod mlengine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Manager, WindowEvent};

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle();
            let data_root = handle
                .path()
                .app_data_dir()
                .expect("No app data directory is available for this platform.");
            let intel_dir = data_root.join("intelligence");
            std::fs::create_dir_all(&intel_dir)?;
            for dir in ["datasets", "models", "predictions", "pycache"] {
                std::fs::create_dir_all(intel_dir.join(dir))?;
            }

            let conn = crate::db::open(&intel_dir.join("intelligence.db"))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("intelligence db: {}", e)))?;
            app.manage(crate::commands::Db(std::sync::Mutex::new(conn)));

            let cfg = crate::mlengine::resolve_engine(handle)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, format!("ml engine: {}", e)))?;
            let engine = crate::mlengine::Engine::start(handle, cfg)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("ml engine start: {}", e)))?;
            app.manage(engine);

            app.manage(crate::commands::IntelPaths(intel_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::intel_engine_status,
            crate::commands::intel_workspace_stats,
            crate::commands::intel_import_csv,
            crate::commands::intel_get_dataset,
            crate::commands::intel_list_datasets,
            crate::commands::intel_delete_dataset,
            crate::commands::intel_preview,
            crate::commands::intel_column_stats,
            crate::commands::intel_sample_catalog,
            crate::commands::intel_seed_samples,
            crate::commands::intel_train,
            crate::commands::intel_list_models,
            crate::commands::intel_get_model,
            crate::commands::intel_rename_model,
            crate::commands::intel_delete_model,
            crate::commands::intel_predict,
            crate::commands::intel_list_runs,
            crate::commands::intel_get_run,
            crate::commands::intel_delete_run,
            crate::commands::intel_clear_runs,
            crate::commands::intel_export,
            crate::commands::intel_pick_csv,
            crate::commands::intel_pick_save_path,
            crate::commands::intel_docs,
        ])
        .build(tauri::generate_context!())
        .expect("Vaultfolio desktop failed to initialize");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Exit => {
            // Kill the Python sidecar explicitly on exit; a healthy engine
            // exits on EOF from the writer channel, but a stuck call must not
            // outlive the app.
            if let Some(engine) = app_handle.try_state::<crate::mlengine::Engine>() {
                let _ = engine.request("__shutdown", serde_json::json!({}));
            }
        }
        tauri::RunEvent::WindowEvent {
            event: WindowEvent::Destroyed,
            ..
        } => {
            if let Some(engine) = app_handle.try_state::<crate::mlengine::Engine>() {
                let _ = engine.request("__shutdown", serde_json::json!({}));
            }
        }
        _ => {}
    });
}
