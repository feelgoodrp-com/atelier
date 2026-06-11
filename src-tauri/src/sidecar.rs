//! Sidecar lifecycle management for the fg-atelier-sidecar process.
//!
//! The sidecar is a .NET binary (built by `sidecar/publish.ps1`) that is
//! spawned on app startup with a per-session auth token. It announces
//! readiness by printing `FG_SIDECAR_READY port=N` on stdout. We keep
//! `{ port, token }` in managed state so the frontend can talk to it
//! directly over HTTP (header `x-fg-atelier-token`).

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tracing::{debug, error, info, warn};

/// Name of the sidecar binary as configured in `bundle.externalBin`
/// (tauri-build copies `binaries/fg-atelier-sidecar-<triple>.exe` next to
/// the app executable as `fg-atelier-sidecar.exe`).
const SIDECAR_PROGRAM: &str = "fg-atelier-sidecar";

/// Respawn backoff schedule (then give up).
const BACKOFF: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(3),
    Duration::from_secs(10),
];

/// Event name used to push status changes to the webview.
pub const STATUS_EVENT: &str = "sidecar://status";

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum SidecarStatus {
    /// Process spawned, waiting for the READY line (or about to respawn).
    Connecting,
    /// READY line parsed, port known.
    Ready,
    /// The binary could not be spawned at all (missing / not built yet).
    Unavailable,
    /// Crashed repeatedly, gave up after max respawn attempts.
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarInfo {
    pub status: SidecarStatus,
    pub port: Option<u16>,
    /// Per-session token the frontend must send as `x-fg-atelier-token`.
    pub token: Option<String>,
    /// Human readable detail (German, shown in tooltips).
    pub detail: Option<String>,
}

pub struct SidecarState {
    /// Per-session shared secret, generated once at startup.
    token: String,
    info: Mutex<SidecarInfo>,
    child: Mutex<Option<CommandChild>>,
    /// Consecutive crash count (reset on a successful READY line / manual restart).
    crash_count: Mutex<u32>,
    /// Generation counter: bumped on every manual restart so stale watchdog
    /// tasks from a previous child don't respawn over a newer one.
    generation: Mutex<u64>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            token: generate_token(),
            info: Mutex::new(SidecarInfo {
                status: SidecarStatus::Connecting,
                port: None,
                token: None,
                detail: Some("Sidecar startet…".into()),
            }),
            child: Mutex::new(None),
            crash_count: Mutex::new(0),
            generation: Mutex::new(0),
        }
    }

    pub fn kill_child(&self) {
        if let Some(child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

/// 32 random bytes, hex encoded (64 chars).
fn generate_token() -> String {
    let bytes: [u8; 32] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn set_info(app: &AppHandle, update: impl FnOnce(&mut SidecarInfo)) {
    let state = app.state::<SidecarState>();
    let snapshot = {
        let mut info = state.info.lock().unwrap();
        update(&mut info);
        info.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
}

/// Spawn the sidecar and attach the watchdog. Safe to call again after a
/// crash or for a manual restart (the previous child must be gone already).
pub fn spawn_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let token = state.token.clone();
    let generation = *state.generation.lock().unwrap();

    info!(target: "sidecar", generation, "spawning sidecar process");

    set_info(app, |i| {
        i.status = SidecarStatus::Connecting;
        i.port = None;
        i.token = None;
        i.detail = Some("Sidecar startet…".into());
    });

    let command = match app.shell().sidecar(SIDECAR_PROGRAM) {
        Ok(cmd) => cmd
            .env("FG_SIDECAR_TOKEN", &token)
            // Lets the sidecar exit on its own when this process dies
            // ungracefully (crash/taskkill) — prevents orphaned processes
            // that keep the target/debug binary locked.
            .env("FG_SIDECAR_PARENT_PID", std::process::id().to_string()),
        Err(e) => {
            log_unavailable(app, &format!("sidecar command error: {e}"));
            return;
        }
    };

    let (mut rx, child) = match command.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            // Binary missing or not a valid executable (e.g. the 0-byte dev
            // placeholder). Do not crash and do not retry — show a hint.
            log_unavailable(app, &format!("sidecar spawn failed: {e}"));
            return;
        }
    };

    *state.child.lock().unwrap() = Some(child);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    let line = line.trim();
                    if let Some(port) = parse_ready_line(line) {
                        info!(target: "sidecar", port, "sidecar ready");
                        let state = app.state::<SidecarState>();
                        *state.crash_count.lock().unwrap() = 0;
                        let token = state.token.clone();
                        set_info(&app, |i| {
                            i.status = SidecarStatus::Ready;
                            i.port = Some(port);
                            i.token = Some(token);
                            i.detail = Some(format!("Sidecar verbunden (Port {port})"));
                        });
                    } else if !line.is_empty() {
                        info!(target: "sidecar::stdout", "{line}");
                    }
                }
                CommandEvent::Stderr(line) => {
                    // The .NET sidecar routes its regular ASP.NET logging to
                    // stderr (stdout is reserved for the READY handshake).
                    debug!(target: "sidecar::stderr", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Error(err) => {
                    error!(target: "sidecar", "command error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    handle_termination(&app, generation, payload.code);
                    break;
                }
                // CommandEvent is #[non_exhaustive]
                _ => {}
            }
        }
    });
}

fn log_unavailable(app: &AppHandle, reason: &str) {
    error!(target: "sidecar", "{reason}");
    set_info(app, |i| {
        i.status = SidecarStatus::Unavailable;
        i.port = None;
        i.token = None;
        i.detail = Some("Sidecar nicht gefunden — sidecar/publish.ps1 ausführen".into());
    });
}

/// `FG_SIDECAR_READY port=N`
fn parse_ready_line(line: &str) -> Option<u16> {
    let rest = line.strip_prefix("FG_SIDECAR_READY")?.trim();
    rest.strip_prefix("port=")?.trim().parse::<u16>().ok()
}

fn handle_termination(app: &AppHandle, generation: u64, code: Option<i32>) {
    let state = app.state::<SidecarState>();

    // A manual restart (or shutdown) bumped the generation: this watchdog
    // belongs to an old child, do nothing.
    if *state.generation.lock().unwrap() != generation {
        return;
    }

    state.child.lock().unwrap().take();

    let attempt = {
        let mut count = state.crash_count.lock().unwrap();
        *count += 1;
        *count
    };

    warn!(
        target: "sidecar",
        code = ?code,
        attempt,
        max_attempts = BACKOFF.len(),
        "sidecar terminated unexpectedly"
    );

    if attempt as usize > BACKOFF.len() {
        error!(target: "sidecar", "giving up after {} respawn attempts", BACKOFF.len());
        set_info(app, |i| {
            i.status = SidecarStatus::Error;
            i.port = None;
            i.token = None;
            i.detail = Some("Sidecar mehrfach abgestürzt — Neustart in den Einstellungen".into());
        });
        return;
    }

    let delay = BACKOFF[(attempt as usize) - 1];
    set_info(app, |i| {
        i.status = SidecarStatus::Connecting;
        i.port = None;
        i.token = None;
        i.detail = Some(format!(
            "Sidecar abgestürzt — Neustart in {}s (Versuch {attempt}/{})",
            delay.as_secs(),
            BACKOFF.len()
        ));
    });

    let app = app.clone();
    // Plain thread for the backoff sleep — keeps us independent of the
    // async runtime's timer features.
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let state = app.state::<SidecarState>();
        if *state.generation.lock().unwrap() != generation {
            return; // superseded by manual restart meanwhile
        }
        spawn_sidecar(&app);
    });
}

#[tauri::command]
pub fn get_sidecar_info(state: tauri::State<'_, SidecarState>) -> SidecarInfo {
    state.info.lock().unwrap().clone()
}

#[tauri::command]
pub fn restart_sidecar(app: AppHandle) {
    info!(target: "sidecar", "manual restart requested");
    let state = app.state::<SidecarState>();
    // Invalidate any pending watchdog/backoff tasks of the old child.
    *state.generation.lock().unwrap() += 1;
    *state.crash_count.lock().unwrap() = 0;
    state.kill_child();
    spawn_sidecar(&app);
}
