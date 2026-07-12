#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            match app.get_webview_window("main") {
                Some(win) => {
                    if let Err(e) = win.set_decorations(false) {
                        eprintln!("[agentpass] set_decorations failed: {e}");
                    } else {
                        eprintln!("[agentpass] decorations disabled at runtime");
                    }
                }
                None => eprintln!("[agentpass] no 'main' window in setup"),
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running agentpass desktop");
}
