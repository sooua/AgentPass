import {
  addDays,
  addMinutes,
  addSeconds,
  isPast,
  newId,
  nowIso,
  type AuditLog,
  type CheckoutResult,
  type CheckoutSession,
  type Credential,
  type Environment,
  type RevealResult,
  type RevealRequest,
  type RiskLevel,
  type RotationJob,
  type RotationPolicy,
  type SecretReveal,
  type SyncBundle,
  type SyncCredential,
  type Target,
} from "@agentpass/shared";
import type {
  AuditQuery,
  CheckoutInput,
  CreateCredentialInput,
  CreateRotationJobInput,
  CreateTargetInput,
  CredentialQuery,
  DecideRevealRequestInput,
  MarkRotationFailedInput,
  MarkRotationSuccessInput,
  RevealInput,
  RotationPolicyInput,
  TargetQuery,
  UpdateCredentialInput,
  UpdateRotationPolicyInput,
  UpdateTargetInput,
} from "@agentpass/shared";
import { AgentTokenService } from "./agent-tokens.js";
import { AppError, approvalRequired, badRequest, conflict, forbidden, notFound, notSupported } from "./errors.js";
import type { Logger } from "./logger.js";
import { createLogger } from "./logger.js";
import type {
  CheckoutProvider,
  CredentialBackend,
  Repository,
  RotationProvider,
} from "./ports.js";

export interface CoreDeps {
  repo: Repository;
  backends: CredentialBackend[]; // keyed by .kind
  checkoutProviders: CheckoutProvider[]; // keyed by .mode
  rotationProviders?: RotationProvider[];
  logger?: Logger;
  /** Minutes to defer a scheduled rotation after a failure. Default 60. */
  rotationBackoffMinutes?: number;
}

const riskForEnv = (env: Environment | undefined, base: RiskLevel): RiskLevel => {
  if (env === "prod") return base === "high" ? "critical" : "high";
  return base;
};

const paginate = <T>(rows: T[], offset?: number, limit?: number): T[] => {
  const start = offset ?? 0;
  return limit != null ? rows.slice(start, start + limit) : rows.slice(start);
};

export class AgentPassCore {
  private readonly repo: Repository;
  private readonly backends: Map<string, CredentialBackend>;
  private readonly checkouts: Map<string, CheckoutProvider>;
  private readonly rotations: RotationProvider[];
  private readonly rotationBackoffMinutes: number;
  private readonly listeners = new Set<(e: AuditLog) => void>();
  readonly log: Logger;
  /** Scoped per-agent token management + authorization (B3). */
  readonly tokens: AgentTokenService;

  constructor(deps: CoreDeps) {
    this.repo = deps.repo;
    this.tokens = new AgentTokenService(deps.repo);
    this.backends = new Map(deps.backends.map((b) => [b.kind, b]));
    this.checkouts = new Map(deps.checkoutProviders.map((c) => [c.mode, c]));
    this.rotations = deps.rotationProviders ?? [];
    this.rotationBackoffMinutes = deps.rotationBackoffMinutes ?? 60;
    this.log = deps.logger ?? createLogger();
  }

  /** Subscribe to change events (one per audited mutation, already redacted). */
  subscribe(fn: (e: AuditLog) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // -------- audit --------
  private audit(entry: Omit<AuditLog, "id" | "timestamp">): void {
    const log: AuditLog = { id: newId("aud"), timestamp: nowIso(), ...entry };
    this.repo.appendAudit(log);
    this.log.info(`audit:${entry.action}`, {
      actor: entry.actor,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      risk_level: entry.risk_level,
    });
    for (const l of this.listeners) {
      try { l(log); } catch { /* a bad listener must not break the write */ }
    }
  }

  listAudit(query: AuditQuery = {}): AuditLog[] {
    // Filters are applied in SQL (WHERE + LIMIT together), so a filtered query
    // returns the newest matching rows rather than matches inside the newest 200.
    return this.repo.listAudit({
      actor: query.actor,
      action: query.action,
      risk_level: query.risk_level,
      limit: query.limit ?? 200,
    });
  }

  // -------- targets --------
  createTarget(input: CreateTargetInput): Target {
    const ts = nowIso();
    const t: Target = { id: newId("tgt"), ...input, created_at: ts, updated_at: ts };
    this.repo.createTarget(t);
    this.audit({
      actor: "system",
      action: "create_target",
      resource_type: "target",
      resource_id: t.id,
      target_id: t.id,
      credential_id: null,
      purpose: null,
      risk_level: "low",
      metadata_redacted: { name: t.name, type: t.type, environment: t.environment },
    });
    return t;
  }

  getTarget(id: string): Target {
    const t = this.repo.getTarget(id);
    if (!t) throw notFound("target", id);
    return t;
  }

  // ponytail: in-memory filter — fine at MVP scale. Push down to SQL (indexed
  // columns / json_extract WHERE) when target/credential counts get large.
  listTargets(query: TargetQuery = {}): Target[] {
    let out = this.repo.listTargets();
    if (query.environment) out = out.filter((t) => t.environment === query.environment);
    if (query.type) out = out.filter((t) => t.type === query.type);
    if (query.tag) out = out.filter((t) => t.tags.includes(query.tag!));
    if (query.q) {
      const q = query.q.toLowerCase();
      out = out.filter((t) =>
        [t.name, t.host, t.username].some((f) => f.toLowerCase().includes(q)),
      );
    }
    return paginate(out, query.offset, query.limit);
  }

  updateTarget(id: string, patch: UpdateTargetInput): Target {
    const updated = this.repo.updateTarget(id, { ...patch, updated_at: nowIso() });
    if (!updated) throw notFound("target", id);
    return updated;
  }

  async deleteTarget(id: string): Promise<void> {
    const t = this.repo.getTarget(id);
    if (!t) throw notFound("target", id);
    // Cascade: revoke this target's active checkouts (wipes temp key artifacts).
    for (const s of this.repo.listCheckouts())
      if (s.target_id === id && s.status === "active") await this.revokeCheckout(s.id);
    this.repo.deleteTarget(id);
    this.repo.addTombstone({ id, entity: "target", deleted_at: nowIso() });
  }

  // -------- credentials --------
  private backendFor(kind: string): CredentialBackend {
    const b = this.backends.get(kind);
    if (!b) throw notSupported(`credential provider not available: ${kind}`);
    return b;
  }

  async createCredential(input: CreateCredentialInput): Promise<Credential> {
    const backend = this.backendFor(input.provider);
    const { secret_ref } = await backend.putSecret({
      type: input.type,
      secret_value: input.secret_value,
    });
    const ts = nowIso();
    const policy = input.rotation_policy_id
      ? this.repo.getRotationPolicy(input.rotation_policy_id)
      : null;
    const c: Credential = {
      id: newId("cred"),
      name: input.name,
      type: input.type,
      provider: input.provider,
      secret_ref,
      metadata: input.metadata,
      rotation_policy_id: input.rotation_policy_id,
      last_revealed_at: null,
      last_rotated_at: null,
      next_rotation_due_at:
        policy?.rotation_interval_days != null
          ? addDays(ts, policy.rotation_interval_days)
          : null,
      reveal_count_since_rotation: 0,
      status: "active",
      created_at: ts,
      updated_at: ts,
    };
    this.repo.createCredential(c);
    this.audit({
      actor: "system",
      action: "create_credential",
      resource_type: "credential",
      resource_id: c.id,
      target_id: null,
      credential_id: c.id,
      purpose: null,
      risk_level: "low",
      metadata_redacted: { name: c.name, type: c.type, provider: c.provider },
    });
    return c;
  }

  getCredential(id: string): Credential {
    const c = this.repo.getCredential(id);
    if (!c) throw notFound("credential", id);
    return c;
  }

  listCredentials(query: CredentialQuery = {}): Credential[] {
    let out = this.repo.listCredentials();
    if (query.type) out = out.filter((c) => c.type === query.type);
    if (query.status) out = out.filter((c) => c.status === query.status);
    if (query.q) {
      const q = query.q.toLowerCase();
      out = out.filter((c) => c.name.toLowerCase().includes(q));
    }
    return paginate(out, query.offset, query.limit);
  }

  async updateCredential(id: string, patch: UpdateCredentialInput): Promise<Credential> {
    const c = this.getCredential(id);
    const metaPatch: Partial<Credential> = { updated_at: nowIso() };
    if (patch.name != null) metaPatch.name = patch.name;
    if (patch.metadata != null) metaPatch.metadata = patch.metadata;
    if (patch.rotation_policy_id !== undefined)
      metaPatch.rotation_policy_id = patch.rotation_policy_id;
    if (patch.secret_value != null) {
      await this.backendFor(c.provider).updateSecret(c.secret_ref, patch.secret_value);
    }
    const updated = this.repo.updateCredential(id, metaPatch);
    if (!updated) throw notFound("credential", id);
    return updated;
  }

  async deleteCredential(id: string): Promise<void> {
    const c = this.getCredential(id);
    // Cascade: revoke active checkouts using this credential, then unlink it from
    // every target so no dangling credential_ids remain.
    for (const s of this.repo.listCheckouts())
      if (s.credential_id === id && s.status === "active") await this.revokeCheckout(s.id);
    for (const t of this.repo.listTargets())
      if (t.credential_ids.includes(id))
        this.repo.updateTarget(t.id, {
          credential_ids: t.credential_ids.filter((cid) => cid !== id),
          updated_at: nowIso(),
        });
    await this.backendFor(c.provider).deleteSecret(c.secret_ref);
    this.repo.deleteCredential(id);
    this.repo.addTombstone({ id, entity: "credential", deleted_at: nowIso() });
  }

  // -------- reveal (HIGH RISK) --------
  /** actor overrides the audit actor with the caller's token identity (B3);
   * defaults to requested_by for back-compat with the root/all-power token. */
  async reveal(credentialId: string, input: RevealInput, actor?: string): Promise<RevealResult> {
    const c = this.getCredential(credentialId);
    if (c.status === "revoked") throw conflict("credential is revoked");

    const policyForApproval = c.rotation_policy_id
      ? this.repo.getRotationPolicy(c.rotation_policy_id)
      : null;
    // Resolve (but do NOT consume) the approval up front; consume only after the
    // reveal actually succeeds so a transient failure doesn't waste the approval.
    // The requester identity is the AUTHENTICATED actor (token name / "root"),
    // not the spoofable requested_by field — that is what the approver is checked
    // against for separation of duties.
    const requesterIdentity = actor ?? input.requested_by;
    const approvalToConsume = policyForApproval?.approval_required
      ? this.resolveApproval(c.id, input, requesterIdentity)
      : null;

    const backend = this.backendFor(c.provider);
    const secret = await backend.revealSecret(c.secret_ref, {
      credential_id: c.id,
      requested_by: input.requested_by,
      purpose: input.purpose,
    });
    if (approvalToConsume) this.repo.updateRevealRequest(approvalToConsume, { status: "consumed" });

    const ts = nowIso();
    const policy = c.rotation_policy_id
      ? this.repo.getRotationPolicy(c.rotation_policy_id)
      : null;
    const newRevealCount = c.reveal_count_since_rotation + 1;
    const rotationRequired = this.shouldRotateAfterReveal(policy, newRevealCount);
    const rotateBefore =
      rotationRequired && policy
        ? addMinutes(ts, policy.rotation_grace_period_minutes)
        : null;

    const target = input.target_id ? this.repo.getTarget(input.target_id) : null;
    const reveal: SecretReveal = {
      id: newId("rev"),
      credential_id: c.id,
      target_id: input.target_id,
      requested_by: input.requested_by,
      purpose: input.purpose,
      revealed_at: ts,
      expires_at: addSeconds(ts, input.ttl_seconds),
      rotation_required: rotationRequired,
      rotation_due_at: rotateBefore,
      status: "active",
    };
    this.repo.createReveal(reveal);

    this.repo.updateCredential(c.id, {
      last_revealed_at: ts,
      reveal_count_since_rotation: newRevealCount,
      status: rotationRequired ? "rotation_required" : c.status,
      updated_at: ts,
    });

    let rotationJobId: string | null = null;
    if (rotationRequired) {
      rotationJobId = this.createRotationJob(c.id, {
        target_id: input.target_id,
        reason: "after_reveal",
      }).id;
    }

    this.audit({
      actor: actor ?? input.requested_by,
      action: "reveal_secret",
      resource_type: "credential",
      resource_id: c.id,
      target_id: input.target_id,
      credential_id: c.id,
      purpose: input.purpose,
      risk_level: riskForEnv(target?.environment, "high"),
      metadata_redacted: {
        reveal_id: reveal.id,
        ttl_seconds: input.ttl_seconds,
        rotation_required: rotationRequired,
        rotation_job_id: rotationJobId,
      },
    });

    return {
      reveal_id: reveal.id,
      credential_id: c.id,
      secret_value: secret,
      expires_at: reveal.expires_at,
      rotation_required: rotationRequired,
      rotate_before: rotateBefore,
      rotation_job_id: rotationJobId,
    };
  }

  private shouldRotateAfterReveal(
    policy: RotationPolicy | null,
    revealCount: number,
  ): boolean {
    if (!policy) return false;
    if (policy.rotate_after_reveal) return true;
    if (policy.max_reveals_before_rotation != null)
      return revealCount >= policy.max_reveals_before_rotation;
    return false;
  }

  listReveals(): SecretReveal[] {
    return this.repo.listReveals();
  }

  getReveal(id: string): SecretReveal {
    const r = this.repo.getReveal(id);
    if (!r) throw notFound("reveal", id);
    return r;
  }

  revokeReveal(id: string): SecretReveal {
    const r = this.getReveal(id);
    const updated = this.repo.updateReveal(id, { status: "revoked" });
    this.audit({
      actor: "system",
      action: "revoke_reveal",
      resource_type: "reveal",
      resource_id: id,
      target_id: r.target_id,
      credential_id: r.credential_id,
      purpose: null,
      risk_level: "low",
      metadata_redacted: {},
    });
    return updated!;
  }

  // -------- reveal approval gate --------
  /**
   * Validate an approval without consuming it. Returns the request id the caller
   * must consume after a successful reveal, or throws (approval_required /
   * conflict / bad_request) and opens/reuses a pending request when none is given.
   */
  private resolveApproval(credentialId: string, input: RevealInput, requester: string): string {
    if (input.approval_id) {
      const req = this.repo.getRevealRequest(input.approval_id);
      if (!req || req.credential_id !== credentialId)
        throw badRequest("approval_id does not match this credential");
      if (req.status === "consumed") throw conflict("approval already used");
      if (req.status === "denied") throw new AppError("reveal_denied", "reveal request was denied", 403);
      if (req.status !== "approved") throw approvalRequired(req.id);
      return req.id;
    }
    // No approval supplied — reuse an existing pending request for this
    // (credential, requester) instead of spamming new ones, then block.
    const existing = this.repo
      .listRevealRequests()
      .find(
        (r) => r.status === "pending" && r.credential_id === credentialId && r.requested_by === requester,
      );
    if (existing) throw approvalRequired(existing.id);

    const req: RevealRequest = {
      id: newId("rreq"),
      credential_id: credentialId,
      target_id: input.target_id,
      requested_by: requester,
      purpose: input.purpose,
      ttl_seconds: input.ttl_seconds,
      status: "pending",
      created_at: nowIso(),
      decided_at: null,
      decided_by: null,
    };
    this.repo.createRevealRequest(req);
    this.audit({
      actor: requester,
      action: "reveal_approval_requested",
      resource_type: "credential",
      resource_id: credentialId,
      target_id: input.target_id,
      credential_id: credentialId,
      purpose: input.purpose,
      risk_level: "medium",
      metadata_redacted: { reveal_request_id: req.id },
    });
    throw approvalRequired(req.id);
  }

  listRevealRequests(): RevealRequest[] {
    return this.repo.listRevealRequests();
  }

  getRevealRequest(id: string): RevealRequest {
    const r = this.repo.getRevealRequest(id);
    if (!r) throw notFound("reveal_request", id);
    return r;
  }

  decideRevealRequest(id: string, approved: boolean, input: DecideRevealRequestInput): RevealRequest {
    const req = this.getRevealRequest(id);
    if (req.status !== "pending") throw conflict(`request already ${req.status}`);
    // Separation of duties: the approver's identity must differ from the
    // requester's. Blocks an agent (or a shared root token) from approving its
    // own gated reveal — the hole flagged in docs/security-model.md.
    if (approved && input.decided_by === req.requested_by)
      throw forbidden("approver must differ from requester (separation of duties)");
    const updated = this.repo.updateRevealRequest(id, {
      status: approved ? "approved" : "denied",
      decided_at: nowIso(),
      decided_by: input.decided_by,
    });
    this.audit({
      actor: input.decided_by,
      action: approved ? "reveal_approved" : "reveal_denied",
      resource_type: "credential",
      resource_id: req.credential_id,
      target_id: req.target_id,
      credential_id: req.credential_id,
      purpose: req.purpose,
      risk_level: "medium",
      metadata_redacted: { reveal_request_id: id },
    });
    return updated!;
  }

  // -------- checkout (RECOMMENDED) --------
  async checkout(targetId: string, input: CheckoutInput, actor?: string): Promise<CheckoutResult> {
    const target = this.getTarget(targetId);
    const provider = this.checkouts.get(input.mode);
    if (!provider) throw notSupported(`checkout mode not available: ${input.mode}`);

    const credential = this.pickCheckoutCredential(target, input.credential_id);
    if (!provider.supports(target, credential))
      throw badRequest(
        `checkout mode ${input.mode} does not support credential type ${credential.type}`,
      );

    const backend = this.backendFor(credential.provider);
    // Secret is read into THIS process only to materialize temp access — it is
    // never returned to the caller (that is what reveal_secret is for).
    const secret = await backend.revealSecret(credential.secret_ref, {
      credential_id: credential.id,
      requested_by: input.requested_by,
      purpose: input.purpose,
    });

    const ts = nowIso();
    const id = newId("chk");
    const artifact = await provider.create({
      checkout_id: id,
      target,
      credential,
      secret_value: secret,
      ttl_seconds: input.ttl_seconds,
    });

    const session: CheckoutSession = {
      id,
      target_id: target.id,
      credential_id: credential.id,
      mode: input.mode,
      requested_by: input.requested_by,
      purpose: input.purpose,
      checkout_path: artifact.checkout_path,
      ssh_command: artifact.ssh_command,
      expires_at: addSeconds(ts, input.ttl_seconds),
      revoked_at: null,
      status: "active",
      created_at: ts,
    };
    this.repo.createCheckout(session);

    this.audit({
      actor: actor ?? input.requested_by,
      action: "checkout_ssh_access",
      resource_type: "target",
      resource_id: target.id,
      target_id: target.id,
      credential_id: credential.id,
      purpose: input.purpose,
      risk_level: riskForEnv(target.environment, "medium"),
      metadata_redacted: {
        checkout_id: id,
        mode: input.mode,
        ttl_seconds: input.ttl_seconds,
      },
    });

    return {
      checkout_id: id,
      mode: input.mode,
      ssh_command: session.ssh_command,
      checkout_path: session.checkout_path,
      expires_at: session.expires_at,
    };
  }

  private pickCheckoutCredential(target: Target, explicitId?: string): Credential {
    if (explicitId) return this.getCredential(explicitId);
    const candidates = target.credential_ids
      .map((cid) => this.repo.getCredential(cid))
      .filter((c): c is Credential => c != null);
    const sshKey = candidates.find((c) => c.type === "ssh_private_key");
    const chosen = sshKey ?? candidates[0];
    if (!chosen)
      throw badRequest("target has no usable credential; pass credential_id explicitly");
    return chosen;
  }

  listCheckouts(): CheckoutSession[] {
    return this.repo.listCheckouts();
  }

  getCheckout(id: string): CheckoutSession {
    const s = this.repo.getCheckout(id);
    if (!s) throw notFound("checkout", id);
    return s;
  }

  async revokeCheckout(id: string): Promise<CheckoutSession> {
    const s = this.getCheckout(id);
    if (s.status === "active") {
      const provider = this.checkouts.get(s.mode);
      if (provider) await provider.cleanup(s);
    }
    const updated = this.repo.updateCheckout(id, {
      status: "revoked",
      revoked_at: nowIso(),
    });
    this.audit({
      actor: "system",
      action: "revoke_checkout",
      resource_type: "checkout",
      resource_id: id,
      target_id: s.target_id,
      credential_id: s.credential_id,
      purpose: null,
      risk_level: "low",
      metadata_redacted: {},
    });
    return updated!;
  }

  /** Clean up expired checkouts and mark expired reveals. Run on start + on a timer. */
  async sweepExpired(): Promise<{ checkouts: number; reveals: number }> {
    // Checkouts need a per-session side effect (wipe temp key artifacts), so we
    // still iterate — but only over active sessions, not the whole table.
    let checkouts = 0;
    for (const s of this.repo.listActiveCheckouts()) {
      if (isPast(s.expires_at)) {
        const provider = this.checkouts.get(s.mode);
        if (provider) await provider.cleanup(s);
        this.repo.updateCheckout(s.id, { status: "expired" });
        checkouts++;
      }
    }
    // Reveals have no side effect on expiry — expire them all in one statement.
    const reveals = this.repo.expireReveals(nowIso());
    if (checkouts || reveals) this.log.info("sweep_expired", { checkouts, reveals });
    return { checkouts, reveals };
  }

  /**
   * Create scheduled rotation jobs for credentials whose next_rotation_due_at has
   * passed and that don't already have an open job. This is what makes
   * rotation_interval_days actually fire.
   */
  scanDueRotations(): number {
    const openByCred = new Set(
      this.repo
        .listRotationJobs()
        .filter((j) => j.status === "pending" || j.status === "running")
        .map((j) => j.credential_id),
    );
    let created = 0;
    for (const c of this.repo.listCredentials()) {
      if (c.status === "revoked" || openByCred.has(c.id)) continue;
      if (c.next_rotation_due_at && isPast(c.next_rotation_due_at)) {
        this.repo.updateCredential(c.id, { status: "rotation_required", updated_at: nowIso() });
        this.createRotationJob(c.id, { target_id: null, reason: "scheduled" });
        created++;
      }
    }
    if (created) this.log.info("scan_due_rotations", { created });
    return created;
  }

  /** Delete terminal reveals/checkouts/reveal-requests older than retentionDays so tables don't grow forever. */
  pruneOld(retentionDays = 30): { reveals: number; checkouts: number; reveal_requests: number } {
    const before = addDays(nowIso(), -retentionDays);
    const reveals = this.repo.pruneReveals(before);
    const checkouts = this.repo.pruneCheckouts(before);
    const reveal_requests = this.repo.pruneRevealRequests(before);
    // Tombstones kept much longer than other records so deletions still
    // propagate to devices that sync infrequently.
    this.repo.pruneTombstones(addDays(nowIso(), -Math.max(retentionDays, 90)));
    if (reveals || checkouts || reveal_requests)
      this.log.info("prune_old", { reveals, checkouts, reveal_requests, retentionDays });
    return { reveals, checkouts, reveal_requests };
  }

  // -------- sync support (export/apply the full state; secrets included) --------
  /** Full portable snapshot. Secrets are decrypted for local_encrypted creds so
   * another device can re-store them. Caller MUST encrypt before it leaves the host. */
  async exportBundle(): Promise<SyncBundle> {
    const credentials: SyncCredential[] = [];
    for (const c of this.repo.listCredentials()) {
      let secret: string | null = null;
      if (c.provider === "local_encrypted") {
        secret = await this.backendFor(c.provider).revealSecret(c.secret_ref, {
          credential_id: c.id,
          requested_by: "sync",
          purpose: "sync-export",
        });
      }
      credentials.push({ ...c, secret });
    }
    return {
      targets: this.repo.listTargets(),
      credentials,
      rotation_policies: this.repo.listRotationPolicies(),
      tombstones: this.repo.listTombstones(),
    };
  }

  /** Apply a merged bundle to local state: honor tombstones, then upsert. Secrets
   * for local_encrypted creds are re-stored under a fresh local secret_ref. */
  async applyBundle(b: SyncBundle): Promise<void> {
    for (const tomb of b.tombstones) {
      if (tomb.entity === "target" && this.repo.getTarget(tomb.id)) this.repo.deleteTarget(tomb.id);
      if (tomb.entity === "credential") {
        const c = this.repo.getCredential(tomb.id);
        if (c) {
          await this.backendFor(c.provider).deleteSecret(c.secret_ref).catch(() => {});
          this.repo.deleteCredential(tomb.id);
        }
      }
      this.repo.addTombstone(tomb);
    }
    for (const t of b.targets)
      this.repo.getTarget(t.id) ? this.repo.updateTarget(t.id, t) : this.repo.createTarget(t);
    for (const p of b.rotation_policies)
      this.repo.getRotationPolicy(p.id) ? this.repo.updateRotationPolicy(p.id, p) : this.repo.createRotationPolicy(p);
    for (const sc of b.credentials) {
      const { secret, ...meta } = sc;
      const existing = this.repo.getCredential(meta.id);
      if (meta.provider === "local_encrypted" && secret != null) {
        if (existing) {
          await this.backendFor(meta.provider).updateSecret(existing.secret_ref, secret);
          this.repo.updateCredential(meta.id, { ...meta, secret_ref: existing.secret_ref });
        } else {
          const { secret_ref } = await this.backendFor(meta.provider).putSecret({ type: meta.type, secret_value: secret });
          this.repo.createCredential({ ...meta, secret_ref });
        }
      } else {
        existing ? this.repo.updateCredential(meta.id, meta) : this.repo.createCredential(meta);
      }
    }
  }

  /** Operational snapshot for /health and dashboards. */
  stats(): Record<string, number> {
    const creds = this.repo.listCredentials();
    return {
      targets: this.repo.listTargets().length,
      credentials: creds.length,
      credentials_rotation_required: creds.filter((c) => c.status === "rotation_required").length,
      active_checkouts: this.repo.listCheckouts().filter((s) => s.status === "active").length,
      active_reveals: this.repo.listReveals().filter((r) => r.status === "active").length,
      pending_rotation_jobs: this.repo.listRotationJobs().filter((j) => j.status === "pending").length,
      pending_reveal_requests: this.repo.listRevealRequests().filter((r) => r.status === "pending").length,
    };
  }

  // -------- rotation policies --------
  createRotationPolicy(input: RotationPolicyInput): RotationPolicy {
    const ts = nowIso();
    const p: RotationPolicy = { id: newId("rpol"), ...input, created_at: ts, updated_at: ts };
    this.repo.createRotationPolicy(p);
    return p;
  }

  listRotationPolicies(): RotationPolicy[] {
    return this.repo.listRotationPolicies();
  }

  updateRotationPolicy(id: string, patch: UpdateRotationPolicyInput): RotationPolicy {
    const updated = this.repo.updateRotationPolicy(id, { ...patch, updated_at: nowIso() });
    if (!updated) throw notFound("rotation_policy", id);
    return updated;
  }

  // -------- rotation jobs --------
  createRotationJob(credentialId: string, input: CreateRotationJobInput): RotationJob {
    const c = this.getCredential(credentialId);
    const job: RotationJob = {
      id: newId("rjob"),
      credential_id: c.id,
      target_id: input.target_id,
      reason: input.reason,
      status: "pending",
      old_secret_version: null,
      new_secret_version: null,
      started_at: null,
      completed_at: null,
      error_message: null,
      created_at: nowIso(),
    };
    this.repo.createRotationJob(job);
    this.audit({
      actor: "system",
      action: "rotation_required",
      resource_type: "credential",
      resource_id: c.id,
      target_id: input.target_id,
      credential_id: c.id,
      purpose: null,
      risk_level: "medium",
      metadata_redacted: { rotation_job_id: job.id, reason: input.reason },
    });
    return job;
  }

  listRotationJobs(): RotationJob[] {
    return this.repo.listRotationJobs();
  }

  getRotationJob(id: string): RotationJob {
    const j = this.repo.getRotationJob(id);
    if (!j) throw notFound("rotation_job", id);
    return j;
  }

  async markRotationSuccess(
    jobId: string,
    input: MarkRotationSuccessInput,
  ): Promise<RotationJob> {
    const job = this.getRotationJob(jobId);
    if (job.status === "success") throw conflict("rotation job already completed");
    const c = this.getCredential(job.credential_id);
    const ts = nowIso();

    // Persist the new secret material through the credential backend.
    const { version } = await this.backendFor(c.provider).updateSecret(
      c.secret_ref,
      input.new_secret_value,
    );
    const policy = c.rotation_policy_id
      ? this.repo.getRotationPolicy(c.rotation_policy_id)
      : null;

    this.repo.updateCredential(c.id, {
      last_rotated_at: ts,
      reveal_count_since_rotation: 0,
      status: "active",
      next_rotation_due_at:
        policy?.rotation_interval_days != null
          ? addDays(ts, policy.rotation_interval_days)
          : null,
      updated_at: ts,
    });

    const updated = this.repo.updateRotationJob(jobId, {
      status: "success",
      started_at: job.started_at ?? ts,
      completed_at: ts,
      old_secret_version: job.old_secret_version,
      new_secret_version: input.new_secret_version ?? version,
    });

    // Any active reveal of this credential is now stale.
    for (const r of this.repo.listReveals())
      if (r.credential_id === c.id && r.status === "active")
        this.repo.updateReveal(r.id, { status: "rotated" });

    this.audit({
      actor: "system",
      action: "rotation_success",
      resource_type: "credential",
      resource_id: c.id,
      target_id: job.target_id,
      credential_id: c.id,
      purpose: null,
      risk_level: "medium",
      metadata_redacted: { rotation_job_id: jobId, new_secret_version: version },
    });
    return updated!;
  }

  markRotationFailed(jobId: string, input: MarkRotationFailedInput): RotationJob {
    const job = this.getRotationJob(jobId);
    const ts = nowIso();
    const updated = this.repo.updateRotationJob(jobId, {
      status: "failed",
      started_at: job.started_at ?? ts,
      completed_at: ts,
      error_message: input.error_message,
    });
    // Back off scheduled retries: only interval-based credentials carry a due
    // date; push it forward so scanDueRotations doesn't recreate a job every tick.
    const cred = this.repo.getCredential(job.credential_id);
    if (cred?.next_rotation_due_at) {
      this.repo.updateCredential(cred.id, {
        next_rotation_due_at: addMinutes(ts, this.rotationBackoffMinutes),
        updated_at: ts,
      });
    }
    this.audit({
      actor: "system",
      action: "rotation_failed",
      resource_type: "credential",
      resource_id: job.credential_id,
      target_id: job.target_id,
      credential_id: job.credential_id,
      purpose: null,
      risk_level: "medium",
      metadata_redacted: { rotation_job_id: jobId },
    });
    return updated!;
  }

  /** Exposed for future auto-rotation wiring; manual flow is the MVP path. */
  get rotationProviders(): RotationProvider[] {
    return this.rotations;
  }

  /**
   * Run any pending rotation jobs whose credential opts into auto-rotation
   * (policy.auto_rotate_enabled) and whose type a RotationProvider supports.
   * Manual jobs (no provider / not auto) are left for mark_rotation_complete.
   */
  async runAutoRotations(): Promise<{ ran: number; failed: number }> {
    let ran = 0;
    let failed = 0;
    for (const job of this.repo.listRotationJobs()) {
      if (job.status !== "pending") continue;
      const cred = this.repo.getCredential(job.credential_id);
      if (!cred) continue;
      const policy = cred.rotation_policy_id
        ? this.repo.getRotationPolicy(cred.rotation_policy_id)
        : null;
      if (!policy?.auto_rotate_enabled) continue;
      const provider = this.rotations.find((p) => p.supports(cred.type));
      if (!provider) continue;

      this.repo.updateRotationJob(job.id, { status: "running", started_at: nowIso() });
      try {
        const target = job.target_id ? this.repo.getTarget(job.target_id) : null;
        const { new_secret_value, version } = await provider.rotate({ credential: cred, target });
        await this.markRotationSuccess(job.id, { new_secret_value, new_secret_version: version });
        ran++;
      } catch (e) {
        this.markRotationFailed(job.id, { error_message: (e as Error).message });
        failed++;
      }
    }
    if (ran || failed) this.log.info("auto_rotations", { ran, failed });
    return { ran, failed };
  }
}
