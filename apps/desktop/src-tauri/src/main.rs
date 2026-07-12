// agentpass desktop shell — thin Tauri 2 window around the React frontend.
// The frontend talks to the local daemon over HTTP (127.0.0.1); no secret
// logic lives in the shell. Frameless: no native OS title bar (custom titlebar
// is drawn in the web UI).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Enforce frameless in code too, not just tauri.conf, so the native
            // Windows title bar never appears regardless of config quirks.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_decorations(false);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running agentpass desktop");
}
