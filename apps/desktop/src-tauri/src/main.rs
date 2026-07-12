// agentpass desktop shell — thin Tauri 2 window around the React frontend.
// The frontend talks to the local daemon over HTTP (127.0.0.1); no secret
// logic lives in the shell. Frameless: `decorations: false` in tauri.conf.json
// removes the native OS title bar (a custom titlebar is drawn in the web UI).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running agentpass desktop");
}
