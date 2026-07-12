import { createHash } from "node:crypto";
import type { RotationPolicy, SyncBundle, SyncCredential, Target, Tombstone } from "@agentpass/shared";
import { loadSyncConfig, saveSyncConfig } from "./config.js";
import { decryptPayload, encryptPayload, isEncrypted } from "./crypto.js";
import { GistProvider, testGist } from "./providers/gist.js";
import { LocalProvider, testLocal } from "./providers/local.js";
import { S3Provider, testS3 } from "./providers/s3.js";
import { WebDavProvider, testWebDav } from "./providers/webdav.js";
import type {
  ConnectionResult,
  GistConfig,
  LocalConfig,
  S3Config,
  SyncConfig,
  SyncEnvelope,
  SyncProvider,
  SyncResult,
  SyncState,
  SyncStatus,
  SyncStore,
  SyncVersion,
  WebDavConfig,
} from "./types.js";

const SCHEMA = 1;
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const AUTO_BACKOFF_MAX = 10;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const epoch = (iso: string) => Date.parse(iso);

interface HasIdTime {
  id: string;
  updated_at: string;
}

/** Merge two collections by id — newer updated_at wins; tombstoned ids drop out. */
export function mergeById<T extends HasIdTime>(a: T[], b: T[], tombs: Map<string, number>): T[] {
  const map = new Map<string, T>();
  for (const item of [...a, ...b]) {
    const existing = map.get(item.id);
    if (!existing || epoch(item.updated_at) > epoch(existing.updated_at)) map.set(item.id, item);
  }
  const out: T[] = [];
  for (const item of map.values()) {
    const deletedAt = tombs.get(item.id);
    if (deletedAt != null && deletedAt >= epoch(item.updated_at)) continue; // deletion wins
    out.push(item);
  }
  return out;
}

export function mergeTombstones(a: Tombstone[], b: Tombstone[]): Tombstone[] {
  const map = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const e = map.get(t.id);
    if (!e || epoch(t.deleted_at) > epoch(e.deleted_at)) map.set(t.id, t);
  }
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  return [...map.values()].filter((t) => epoch(t.deleted_at) >= cutoff);
}

export function mergeBundles(local: SyncBundle, remote: SyncBundle): SyncBundle {
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones);
  const tombMap = new Map(tombstones.map((t) => [t.id, epoch(t.deleted_at)]));
  return {
    targets: mergeById<Target>(local.targets, remote.targets, tombMap),
    credentials: mergeById<SyncCredential>(local.credentials, remote.credentials, tombMap),
    rotation_policies: mergeById<RotationPolicy>(local.rotation_policies, remote.rotation_policies, tombMap),
    tombstones,
  };
}

/**
 * Provider-agnostic sync engine with MANDATORY E2E encryption (agentpass syncs
 * secrets). Item-level merge: concurrent edits of different items both survive;
 * deletions propagate via tombstones; the merged state is pushed back so devices
 * converge without whole-document conflicts.
 */
export class SyncEngine {
  private config: SyncConfig;
  private running = false;
  private autoFailures = 0;
  private autoSkips = 0;

  constructor(
    private store: SyncStore,
    private configPath: string,
    private log?: {
      info: (m: string, meta?: Record<string, unknown>) => void;
      error: (m: string, meta?: Record<string, unknown>) => void;
    },
  ) {
    this.config = loadSyncConfig(configPath);
  }

  private save() {
    saveSyncConfig(this.configPath, this.config);
  }

  getState(): SyncState {
    const p = this.config.provider;
    const account =
      p === "gist" ? this.config.gist?.account
      : p === "webdav" ? this.config.webdav?.account
      : p === "s3" ? this.config.s3?.account
      : p === "local" ? this.config.local?.dir
      : undefined;
    return {
      provider: p,
      connected: this.hasCreds(),
      account,
      autoSync: this.config.autoSync,
      encrypted: !!this.config.passphrase,
      lastSyncedAt: this.config.lastSyncedAt,
      lastStatus: this.config.lastStatus,
      lastMessage: this.config.lastMessage,
      deviceId: this.config.deviceId,
    };
  }

  setPassphrase(passphrase: string): SyncState {
    this.config.passphrase = passphrase.trim() || undefined;
    this.config.lastSyncedHash = undefined; // remote format changes
    this.save();
    return this.getState();
  }

  setAutoSync(enabled: boolean): SyncState {
    this.config.autoSync = enabled;
    this.save();
    return this.getState();
  }

  private hasCreds(): boolean {
    const p = this.config.provider;
    return (
      (p === "local" && !!this.config.local?.dir) ||
      (p === "gist" && !!this.config.gist?.token) ||
      (p === "webdav" && !!this.config.webdav?.password) ||
      (p === "s3" && !!this.config.s3?.secretAccessKey)
    );
  }

  private resetTracking() {
    this.config.lastSyncedHash = undefined;
    this.config.lastRemoteUpdatedAt = undefined;
    this.config.lastStatus = "idle";
    this.config.lastMessage = undefined;
  }

  private connectError(message?: string): SyncState {
    this.config.lastStatus = "error";
    this.config.lastMessage = message || "connect failed";
    this.save();
    return this.getState();
  }

  connectLocal(cfg: LocalConfig): SyncState {
    const test = testLocal(cfg);
    if (!test.ok) return this.connectError(test.error);
    this.resetTracking();
    this.config.provider = "local";
    this.config.local = { ...cfg };
    this.save();
    return this.getState();
  }
  async connectGist(token: string): Promise<SyncState> {
    const test = await testGist(token.trim());
    if (!test.ok) return this.connectError(test.error);
    this.resetTracking();
    this.config.provider = "gist";
    this.config.gist = { token: token.trim(), account: test.account, gistId: this.config.gist?.gistId };
    this.save();
    return this.getState();
  }
  async connectWebDav(cfg: WebDavConfig): Promise<SyncState> {
    const test = await testWebDav(cfg);
    if (!test.ok) return this.connectError(test.error);
    this.resetTracking();
    this.config.provider = "webdav";
    this.config.webdav = { ...cfg, account: test.account };
    this.save();
    return this.getState();
  }
  async connectS3(cfg: S3Config): Promise<SyncState> {
    const test = await testS3(cfg);
    if (!test.ok) return this.connectError(test.error);
    this.resetTracking();
    this.config.provider = "s3";
    this.config.s3 = { ...cfg, account: test.account };
    this.save();
    return this.getState();
  }

  disconnect(): SyncState {
    this.config.provider = null;
    this.config.local = this.config.gist = this.config.webdav = this.config.s3 = undefined;
    this.resetTracking();
    this.save();
    return this.getState();
  }

  private provider(): SyncProvider | null {
    const c = this.config;
    if (c.provider === "local" && c.local) return new LocalProvider(c.local);
    if (c.provider === "gist" && c.gist?.token)
      return new GistProvider(c.gist, (id) => {
        if (c.gist) c.gist.gistId = id;
        this.save();
      });
    if (c.provider === "webdav" && c.webdav) return new WebDavProvider(c.webdav);
    if (c.provider === "s3" && c.s3) return new S3Provider(c.s3);
    return null;
  }

  private encode(env: SyncEnvelope): string {
    if (!this.config.passphrase) throw new Error("set a sync passphrase first (E2E encryption is mandatory)");
    return encryptPayload(JSON.stringify(env), this.config.passphrase);
  }
  private decode(raw: string): SyncEnvelope {
    if (!isEncrypted(raw)) throw new Error("remote payload is not encrypted — refusing to read");
    if (!this.config.passphrase) throw new Error("remote is encrypted — set the same sync passphrase on this device");
    try {
      return JSON.parse(decryptPayload(raw, this.config.passphrase)) as SyncEnvelope;
    } catch {
      throw new Error("decrypt failed — wrong passphrase or corrupt data");
    }
  }

  private hashOf(b: SyncBundle): string {
    const byId = <T extends { id: string }>(arr: T[]) => [...arr].sort((a, c) => a.id.localeCompare(c.id));
    const norm = {
      targets: byId(b.targets),
      credentials: byId(b.credentials),
      rotation_policies: byId(b.rotation_policies),
      tombstones: byId(b.tombstones),
    };
    return createHash("sha1").update(JSON.stringify(norm)).digest("hex");
  }

  private envelope(b: SyncBundle): SyncEnvelope {
    return { app: "agentpass", schemaVersion: SCHEMA, updatedAt: Date.now(), deviceId: this.config.deviceId, bundle: b };
  }

  private async pushBundle(prov: SyncProvider, b: SyncBundle): Promise<void> {
    const env = this.envelope(b);
    await prov.push(this.encode(env));
    this.config.lastRemoteUpdatedAt = env.updatedAt;
    this.config.lastSyncedHash = this.hashOf(b);
    this.config.lastSyncedAt = Date.now();
  }

  private finish(status: SyncStatus, message?: string): SyncResult {
    this.config.lastStatus = status;
    this.config.lastMessage = message;
    this.save();
    return { status, message };
  }

  async run(): Promise<SyncResult> {
    const prov = this.provider();
    if (!prov) return this.finish("error", "not connected to a sync backend");
    if (!this.config.passphrase) return this.finish("error", "set a sync passphrase first (E2E is mandatory)");
    if (this.running) return { status: this.config.lastStatus ?? "idle", message: "sync in progress" };
    this.running = true;
    try {
      return await this.runInner(prov);
    } catch (e) {
      return this.finish("error", errMsg(e));
    } finally {
      this.running = false;
    }
  }

  private async runInner(prov: SyncProvider): Promise<SyncResult> {
    const local = await this.store.exportBundle();
    const localHash = this.hashOf(local);
    const raw = await prov.pull();
    if (!raw) {
      await this.pushBundle(prov, local);
      return this.finish("pushed", "created remote data");
    }
    const remote = this.decode(raw).bundle;
    const remoteHash = this.hashOf(remote);
    if (localHash === remoteHash) {
      this.config.lastSyncedHash = localHash;
      this.config.lastSyncedAt = Date.now();
      return this.finish("uptodate", "already up to date");
    }
    const merged = mergeBundles(local, remote);
    const mergedHash = this.hashOf(merged);
    const localChanged = mergedHash !== localHash;
    const remoteChanged = mergedHash !== remoteHash;
    if (localChanged) await this.store.applyBundle(merged);
    if (remoteChanged) await this.pushBundle(prov, merged);
    else {
      this.config.lastSyncedHash = mergedHash;
      this.config.lastSyncedAt = Date.now();
    }
    if (localChanged && remoteChanged) return this.finish("pulled", "merged both sides");
    if (localChanged) return this.finish("pulled", "merged remote updates");
    return this.finish("pushed", "uploaded local changes");
  }

  /** Called by the daemon maintenance timer; runs only when auto-sync is on, with skip-based backoff. */
  async autoTick(): Promise<void> {
    if (!this.config.autoSync || !this.hasCreds() || !this.config.passphrase) return;
    if (this.autoSkips > 0) {
      this.autoSkips--;
      return;
    }
    const result = await this.run();
    if (result.status === "error") {
      this.autoFailures = Math.min(this.autoFailures + 1, AUTO_BACKOFF_MAX);
      this.autoSkips = this.autoFailures; // exponential-ish: skip N ticks
      this.log?.error("auto_sync_failed", { message: result.message });
    } else {
      this.autoFailures = 0;
      this.log?.info("auto_sync", { status: result.status });
    }
  }

  listVersions(): Promise<SyncVersion[]> {
    const prov = this.provider();
    return prov ? prov.listVersions().catch(() => []) : Promise.resolve([]);
  }

  async restoreVersion(id: string): Promise<SyncResult> {
    const prov = this.provider();
    if (!prov) return this.finish("error", "not connected");
    try {
      const raw = await prov.getVersion(id);
      if (!raw) return this.finish("error", "version not found");
      await this.store.applyBundle(this.decode(raw).bundle);
      await this.pushBundle(prov, await this.store.exportBundle());
      return this.finish("pulled", "restored and synced");
    } catch (e) {
      return this.finish("error", errMsg(e));
    }
  }

  testConnection(): Promise<ConnectionResult> {
    const c = this.config;
    if (c.provider === "local" && c.local) return Promise.resolve(testLocal(c.local));
    if (c.provider === "gist" && c.gist) return testGist(c.gist.token);
    if (c.provider === "webdav" && c.webdav) return testWebDav(c.webdav);
    if (c.provider === "s3" && c.s3) return testS3(c.s3);
    return Promise.resolve({ ok: false, error: "not connected" });
  }
}
