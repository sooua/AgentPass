import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { secureLocalFile } from "@agentpass/shared";
import type { SyncConfig } from "./types.js";

export function loadSyncConfig(path: string): SyncConfig {
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as SyncConfig;
    } catch {
      /* fall through to fresh config */
    }
  }
  const cfg: SyncConfig = { provider: null, deviceId: randomUUID(), autoSync: false };
  saveSyncConfig(path, cfg);
  return cfg;
}

export function saveSyncConfig(path: string, cfg: SyncConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  secureLocalFile(path); // holds provider creds + E2E passphrase — lock to user
}
