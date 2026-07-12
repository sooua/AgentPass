#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("agentpass")
                .inner_size(1200.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .decorations(false)
                .build()?;

            // Tauri's decorations(false) does not remove the native title bar in
            // this WebView2 env, and WebView2 re-applies WS_CAPTION after the
            // initial strip. So strip once now and again on window events (the
            // guard makes it a no-op once the caption is already gone).
            #[cfg(windows)]
            {
                strip_native_caption(&win);
                let w = win.clone();
                win.on_window_event(move |event| {
                    use tauri::WindowEvent::{Focused, Resized};
                    if matches!(event, Focused(_) | Resized(_)) {
                        strip_native_caption(&w);
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running agentpass desktop");
}

#[cfg(windows)]
fn strip_native_caption(win: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CAPTION,
    };
    let Ok(hwnd) = win.hwnd() else { return };
    let h = hwnd.0 as *mut core::ffi::c_void;
    unsafe {
        let style = GetWindowLongPtrW(h, GWL_STYLE);
        if style & (WS_CAPTION as isize) == 0 {
            return; // caption already stripped — avoid an event loop
        }
        SetWindowLongPtrW(h, GWL_STYLE, style & !(WS_CAPTION as isize));
        SetWindowPos(
            h,
            core::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );
    }
}
