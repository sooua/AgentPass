// Online update via the Tauri updater plugin (GitHub Releases). Guarded so the
// web build (no Tauri APIs) degrades gracefully. Dynamic imports keep the plugin
// out of the web bundle.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type UpdateInfo = { version: string; date?: string; body?: string; obj: any };

export async function checkForUpdate(): Promise<
  { state: "web" } | { state: "none" } | { state: "available"; info: UpdateInfo } | { state: "error"; message: string }
> {
  if (!isTauri) return { state: "web" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { state: "none" };
    return { state: "available", info: { version: update.version, date: update.date, body: update.body, obj: update } };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function installAndRestart(info: UpdateInfo): Promise<void> {
  await info.obj.downloadAndInstall();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
