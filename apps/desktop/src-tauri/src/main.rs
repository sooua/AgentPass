#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Build the window in Rust with decorations OFF from creation — the
            // most reliable way to get a frameless window on Windows (config
            // `decorations:false` and post-hoc set_decorations did not remove the
            // native title bar in this WebView2 environment). Custom titlebar is
            // drawn in the web UI.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("agentpass")
                .inner_size(1200.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .decorations(false)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running agentpass desktop");
}
