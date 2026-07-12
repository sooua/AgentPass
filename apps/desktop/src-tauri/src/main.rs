// agentpass desktop shell — thin Tauri 2 window around the React frontend.
// Frameless via `decorations: false` on the labelled "main" window in
// tauri.conf.json. Exposes daemon_conn so the UI auto-connects to the local
// daemon (reads the url+token the daemon publishes to ~/.agentpass/conn.json).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn daemon_conn(app: tauri::AppHandle) -> Result<String, String> {
    let home = match std::env::var("AGENTPASS_HOME") {
        Ok(h) => std::path::PathBuf::from(h),
        Err(_) => app.path().home_dir().map_err(|e| e.to_string())?.join(".agentpass"),
    };
    std::fs::read_to_string(home.join("conn.json")).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![daemon_conn])
        .run(tauri::generate_context!())
        .expect("error while running agentpass desktop");
}
