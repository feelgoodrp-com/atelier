mod logging;
mod secrets;
mod sidecar;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceInfo {
    name: String,
    platform: String,
    app_version: String,
}

/// Basic device metadata used for the auth device-exchange payload.
#[tauri::command]
fn get_device_info(app: tauri::AppHandle) -> DeviceInfo {
    let name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Unbekanntes Gerät".into());
    DeviceInfo {
        name,
        platform: "windows".into(),
        app_version: app.package_info().version.to_string(),
    }
}

/// Forward a frontend log line into the tracing pipeline (target `webview`),
/// so React logs land in the same console + rotating log files as Rust logs.
#[tauri::command]
fn frontend_log(level: String, message: String, context: Option<serde_json::Value>) {
    let context = context.map(|c| c.to_string());
    let context = context.as_deref().unwrap_or("");
    match level.as_str() {
        "error" => tracing::error!(target: "webview", %context, "{message}"),
        "warn" => tracing::warn!(target: "webview", %context, "{message}"),
        "debug" => tracing::debug!(target: "webview", %context, "{message}"),
        _ => tracing::info!(target: "webview", %context, "{message}"),
    }
}

/// Where the rotating log files live — shown in the settings screen.
#[tauri::command]
fn get_log_dir(app: tauri::AppHandle) -> Option<String> {
    app.path().app_log_dir().ok().map(|p| p.display().to_string())
}

/// Opens (or focuses) the live log console as its OWN window.
/// MUST be async: synchronous window creation deadlocks the main event loop
/// on Windows (documented wry/Tauri gotcha) — the new webview stays white
/// and window dragging breaks while it is open.
#[tauri::command]
async fn open_log_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("logs") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    // Plain app URL — the frontend decides what to render from the WINDOW
    // LABEL (query strings in WebviewUrl::App get path-encoded and 404).
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "logs",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("atelier — Echtzeit-Log")
    .inner_size(980.0, 560.0)
    .min_inner_size(640.0, 320.0)
    .decorations(false)
    .transparent(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Same glass look as the main window.
    use tauri::window::{Effect, EffectsBuilder};
    let _ = window.set_effects(
        EffectsBuilder::new()
            .effect(Effect::Acrylic)
            .effect(Effect::Tabbed)
            .effect(Effect::Mica)
            .effect(Effect::Blur)
            .build(),
    );
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // single-instance must be the first registered plugin
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        // In-app auto-updater. Checks the GitHub-releases `latest.json`, verifies
        // the downloaded installer against the bundled public key, then runs it.
        // Relaunch after install goes through the process plugin above.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_oauth::init())
        .manage(sidecar::SidecarState::new())
        .invoke_handler(tauri::generate_handler![
            sidecar::get_sidecar_info,
            sidecar::restart_sidecar,
            get_device_info,
            frontend_log,
            get_log_dir,
            open_log_window,
            logging::get_log_buffer,
            logging::set_log_stream,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete
        ])
        .setup(|app| {
            logging::init(app.handle());
            tracing::info!(version = %app.package_info().version, "atelier starting");

            // Re-apply the window effects at runtime and LOG the result — the
            // declarative config gives no feedback when an effect silently
            // fails on a given Windows build.
            if let Some(window) = app.get_webview_window("main") {
                use tauri::window::{Effect, EffectsBuilder};
                let effects = EffectsBuilder::new()
                    .effect(Effect::Acrylic)
                    .effect(Effect::Tabbed)
                    .effect(Effect::Mica)
                    .effect(Effect::Blur)
                    .build();
                match window.set_effects(effects) {
                    Ok(()) => tracing::info!("window effects applied (acrylic/tabbed/mica/blur)"),
                    Err(e) => tracing::warn!("window effects could not be applied: {e}"),
                }
            }

            sidecar::spawn_sidecar(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Exit => {
            tracing::info!("app exiting — killing sidecar");
            // Make sure the sidecar process dies with the app.
            let state = app_handle.state::<sidecar::SidecarState>();
            state.kill_child();
        }
        // Backstop: stop streaming log events when the log window dies
        // without unmounting cleanly (e.g. killed via taskbar).
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == "logs" => {
            if let Some(stream) = app_handle.try_state::<std::sync::Arc<logging::LogStream>>() {
                stream.set_streaming(false);
            }
        }
        _ => {}
    });
}
