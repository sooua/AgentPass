// agentpass desktop shell — thin Tauri 2 window around the React frontend.
// Frameless via `decorations: false` on the labelled "main" window in
// tauri.conf.json. Exposes daemon_conn so the UI auto-connects to the local
// daemon (reads the url+token the daemon publishes to ~/.agentpass/conn.json).
//
// The installer ships the daemon as a bundled resource (resources/daemon.mjs,
// built by apps/daemon/build.mjs) and this shell starts it on launch, so a
// fresh install works without a terminal. If a daemon is already listening
// (someone ran `pnpm daemon`), we attach to that one instead of starting a second.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent};

/// The spawned daemon, kept so we can kill it when the window closes, plus the
/// reason we could not start one (surfaced to the UI by `daemon_error`).
#[derive(Default)]
struct Daemon {
    child: Mutex<Option<Child>>,
    error: Mutex<Option<String>>,
}

fn agentpass_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    match std::env::var("AGENTPASS_HOME") {
        Ok(h) => Ok(PathBuf::from(h)),
        Err(_) => Ok(app.path().home_dir().map_err(|e| e.to_string())?.join(".agentpass")),
    }
}

#[tauri::command]
fn daemon_conn(app: tauri::AppHandle) -> Result<String, String> {
    std::fs::read_to_string(agentpass_home(&app)?.join("conn.json")).map_err(|e| e.to_string())
}

/// Empty unless startup failed — the UI shows it instead of a bare "Failed to fetch".
/// Spawning can succeed and the daemon still die a moment later (too old a Node,
/// port in use), so a child that has already exited counts as a failure too and
/// brings back the tail of its log. stdout is discarded, so no token can leak here.
#[tauri::command]
fn daemon_error(app: tauri::AppHandle, state: tauri::State<'_, Daemon>) -> Option<String> {
    if let Some(e) = state.error.lock().ok()?.clone() {
        return Some(e);
    }
    let mut child = state.child.lock().ok()?;
    match child.as_mut()?.try_wait() {
        Ok(Some(status)) => Some(format!("daemon exited ({status}). {}", log_tail(&app))),
        _ => None,
    }
}

fn log_tail(app: &tauri::AppHandle) -> String {
    let path = match agentpass_home(app) {
        Ok(h) => h.join("daemon.log"),
        Err(e) => return e,
    };
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let tail: Vec<&str> = text.lines().rev().take(6).collect();
    if tail.is_empty() {
        return format!("See {}", path.display());
    }
    tail.into_iter().rev().collect::<Vec<_>>().join(" ")
}

fn daemon_port() -> u16 {
    std::env::var("AGENTPASS_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4747)
}

/// True when something already answers on the loopback port — an externally
/// started daemon we should attach to rather than duplicate.
fn already_running(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// Node interpreters to try, in order. A macOS app launched from Finder inherits
/// a bare PATH, so `node` alone misses Homebrew/nvm installs.
fn node_candidates() -> Vec<PathBuf> {
    let mut c = vec![PathBuf::from("node")];
    if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
        c.extend(
            ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].iter().map(PathBuf::from),
        );
        if let Ok(home) = std::env::var("HOME") {
            // nvm's "current" symlink when the user has one; version dirs are not scanned.
            c.push(PathBuf::from(&home).join(".nvm/current/bin/node"));
        }
    }
    c
}

/// Tauri hands back Windows paths in verbatim form (`\\?\D:\…`); Node's module
/// resolver chokes on that, so drop the prefix for ordinary drive paths. Verbatim
/// UNC (`\\?\UNC\…`) is left alone — stripping it would break the path.
fn denormalize(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().into_owned();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => p,
    }
}

fn spawn_daemon(app: &tauri::AppHandle) -> Result<Child, String> {
    let script = denormalize(
        app.path()
            .resolve("resources/daemon.mjs", BaseDirectory::Resource)
            .map_err(|e| format!("bundled daemon not found: {e}"))?,
    );
    if !script.exists() {
        return Err(format!("bundled daemon missing at {}", script.display()));
    }
    let home = agentpass_home(app)?;
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    // stdout carries the daemon token on startup — never write it to a log file.
    // stderr (start-up failures) goes to ~/.agentpass/daemon.log.
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(home.join("daemon.log"))
        .map_err(|e| e.to_string())?;

    let mut last = String::from("no node interpreter found");
    for node in node_candidates() {
        match run_node(&node, &script, &log) {
            Ok(child) => return Ok(child),
            Err(e) => last = format!("{}: {e}", node.display()),
        }
    }
    Err(format!("could not start the bundled daemon — is Node.js 22.5+ installed? ({last})"))
}

fn run_node(node: &Path, script: &Path, log: &std::fs::File) -> std::io::Result<Child> {
    let mut cmd = Command::new(node);
    cmd.arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log.try_clone()?));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Daemon::default())
        .invoke_handler(tauri::generate_handler![daemon_conn, daemon_error])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<Daemon>();
            if already_running(daemon_port()) {
                return Ok(()); // attach to the daemon that is already up
            }
            match spawn_daemon(&handle) {
                Ok(child) => *state.child.lock().unwrap() = Some(child),
                Err(e) => *state.error.lock().unwrap() = Some(e),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running agentpass desktop");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // ponytail: plain kill. The daemon closes its DB on SIGTERM but not on
            // a hard kill; SQLite WAL recovers on next open. Swap for a job object
            // (Windows) / process group (unix) if orphaned daemons ever show up.
            if let Some(mut child) = handle.state::<Daemon>().child.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
