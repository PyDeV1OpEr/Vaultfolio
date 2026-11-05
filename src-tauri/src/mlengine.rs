//! Bundled Python ML engine process management.
//!
//! The engine is a long-lived CPython process (from `Resources/ml-engine`,
//! resolved through an absolute, verified application-resource path) speaking
//! NDJSON over stdin/stdout. Requests FROM the renderer only ever reference
//! entity ids; the renderer never supplies filesystem paths to read.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

pub const PROGRESS_EVENT: &str = "intel-progress";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

/// CPU guard rails: treat BLAS/OMP thread pools as single-digit thread counts.
fn sanitized_env(data_dir: &Path, service_dir: &Path) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = HashMap::new();
    for key in ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"] {
        env.insert(key.to_string(), "4".into());
    }
    env.insert("PYTHONPATH".into(), service_dir.to_string_lossy().to_string());
    env.insert("PYTHONDONTWRITEBYTECODE".into(), "1".into());
    env.insert(
        "PYTHONPYCACHEPREFIX".into(),
        data_dir.join("pycache").to_string_lossy().to_string(),
    );
    // Homebrew / system pythons must never be consulted.
    for key in ["PYTHONHOME", "PYPATH", "VIRTUAL_ENV"] {
        env.remove(key);
    }
    env
}

pub struct EngineConfig {
    /// Absolute path of the bundled interpreter (Resources/ml-engine/runtime/bin/python3)
    pub python: PathBuf,
    /// Directory containing the ml_engine package
    pub service_dir: PathBuf,
    /// App data dir where the engine may write scratch + pycache
    pub data_dir: PathBuf,
}

pub fn resolve_engine(app: &AppHandle) -> Result<EngineConfig, String> {
    // Production: Contents/Resources/ml-engine — the resolved resource dir is
    // absolute and verified by Tauri. Dev: fall back to the sibling checkout.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not locate application resources: {}", e))?;
    let candidates: Vec<PathBuf> = vec![
        resource_dir.join("ml-engine"),
        app.path()
            .resolve(".", tauri::path::BaseDirectory::Executable)
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("ml-engine")))
            .unwrap_or_else(|| PathBuf::from("ml-engine")),
        std::env::current_dir().ok().and_then(|p| Some(p.join("ml-engine"))).unwrap_or_default(),
    ];

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let mut candidates = candidates.clone();
    if let Some(d) = exe_dir {
        candidates.insert(1, d.join("ml-engine"));
    }

    for root in candidates {
        let python = root.join("runtime/bin/python3");
        let service = root.join("service/ml_engine");
        if python.is_file() && service.is_dir() {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            return Ok(EngineConfig {
                python: python.canonicalize().unwrap_or(python),
                service_dir: root.join("service"),
                data_dir,
            });
        }
        // Also accept a VAULTFOLIO_ML_ENGINE override passed via env.
    }
    if let Ok(env_root) = std::env::var("VAULTFOLIO_ML_ENGINE") {
        let root = PathBuf::from(env_root);
        let python = root.join("runtime/bin/python3");
        let service = root.join("service/ml_engine");
        if python.is_file() && service.is_dir() {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
            return Ok(EngineConfig {
                python,
                service_dir: root.join("service"),
                data_dir,
            });
        }
    }
    Err(
        "The bundled Intelligence engine was not found. Looked for ml-engine/runtime next to the application resources and executable."
            .to_string(),
    )
}

#[derive(Debug)]
struct Request {
    id: u64,
    cmd: String,
    args: Value,
    reply: mpsc::SyncSender<Value>,
}

pub struct Engine {
    send: mpsc::Sender<Request>,
    next_id: AtomicU64,
    child_pid: Arc<Mutex<Option<u32>>>,
    alive: Arc<AtomicBool>,
}

impl Drop for Engine {
    fn drop(&mut self) {
        // Dropping closes the writer channel; the reader loop then terminates
        // stdin and waits for the child, closing it down cleanly.
        let pid = *self.child_pid.lock().unwrap();
        if let Some(pid) = pid {
            std::thread::spawn(move || {
                // nudge in case the engine is stuck mid-computation
                unsafe { libc_kill(pid) };
            });
        }
    }
}

unsafe fn libc_kill(pid: u32) {
    #[cfg(target_family = "unix")]
    {
        std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .ok();
    }
}

impl Engine {
    pub fn start(app: &AppHandle, cfg: EngineConfig) -> Result<Engine, String> {
        std::fs::create_dir_all(&cfg.data_dir).ok();
        let env = sanitized_env(&cfg.data_dir, &cfg.service_dir);

        let mut child = std::process::Command::new(&cfg.python)
            .args(["-I", "-u", "-B", "-m", "ml_engine.service"])
            .current_dir(&cfg.service_dir)
            .env_clear()
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start the bundled Python engine: {}", e))?;

        // Drain stderr so a chatty process can never block on a full pipe.
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    let _ = line;
                }
            });
        }

        let stdout = child.stdout.take().expect("engine stdout");
        let stdin = child.stdin.take().expect("engine stdin");
        let pid = child.id();
        let pid_slot: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
        let alive: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));

        let (send, recv) = mpsc::channel::<Request>();
        let registry: Arc<Mutex<HashMap<u64, mpsc::SyncSender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        *pid_slot.lock().unwrap() = Some(pid);

        let registry_cc = registry.clone();
        let alive_writer = alive.clone();
        std::thread::spawn(move || {
            let mut stdin = Some(stdin);
            for req in recv {
                if stdin.is_none() {
                    break;
                }
                // Register the reply channel BEFORE the line is written — a
                // fast response would otherwise race the registration and get
                // dropped, leaving the UI hinting forever.
                registry_cc.lock().unwrap().insert(req.id, req.reply);
                let line = json!({"id": req.id, "cmd": req.cmd, "args": req.args});
                if let Err(e) = writeln!(stdin.as_mut().unwrap(), "{}", line) {
                    if let Some(reply) = registry_cc.lock().unwrap().remove(&req.id) {
                        let _ = reply.try_send(json!({"ok": false, "error": format!("Engine pipe error: {}", e)}));
                    }
                    stdin = None;
                    alive_writer.store(false, Ordering::SeqCst);
                    break;
                }
                let _ = stdin.as_mut().unwrap().flush();
            }
        });

        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                match msg.get("type").and_then(Value::as_str) {
                    Some("progress") => {
                        // Progress delivery is best-effort.
                        let _ = app_handle.emit(PROGRESS_EVENT, msg);
                    }
                    Some("result") => {
                        if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                            let reply = registry.lock().unwrap().remove(&id);
                            if let Some(tx) = reply {
                                let _ = tx.try_send(msg);
                            }
                        }
                    }
                    _ => {} // “ready” and heartbeat lines carry no data
                }
            }
        });

        std::thread::spawn(move || {
            // watchdog: reap the child even if the UI exits via a path that
            // drains events before the destructor.
            let _ = child.wait();
        });

        Ok(Engine {
            send,
            next_id: AtomicU64::new(1),
            child_pid: pid_slot.clone(),
            alive,
        })
    }

    pub fn is_ready(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Send a request to the engine and await its JSON response.
    /// Requests are processed one-at-a-time by the Python process; concurrent
    /// UI calls are serialized on a Mutex in the command layer.
    pub fn request(&self, cmd: &str, args: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::sync_channel::<Value>(1);
        self.send
            .send(Request { id, cmd: cmd.to_string(), args, reply: tx })
            .map_err(|_| "The Intelligence engine has stopped.".to_string())?;
        let msg = rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|e| format!("The Intelligence engine did not respond ({}).", e))?;
        if msg.get("ok").and_then(Value::as_bool) == Some(false) {
            let error = msg
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Unknown engine error.")
                .to_string();
            return Err(error);
        }
        Ok(msg.get("result").cloned().unwrap_or(Value::Null))
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProgressPayload {
    pub stage: String,
    pub pct: i64,
    pub message: String,
}
