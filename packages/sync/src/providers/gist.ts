import type { ConnectionResult, GistConfig, SyncProvider, SyncVersion } from "../types.js";

const API = "https://api.github.com";
const FILE = "agentpass-sync.json";

const headers = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "User-Agent": "agentpass",
  "X-GitHub-Api-Version": "2022-11-28",
});

export async function testGist(token: string): Promise<ConnectionResult> {
  try {
    const res = await fetch(`${API}/user`, { headers: headers(token) });
    if (!res.ok) return { ok: false, error: `GitHub ${res.status}` };
    const json = (await res.json()) as { login?: string };
    return { ok: true, account: json.login };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

export class GistProvider implements SyncProvider {
  constructor(private cfg: GistConfig, private onGistId: (id: string) => void) {}

  // A second device has the token but not the gist id: adopt the existing
  // agentpass gist (matched by filename) instead of forking a new one.
  private async resolveGistId(): Promise<string | null> {
    if (this.cfg.gistId) return this.cfg.gistId;
    const res = await fetch(`${API}/gists?per_page=100`, { headers: headers(this.cfg.token) });
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ id: string; created_at?: string; files?: Record<string, unknown> }>;
    const found = list
      .filter((g) => g.files && FILE in g.files)
      .sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""))[0];
    if (found) {
      this.cfg.gistId = found.id;
      this.onGistId(found.id);
      return found.id;
    }
    return null;
  }

  private async readFile(file: GistFile | undefined): Promise<string | null> {
    if (!file) return null;
    const content =
      file.truncated && file.raw_url
        ? await (await fetch(file.raw_url, { headers: headers(this.cfg.token) })).text()
        : file.content ?? "";
    return content || null;
  }

  async pull(): Promise<string | null> {
    const id = await this.resolveGistId();
    if (!id) return null;
    const res = await fetch(`${API}/gists/${id}`, { headers: headers(this.cfg.token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`pull failed (${res.status})`);
    const json = (await res.json()) as { files?: Record<string, GistFile> };
    return this.readFile(json.files?.[FILE]);
  }

  async push(payload: string): Promise<void> {
    const body = JSON.stringify({ description: "agentpass sync", public: false, files: { [FILE]: { content: payload } } });
    const id = await this.resolveGistId();
    if (id) {
      const res = await fetch(`${API}/gists/${id}`, { method: "PATCH", headers: headers(this.cfg.token), body });
      if (!res.ok) throw new Error(`push failed (${res.status})`);
    } else {
      const res = await fetch(`${API}/gists`, { method: "POST", headers: headers(this.cfg.token), body });
      if (!res.ok) throw new Error(`create failed (${res.status})`);
      const json = (await res.json()) as { id: string };
      this.cfg.gistId = json.id;
      this.onGistId(json.id);
    }
  }

  async listVersions(): Promise<SyncVersion[]> {
    if (!this.cfg.gistId) return [];
    const res = await fetch(`${API}/gists/${this.cfg.gistId}/commits`, { headers: headers(this.cfg.token) });
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{ version: string; committed_at: string; user?: { login?: string } }>;
    return json.map((c) => ({ id: c.version, createdAt: Date.parse(c.committed_at), label: c.user?.login }));
  }

  async getVersion(id: string): Promise<string | null> {
    if (!this.cfg.gistId) return null;
    const res = await fetch(`${API}/gists/${this.cfg.gistId}/${id}`, { headers: headers(this.cfg.token) });
    if (!res.ok) return null;
    const json = (await res.json()) as { files?: Record<string, GistFile> };
    return this.readFile(json.files?.[FILE]);
  }
}
