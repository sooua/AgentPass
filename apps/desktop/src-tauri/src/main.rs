// agentpass desktop shell — thin Tauri 2 window around the React frontend.
// The frontend talks to the local daemon over HTTP (127.0.0.1:4747); no secret
// logic lives in the shell.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running agentpass desktop");
}
