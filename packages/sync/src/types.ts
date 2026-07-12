import type { SyncBundle } from "@agentpass/shared";

export type SyncProviderKind = "local" | "gist" | "webdav" | "s3";
export type SyncStatus = "idle" | "uptodate" | "pushed" | "pulled" | "error";

/** A pluggable backend. It moves opaque (already E2E-encrypted) string payloads. */
export interface SyncProvider {
  pull(): Promise<string | null>;
  push(payload: string): Promise<void>;
  listVersions(): Promise<SyncVersion[]>;
  getVersion(id: string): Promise<string | null>;
}

export interface SyncVersion {
  id: string;
  createdAt: number;
  label?: string;
}

export interface ConnectionResult {
  ok: boolean;
  account?: string;
  error?: string;
}

export interface SyncResult {
  status: SyncStatus;
  message?: string;
}

// ---- provider config inputs ----
export interface LocalConfig {
  dir: string;
}
export interface GistConfig {
  token: string;
  gistId?: string;
  account?: string;
}
export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  account?: string;
}
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  account?: string;
}

export interface SyncConfig {
  provider: SyncProviderKind | null;
  deviceId: string;
  autoSync: boolean;
  /** E2E passphrase (mandatory to sync). Stored in the 0600 config alongside the master key. */
  passphrase?: string;
  local?: LocalConfig;
  gist?: GistConfig;
  webdav?: WebDavConfig;
  s3?: S3Config;
  lastSyncedHash?: string;
  lastRemoteUpdatedAt?: number;
  lastSyncedAt?: number;
  lastStatus?: SyncStatus;
  lastMessage?: string;
}

export interface SyncState {
  provider: SyncProviderKind | null;
  connected: boolean;
  account?: string;
  autoSync: boolean;
  encrypted: boolean;
  lastSyncedAt?: number;
  lastStatus?: SyncStatus;
  lastMessage?: string;
  deviceId: string;
}

export interface SyncEnvelope {
  app: "agentpass";
  schemaVersion: number;
  updatedAt: number;
  deviceId: string;
  bundle: SyncBundle;
}

/** What the engine needs from the daemon core. */
export interface SyncStore {
  exportBundle(): Promise<SyncBundle>;
  applyBundle(bundle: SyncBundle): Promise<void>;
}
