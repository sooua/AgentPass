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
            // this WebView2 environment. Strip WS_CAPTION directly off the HWND —
            // this definitively removes the OS title bar while keeping WS_THICKFRAME
            // (resize). The custom titlebar is drawn in the web UI.
            #[cfg(windows)]
            strip_native_caption(&win);
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
    match win.hwnd() {
        Ok(hwnd) => {
            let h = hwnd.0 as *mut core::ffi::c_void;
            unsafe {
                let style = GetWindowLongPtrW(h, GWL_STYLE);
                let new = style & !(WS_CAPTION as isize);
                SetWindowLongPtrW(h, GWL_STYLE, new);
                SetWindowPos(
                    h,
                    core::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
                );
                let after = GetWindowLongPtrW(h, GWL_STYLE);
                eprintln!(
                    "[agentpass] strip caption: hwnd={:?} style {:#x} -> req {:#x} -> after {:#x}",
                    h, style, new, after
                );
            }
        }
        Err(e) => eprintln!("[agentpass] hwnd() failed: {e}"),
    }
}
