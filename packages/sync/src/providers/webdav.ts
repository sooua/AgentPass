import type { ConnectionResult, SyncProvider, SyncVersion, WebDavConfig } from "../types.js";

const FILE = "agentpass-sync.json";
const HISTORY_DIR = "history";
const MAX_HISTORY = 30;
const base = (url: string) => url.replace(/\/+$/, "");
const authHeader = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

export async function testWebDav(cfg: WebDavConfig): Promise<ConnectionResult> {
  try {
    const res = await fetch(base(cfg.url), {
      method: "PROPFIND",
      headers: { Authorization: authHeader(cfg.username, cfg.password), Depth: "0" },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "auth failed" };
    if (res.status >= 500) return { ok: false, error: `server error (${res.status})` };
    return { ok: true, account: `${cfg.username}@${new URL(cfg.url).host}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export class WebDavProvider implements SyncProvider {
  constructor(private cfg: WebDavConfig) {}
  private h(extra?: Record<string, string>) {
    return { Authorization: authHeader(this.cfg.username, this.cfg.password), ...extra };
  }
  private fileUrl() {
    return `${base(this.cfg.url)}/${FILE}`;
  }
  private histDir() {
    return `${base(this.cfg.url)}/${HISTORY_DIR}/`;
  }
  private histUrl(name: string) {
    return `${base(this.cfg.url)}/${HISTORY_DIR}/${name}`;
  }

  async pull(): Promise<string | null> {
    const res = await fetch(this.fileUrl(), { headers: this.h() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`pull failed (${res.status})`);
    return (await res.text()) || null;
  }

  async push(payload: string): Promise<void> {
    const res = await fetch(this.fileUrl(), {
      method: "PUT",
      headers: this.h({ "Content-Type": "application/json" }),
      body: payload,
    });
    if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error(`push failed (${res.status})`);
    try {
      await fetch(this.histDir(), { method: "MKCOL", headers: this.h() }).catch(() => {});
      await fetch(this.histUrl(`${Date.now()}.json`), {
        method: "PUT",
        headers: this.h({ "Content-Type": "application/json" }),
        body: payload,
      });
      for (const v of (await this.listVersions()).slice(MAX_HISTORY))
        await fetch(this.histUrl(v.id), { method: "DELETE", headers: this.h() }).catch(() => {});
    } catch {
      /* history is non-critical */
    }
  }

  async listVersions(): Promise<SyncVersion[]> {
    const res = await fetch(this.histDir(), { method: "PROPFIND", headers: this.h({ Depth: "1" }) });
    if (!res.ok && res.status !== 207) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<[^>]*href>([^<]+)<\/[^>]*href>/gi)]
      .map((m) => decodeURIComponent(m[1] ?? "").split("/").pop() ?? "")
      .filter((n) => /^\d+\.json$/.test(n))
      .map((n) => ({ id: n, createdAt: parseInt(n, 10) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getVersion(id: string): Promise<string | null> {
    const res = await fetch(this.histUrl(id), { headers: this.h() });
    if (!res.ok) return null;
    return (await res.text()) || null;
  }
}
