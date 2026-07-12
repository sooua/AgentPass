// Custom window chrome for the frameless Tauri window (decorations: false).
// Falls back to a plain header when running as a web app (no Tauri APIs).
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export function TitleBar() {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <img src="/logo.svg" width={16} height={16} alt="" />
        agentpass
      </div>
      {isTauri && (
        <div className="titlebar-controls">
          <button className="tb-btn" aria-label="minimize" onClick={() => void win().then((w) => w.minimize())}>
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="5" width="8" height="1" fill="currentColor" /></svg>
          </button>
          <button className="tb-btn" aria-label="maximize" onClick={() => void win().then((w) => w.toggleMaximize())}>
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" /></svg>
          </button>
          <button className="tb-btn tb-close" aria-label="close" onClick={() => void win().then((w) => w.close())}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
