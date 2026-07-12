// Provider/adapter ports. The whole point of these seams is that OpenBao,
// Infisical, Warpgate or JumpServer can be dropped in later without touching
// business logic. See docs/open-source-reuse.md.
import type {
  AuditLog,
  CheckoutMode,
  CheckoutSession,
  Credential,
  CredentialProviderKind,
  CredentialType,
  RevealRequest,
  RotationJob,
  RotationPolicy,
  SecretReveal,
  Target,
} from "@agentpass/shared";

export interface RevealContext {
  credential_id: string;
  requested_by: string;
  purpose: string;
}

// ---- CredentialStoreProvider: owns secret material (write side) ----
export interface CredentialStoreProvider {
  readonly kind: CredentialProviderKind;
  putSecret(input: {
    type: CredentialType;
    secret_value: string;
  }): Promise<{ secret_ref: string; version: string }>;
  updateSecret(secret_ref: string, secret_value: string): Promise<{ version: string }>;
  deleteSecret(secret_ref: string): Promise<void>;
}

// ---- SecretRevealProvider: owns secret material (read side) ----
export interface SecretRevealProvider {
  readonly kind: CredentialProviderKind;
  revealSecret(secret_ref: string, ctx: RevealContext): Promise<string>;
}

/** LocalEncryptedStoreProvider implements both store + reveal against SQLite. */
export interface CredentialBackend extends CredentialStoreProvider, SecretRevealProvider {}

// ---- CheckoutProvider: turns a secret + target into temporary access ----
export interface CheckoutCreateInput {
  checkout_id: string;
  target: Target;
  credential: Credential;
  /** Plaintext secret material for this checkout (e.g. an SSH private key). */
  secret_value: string;
  ttl_seconds: number;
}

export interface CheckoutArtifact {
  checkout_path: string;
  ssh_command: string;
}

export interface CheckoutProvider {
  readonly mode: CheckoutMode;
  supports(target: Target, credential: Credential): boolean;
  create(input: CheckoutCreateInput): Promise<CheckoutArtifact>;
  /** Remove any on-disk/agent artifacts. Must be idempotent. */
  cleanup(session: CheckoutSession): Promise<void>;
}

// ---- RotationProvider: performs an actual credential rotation (future auto) ----
export interface RotationExecuteInput {
  credential: Credential;
  target: Target | null;
}
export interface RotationProvider {
  supports(type: CredentialType): boolean;
  rotate(input: RotationExecuteInput): Promise<{ new_secret_value: string; version: string }>;
}

// ---- GatewayProvider: future SSH/DB/K8s connection gateway (Warpgate/JumpServer) ----
export interface GatewayProvider {
  readonly name: string;
  createSession(input: { target: Target; ttl_seconds: number }): Promise<{ url: string; expires_at: string }>;
}

// ---- SecretBlobStore: opaque ciphertext KV used by local credential backend ----
export interface SecretBlobStore {
  put(ref: string, ciphertext: string): void;
  get(ref: string): string | null;
  delete(ref: string): void;
}

// ---- Repository: metadata + audit persistence (SQLite in MVP) ----
export interface Repository {
  // targets
  createTarget(t: Target): void;
  getTarget(id: string): Target | null;
  listTargets(): Target[];
  updateTarget(id: string, patch: Partial<Target>): Target | null;
  deleteTarget(id: string): boolean;

  // credentials
  createCredential(c: Credential): void;
  getCredential(id: string): Credential | null;
  listCredentials(): Credential[];
  updateCredential(id: string, patch: Partial<Credential>): Credential | null;
  deleteCredential(id: string): boolean;

  // reveals
  createReveal(r: SecretReveal): void;
  getReveal(id: string): SecretReveal | null;
  listReveals(): SecretReveal[];
  updateReveal(id: string, patch: Partial<SecretReveal>): SecretReveal | null;
  /** Delete terminal (expired/revoked/rotated) reveals older than the given ISO time. */
  pruneReveals(beforeIso: string): number;

  // reveal requests (approval gate)
  createRevealRequest(r: RevealRequest): void;
  getRevealRequest(id: string): RevealRequest | null;
  listRevealRequests(): RevealRequest[];
  updateRevealRequest(id: string, patch: Partial<RevealRequest>): RevealRequest | null;
  /** Delete decided (consumed/denied) reveal requests older than the given ISO time. */
  pruneRevealRequests(beforeIso: string): number;

  // checkouts
  createCheckout(s: CheckoutSession): void;
  getCheckout(id: string): CheckoutSession | null;
  listCheckouts(): CheckoutSession[];
  updateCheckout(id: string, patch: Partial<CheckoutSession>): CheckoutSession | null;
  /** Delete terminal (expired/revoked) checkouts older than the given ISO time. */
  pruneCheckouts(beforeIso: string): number;

  // rotation policies
  createRotationPolicy(p: RotationPolicy): void;
  getRotationPolicy(id: string): RotationPolicy | null;
  listRotationPolicies(): RotationPolicy[];
  updateRotationPolicy(id: string, patch: Partial<RotationPolicy>): RotationPolicy | null;

  // rotation jobs
  createRotationJob(j: RotationJob): void;
  getRotationJob(id: string): RotationJob | null;
  listRotationJobs(): RotationJob[];
  updateRotationJob(id: string, patch: Partial<RotationJob>): RotationJob | null;

  // audit
  appendAudit(log: AuditLog): void;
  listAudit(limit?: number): AuditLog[];
}
