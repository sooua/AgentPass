import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ConnectionResult, LocalConfig, SyncProvider, SyncVersion } from "../types.js";

const FILE = "agentpass-sync.json";
const HISTORY = "history";
const MAX_HISTORY = 30;

/** Syncs to a local folder — pair with Syncthing/Dropbox/iCloud. Ciphertext only. */
export class LocalProvider implements SyncProvider {
  constructor(private cfg: LocalConfig) {}
  private file() {
    return join(this.cfg.dir, FILE);
  }
  private histDir() {
    return join(this.cfg.dir, HISTORY);
  }

  async pull(): Promise<string | null> {
    const f = this.file();
    return existsSync(f) ? readFileSync(f, "utf8") || null : null;
  }

  async push(payload: string): Promise<void> {
    mkdirSync(this.cfg.dir, { recursive: true });
    writeFileSync(this.file(), payload);
    try {
      mkdirSync(this.histDir(), { recursive: true });
      writeFileSync(join(this.histDir(), `${Date.now()}.json`), payload);
      for (const v of (await this.listVersions()).slice(MAX_HISTORY))
        rmSync(join(this.histDir(), v.id), { force: true });
    } catch {
      /* history is non-critical */
    }
  }

  async listVersions(): Promise<SyncVersion[]> {
    if (!existsSync(this.histDir())) return [];
    return readdirSync(this.histDir())
      .filter((n) => /^\d+\.json$/.test(n))
      .map((n) => ({ id: n, createdAt: parseInt(n, 10) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getVersion(id: string): Promise<string | null> {
    const f = join(this.histDir(), id);
    return existsSync(f) ? readFileSync(f, "utf8") || null : null;
  }
}

export function testLocal(cfg: LocalConfig): ConnectionResult {
  try {
    mkdirSync(cfg.dir, { recursive: true });
    if (!statSync(cfg.dir).isDirectory()) return { ok: false, error: "not a directory" };
    return { ok: true, account: cfg.dir };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
