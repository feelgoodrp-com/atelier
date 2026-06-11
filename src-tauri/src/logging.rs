//! Structured logging via the `tracing` ecosystem.
//!
//! Two sinks:
//! - Console (compact, colored) — what you see in `bun run tauri dev`.
//! - Daily-rotated plain-text files in the app log dir
//!   (`%LOCALAPPDATA%\com.feelgood.atelier\logs\atelier.YYYY-MM-DD.log`),
//!   14 files retained.
//!
//! Filtering uses `RUST_LOG` (tracing `EnvFilter` syntax). Targets:
//! - `atelier_lib` — app/Rust code
//! - `sidecar`     — sidecar lifecycle, `sidecar::stdout` / `sidecar::stderr`
//!                   for the .NET process output
//! - `webview`     — events forwarded from the React frontend (`frontend_log`)
//!
//! Example: `RUST_LOG=warn,sidecar=debug bun run tauri dev`

use std::cell::Cell;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tracing::field::{Field, Visit};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::layer::Context;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

const DEFAULT_FILTER: &str = "info,atelier_lib=debug,sidecar=debug,webview=debug";
const MAX_LOG_FILES: usize = 14;
const LOG_BUFFER_CAP: usize = 1000;

/// Keeps the non-blocking file writer's flush thread alive for the app
/// lifetime (dropping the guard would silently stop file logging).
pub struct LogGuard(#[allow(dead_code)] Mutex<Option<WorkerGuard>>);

// ---------------------------------------------------------------------------
// Live log console: every tracing event lands in a ring buffer (history for
// a freshly opened console) and — while a console is open — is also emitted
// to the webview as a "log://entry" event.
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Unix epoch milliseconds (frontend formats the time).
    pub ts: u64,
    pub level: String,
    pub target: String,
    pub message: String,
}

pub struct LogStream {
    streaming: AtomicBool,
    buffer: Mutex<VecDeque<LogEntry>>,
}

impl LogStream {
    fn new() -> Self {
        Self {
            streaming: AtomicBool::new(false),
            buffer: Mutex::new(VecDeque::with_capacity(LOG_BUFFER_CAP)),
        }
    }

    pub fn set_streaming(&self, enabled: bool) {
        self.streaming.store(enabled, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn get_log_buffer(state: tauri::State<'_, Arc<LogStream>>) -> Vec<LogEntry> {
    state.buffer.lock().unwrap().iter().cloned().collect()
}

/// Enables/disables forwarding to the webview (the buffer always fills).
#[tauri::command]
pub fn set_log_stream(state: tauri::State<'_, Arc<LogStream>>, enabled: bool) {
    state.streaming.store(enabled, Ordering::Relaxed);
}

/// Collects the `message` field (+ any extra fields as `key=value`).
#[derive(Default)]
struct MessageVisitor {
    message: String,
    extras: String,
}

impl Visit for MessageVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            self.extras.push_str(&format!(" {}={}", field.name(), value));
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{value:?}");
        } else {
            self.extras.push_str(&format!(" {}={:?}", field.name(), value));
        }
    }
}

thread_local! {
    /// Re-entrancy guard: anything we call here (emit) must never feed
    /// another event back into this layer on the same thread.
    static IN_LOG_LAYER: Cell<bool> = const { Cell::new(false) };
}

struct WebviewLayer {
    app: AppHandle,
    stream: Arc<LogStream>,
}

impl<S: tracing::Subscriber> Layer<S> for WebviewLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        if IN_LOG_LAYER.with(|g| g.replace(true)) {
            return;
        }
        let meta = event.metadata();
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let entry = LogEntry {
            ts: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            level: meta.level().to_string(),
            target: meta.target().to_string(),
            message: format!("{}{}", visitor.message, visitor.extras),
        };
        {
            let mut buffer = self.stream.buffer.lock().unwrap();
            if buffer.len() >= LOG_BUFFER_CAP {
                buffer.pop_front();
            }
            buffer.push_back(entry.clone());
        }
        if self.stream.streaming.load(Ordering::Relaxed) {
            let _ = self.app.emit("log://entry", &entry);
        }
        IN_LOG_LAYER.with(|g| g.set(false));
    }
}

/// Initialize the global tracing subscriber. Must be called once, early in
/// `setup`. Failures degrade gracefully (console-only or no-op) — logging
/// must never prevent the app from starting.
pub fn init(app: &AppHandle) {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));

    let console_layer = fmt::layer().compact();

    // Live console feed (ring buffer + optional webview stream).
    let stream = Arc::new(LogStream::new());
    app.manage(stream.clone());
    let webview_layer = WebviewLayer {
        app: app.clone(),
        stream,
    };

    let file = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("app log dir unavailable: {e}"))
        .and_then(|dir| {
            std::fs::create_dir_all(&dir).map_err(|e| format!("create log dir: {e}"))?;
            let appender = RollingFileAppender::builder()
                .rotation(Rotation::DAILY)
                .filename_prefix("atelier")
                .filename_suffix("log")
                .max_log_files(MAX_LOG_FILES)
                .build(&dir)
                .map_err(|e| format!("file appender: {e}"))?;
            Ok((dir, appender))
        });

    match file {
        Ok((dir, appender)) => {
            let (writer, guard) = tracing_appender::non_blocking(appender);
            let file_layer = fmt::layer().with_ansi(false).with_writer(writer);
            if tracing_subscriber::registry()
                .with(filter)
                .with(console_layer)
                .with(file_layer)
                .with(webview_layer)
                .try_init()
                .is_err()
            {
                eprintln!("[logging] tracing subscriber was already initialized");
                return;
            }
            app.manage(LogGuard(Mutex::new(Some(guard))));
            tracing::info!(log_dir = %dir.display(), "logging initialized (console + file)");
        }
        Err(reason) => {
            // No file sink — still get console logs.
            if tracing_subscriber::registry()
                .with(filter)
                .with(console_layer)
                .with(webview_layer)
                .try_init()
                .is_err()
            {
                eprintln!("[logging] tracing subscriber was already initialized");
                return;
            }
            tracing::warn!(reason, "logging initialized console-only (no log file)");
        }
    }
}
