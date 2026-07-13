import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentToken,
  AuditLog,
  CheckoutSession,
  Credential,
  RevealRequest,
  RotationJob,
  RotationPolicy,
  SecretReveal,
  Target,
  Tombstone,
} from "@agentpass/shared";
import type { Repository, SecretBlobStore } from "@agentpass/core";

// ponytail: whole-row JSON per entity (id TEXT PK, data JSON). MVP scale only.
// Upgrade to typed columns + indexes when list filtering/large volume demands it.
const SCHEMA_VERSION = 1;
const ENTITY_TABLES = [
  "targets",
  "credentials",
  "reveals",
  "reveal_requests",
  "checkouts",
  "rotation_policies",
  "rotation_jobs",
  "agent_tokens",
] as const;

// node:sqlite is a newer builtin; load via require so bundlers (Vite/vitest)
// don't try to statically resolve the `node:` specifier.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export class SqliteStore implements Repository, SecretBlobStore {
  private readonly db: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    for (const t of ENTITY_TABLES) {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      );
    }
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS audit_logs (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         id TEXT NOT NULL,
         data TEXT NOT NULL
       )`,
    );
    // Ciphertext blobs for the local-encrypted credential backend.
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS secret_blobs (ref TEXT PRIMARY KEY, ciphertext TEXT NOT NULL)`,
    );
    // Tombstones: deleted entity ids so deletions propagate through sync merges.
    this.db.exec(`CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    // Schema version marker for future migrations.
    this.db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.db
      .prepare(`INSERT INTO _meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING`)
      .run(String(SCHEMA_VERSION));
  }

  get schemaVersion(): number {
    const r = this.db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    return r ? Number(r.value) : 0;
  }

  close(): void {
    this.db.close();
  }

  // ---- generic JSON-row helpers ----
  private insert<T extends { id: string }>(table: string, row: T): void {
    this.db
      .prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)`)
      .run(row.id, JSON.stringify(row));
  }

  private getRow<T>(table: string, id: string): T | null {
    const r = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
      | { data: string }
      | undefined;
    return r ? (JSON.parse(r.data) as T) : null;
  }

  private allRows<T>(table: string): T[] {
    const rows = this.db.prepare(`SELECT data FROM ${table}`).all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  private patchRow<T extends { id: string }>(
    table: string,
    id: string,
    patch: Partial<T>,
  ): T | null {
    const current = this.getRow<T>(table, id);
    if (!current) return null;
    const merged = { ...current, ...patch };
    this.db
      .prepare(`UPDATE ${table} SET data = ? WHERE id = ?`)
      .run(JSON.stringify(merged), id);
    return merged;
  }

  private del(table: string, id: string): boolean {
    const res = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  // ---- targets ----
  createTarget(t: Target): void {
    this.insert("targets", t);
  }
  getTarget(id: string): Target | null {
    return this.getRow<Target>("targets", id);
  }
  listTargets(): Target[] {
    return this.allRows<Target>("targets");
  }
  updateTarget(id: string, patch: Partial<Target>): Target | null {
    return this.patchRow<Target>("targets", id, patch);
  }
  deleteTarget(id: string): boolean {
    return this.del("targets", id);
  }

  // ---- credentials ----
  createCredential(c: Credential): void {
    this.insert("credentials", c);
  }
  getCredential(id: string): Credential | null {
    return this.getRow<Credential>("credentials", id);
  }
  listCredentials(): Credential[] {
    return this.allRows<Credential>("credentials");
  }
  updateCredential(id: string, patch: Partial<Credential>): Credential | null {
    return this.patchRow<Credential>("credentials", id, patch);
  }
  deleteCredential(id: string): boolean {
    return this.del("credentials", id);
  }

  // ---- reveals ----
  createReveal(r: SecretReveal): void {
    this.insert("reveals", r);
  }
  getReveal(id: string): SecretReveal | null {
    return this.getRow<SecretReveal>("reveals", id);
  }
  listReveals(): SecretReveal[] {
    return this.allRows<SecretReveal>("reveals");
  }
  updateReveal(id: string, patch: Partial<SecretReveal>): SecretReveal | null {
    return this.patchRow<SecretReveal>("reveals", id, patch);
  }
  pruneReveals(beforeIso: string): number {
    const res = this.db
      .prepare(
        `DELETE FROM reveals
         WHERE json_extract(data,'$.status') IN ('expired','revoked','rotated')
           AND json_extract(data,'$.revealed_at') < ?`,
      )
      .run(beforeIso);
    return res.changes as number;
  }

  // ---- reveal requests ----
  createRevealRequest(r: RevealRequest): void {
    this.insert("reveal_requests", r);
  }
  getRevealRequest(id: string): RevealRequest | null {
    return this.getRow<RevealRequest>("reveal_requests", id);
  }
  listRevealRequests(): RevealRequest[] {
    return this.allRows<RevealRequest>("reveal_requests");
  }
  updateRevealRequest(id: string, patch: Partial<RevealRequest>): RevealRequest | null {
    return this.patchRow<RevealRequest>("reveal_requests", id, patch);
  }
  pruneRevealRequests(beforeIso: string): number {
    const res = this.db
      .prepare(
        `DELETE FROM reveal_requests
         WHERE json_extract(data,'$.status') IN ('consumed','denied')
           AND json_extract(data,'$.created_at') < ?`,
      )
      .run(beforeIso);
    return res.changes as number;
  }

  // ---- checkouts ----
  createCheckout(s: CheckoutSession): void {
    this.insert("checkouts", s);
  }
  getCheckout(id: string): CheckoutSession | null {
    return this.getRow<CheckoutSession>("checkouts", id);
  }
  listCheckouts(): CheckoutSession[] {
    return this.allRows<CheckoutSession>("checkouts");
  }
  updateCheckout(id: string, patch: Partial<CheckoutSession>): CheckoutSession | null {
    return this.patchRow<CheckoutSession>("checkouts", id, patch);
  }
  pruneCheckouts(beforeIso: string): number {
    const res = this.db
      .prepare(
        `DELETE FROM checkouts
         WHERE json_extract(data,'$.status') IN ('expired','revoked')
           AND json_extract(data,'$.created_at') < ?`,
      )
      .run(beforeIso);
    return res.changes as number;
  }

  // ---- rotation policies ----
  createRotationPolicy(p: RotationPolicy): void {
    this.insert("rotation_policies", p);
  }
  getRotationPolicy(id: string): RotationPolicy | null {
    return this.getRow<RotationPolicy>("rotation_policies", id);
  }
  listRotationPolicies(): RotationPolicy[] {
    return this.allRows<RotationPolicy>("rotation_policies");
  }
  updateRotationPolicy(id: string, patch: Partial<RotationPolicy>): RotationPolicy | null {
    return this.patchRow<RotationPolicy>("rotation_policies", id, patch);
  }

  // ---- rotation jobs ----
  createRotationJob(j: RotationJob): void {
    this.insert("rotation_jobs", j);
  }
  getRotationJob(id: string): RotationJob | null {
    return this.getRow<RotationJob>("rotation_jobs", id);
  }
  listRotationJobs(): RotationJob[] {
    return this.allRows<RotationJob>("rotation_jobs");
  }
  updateRotationJob(id: string, patch: Partial<RotationJob>): RotationJob | null {
    return this.patchRow<RotationJob>("rotation_jobs", id, patch);
  }

  // ---- agent tokens (scoped per-agent auth) ----
  createAgentToken(t: AgentToken): void {
    this.insert("agent_tokens", t);
  }
  getAgentToken(id: string): AgentToken | null {
    return this.getRow<AgentToken>("agent_tokens", id);
  }
  listAgentTokens(): AgentToken[] {
    return this.allRows<AgentToken>("agent_tokens");
  }
  updateAgentToken(id: string, patch: Partial<AgentToken>): AgentToken | null {
    return this.patchRow<AgentToken>("agent_tokens", id, patch);
  }
  deleteAgentToken(id: string): boolean {
    return this.del("agent_tokens", id);
  }

  // ---- audit (append-only, newest first) ----
  appendAudit(log: AuditLog): void {
    this.db
      .prepare(`INSERT INTO audit_logs (id, data) VALUES (?, ?)`)
      .run(log.id, JSON.stringify(log));
  }
  listAudit(limit = 200): AuditLog[] {
    const rows = this.db
      .prepare(`SELECT data FROM audit_logs ORDER BY seq DESC LIMIT ?`)
      .all(limit) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as AuditLog);
  }

  // ---- tombstones ----
  addTombstone(t: Tombstone): void {
    this.db
      .prepare(`INSERT INTO tombstones (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(t.id, JSON.stringify(t));
  }
  listTombstones(): Tombstone[] {
    return this.allRows<Tombstone>("tombstones");
  }
  pruneTombstones(beforeIso: string): number {
    const res = this.db
      .prepare(`DELETE FROM tombstones WHERE json_extract(data,'$.deleted_at') < ?`)
      .run(beforeIso);
    return res.changes as number;
  }

  // ---- SecretBlobStore ----
  put(ref: string, ciphertext: string): void {
    this.db
      .prepare(
        `INSERT INTO secret_blobs (ref, ciphertext) VALUES (?, ?)
         ON CONFLICT(ref) DO UPDATE SET ciphertext = excluded.ciphertext`,
      )
      .run(ref, ciphertext);
  }
  get(ref: string): string | null {
    const r = this.db.prepare(`SELECT ciphertext FROM secret_blobs WHERE ref = ?`).get(ref) as
      | { ciphertext: string }
      | undefined;
    return r ? r.ciphertext : null;
  }
  delete(ref: string): void {
    this.db.prepare(`DELETE FROM secret_blobs WHERE ref = ?`).run(ref);
  }
}
