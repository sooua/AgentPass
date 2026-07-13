// Core domain model shared across daemon, mcp-server, providers and UI.
// NOTE: these types describe METADATA only. Plaintext secret material never
// appears on any persisted entity — it flows only through reveal/checkout
// results and is redacted from logs.

export type TargetType = "ssh" | "database" | "kubernetes" | "api";
export type Environment = "dev" | "staging" | "prod";

export type CredentialType =
  | "password"
  | "ssh_private_key"
  | "api_token"
  | "kubeconfig"
  | "database_password";

export type CredentialProviderKind =
  | "local_encrypted"
  | "keychain"
  | "openbao"
  | "infisical";

export type CredentialStatus =
  | "active"
  | "rotation_required"
  | "expired"
  | "revoked";

export type RevealStatus = "active" | "expired" | "rotated" | "revoked";

export type CheckoutMode =
  | "temp_key_file"
  | "ssh_agent_socket"
  | "ssh_config"
  | "env_vars";

export type CheckoutStatus = "active" | "expired" | "revoked";

export type RotationReason =
  | "manual"
  | "after_reveal"
  | "scheduled"
  | "compromised";

export type RotationJobStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export type RiskLevel = "low" | "medium" | "high" | "critical";

/** What a scoped agent token is allowed to do. admin = manage tokens + CRUD. */
export type Capability = "reveal" | "checkout" | "list" | "rotate" | "admin";

/**
 * A scoped, per-agent auth token. Layered on top of the full-power root token
 * (~/.agentpass/token). Only the sha256 hash is persisted — plaintext is shown
 * once at creation. Empty environments/target_* arrays mean "no restriction".
 * Device-local: never synced (hashes are local auth material).
 */
export interface AgentToken {
  id: string;
  name: string;
  /** sha256(hex) of the plaintext token. The plaintext is never stored. */
  token_hash: string;
  capabilities: Capability[];
  environments: Environment[];
  target_tags: string[];
  target_ids: string[];
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

/** AgentToken metadata as returned to clients (never carries the hash). */
export type AgentTokenPublic = Omit<AgentToken, "token_hash">;

export interface Target {
  id: string;
  name: string;
  type: TargetType;
  host: string;
  port: number;
  username: string;
  tags: string[];
  environment: Environment;
  credential_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  provider: CredentialProviderKind;
  /** Opaque handle the provider uses to fetch secret material. Never the secret. */
  secret_ref: string;
  metadata: Record<string, unknown>;
  rotation_policy_id: string | null;
  last_revealed_at: string | null;
  last_rotated_at: string | null;
  next_rotation_due_at: string | null;
  reveal_count_since_rotation: number;
  status: CredentialStatus;
  created_at: string;
  updated_at: string;
}

export interface SecretReveal {
  id: string;
  credential_id: string;
  target_id: string | null;
  requested_by: string;
  purpose: string;
  revealed_at: string;
  expires_at: string;
  rotation_required: boolean;
  rotation_due_at: string | null;
  status: RevealStatus;
}

export interface CheckoutSession {
  id: string;
  target_id: string;
  credential_id: string;
  mode: CheckoutMode;
  requested_by: string;
  purpose: string;
  checkout_path: string | null;
  ssh_command: string | null;
  expires_at: string;
  revoked_at: string | null;
  status: CheckoutStatus;
  created_at: string;
}

export interface RotationPolicy {
  id: string;
  name: string;
  rotate_after_reveal: boolean;
  rotation_grace_period_minutes: number;
  rotation_interval_days: number | null;
  max_reveals_before_rotation: number | null;
  auto_rotate_enabled: boolean;
  approval_required: boolean;
  created_at: string;
  updated_at: string;
}

export interface RotationJob {
  id: string;
  credential_id: string;
  target_id: string | null;
  reason: RotationReason;
  status: RotationJobStatus;
  old_secret_version: string | null;
  new_secret_version: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

/** Marks a deleted entity so the deletion propagates through sync merges. */
export interface Tombstone {
  id: string;
  entity: "target" | "credential" | "rotation_policy";
  deleted_at: string;
}

export type RevealRequestStatus = "pending" | "approved" | "denied" | "consumed";

/** Approval gate for reveals when a credential's policy requires it. */
export interface RevealRequest {
  id: string;
  credential_id: string;
  target_id: string | null;
  requested_by: string;
  purpose: string;
  ttl_seconds: number;
  status: RevealRequestStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  target_id: string | null;
  credential_id: string | null;
  purpose: string | null;
  risk_level: RiskLevel;
  timestamp: string;
  /** Already-redacted structured context. Never contains secret material. */
  metadata_redacted: Record<string, unknown>;
}

// ---- Sync (bundle travels ONLY inside an E2E-encrypted envelope) ----

/** A credential plus its plaintext secret, for cross-device sync. secret is only
 * populated for portable (local_encrypted) backends; secret_ref is device-local. */
export interface SyncCredential extends Credential {
  secret: string | null;
}

export interface SyncBundle {
  targets: Target[];
  credentials: SyncCredential[];
  rotation_policies: RotationPolicy[];
  tombstones: Tombstone[];
}

// ---- Operation results (carry plaintext — treat as sensitive, never persist/log) ----

export interface RevealResult {
  reveal_id: string;
  credential_id: string;
  secret_value: string;
  expires_at: string;
  rotation_required: boolean;
  rotate_before: string | null;
  rotation_job_id: string | null;
}

export interface CheckoutResult {
  checkout_id: string;
  mode: CheckoutMode;
  ssh_command: string | null;
  checkout_path: string | null;
  expires_at: string;
}
