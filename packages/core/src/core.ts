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
import { AppError, approvalRequired, badRequest, conflict, notFound, notSupported } from "./errors.js";
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
  readonly log: Logger;

  constructor(deps: CoreDeps) {
    this.repo = deps.repo;
    this.backends = new Map(deps.backends.map((b) => [b.kind, b]));
    this.checkouts = new Map(deps.checkoutProviders.map((c) => [c.mode, c]));
    this.rotations = deps.rotationProviders ?? [];
    this.rotationBackoffMinutes = deps.rotationBackoffMinutes ?? 60;
    this.log = deps.logger ?? createLogger();
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
  }

  listAudit(query: AuditQuery = {}): AuditLog[] {
    let out = this.repo.listAudit(query.limit ?? 200);
    if (query.actor) out = out.filter((a) => a.actor === query.actor);
    if (query.action) out = out.filter((a) => a.action === query.action);
    if (query.risk_level) out = out.filter((a) => a.risk_level === query.risk_level);
    return out;
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
  }

  // -------- reveal (HIGH RISK) --------
  async reveal(credentialId: string, input: RevealInput): Promise<RevealResult> {
    const c = this.getCredential(credentialId);
    if (c.status === "revoked") throw conflict("credential is revoked");

    const policyForApproval = c.rotation_policy_id
      ? this.repo.getRotationPolicy(c.rotation_policy_id)
      : null;
    // Resolve (but do NOT consume) the approval up front; consume only after the
    // reveal actually succeeds so a transient failure doesn't waste the approval.
    const approvalToConsume = policyForApproval?.approval_required
      ? this.resolveApproval(c.id, input)
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
      actor: input.requested_by,
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
  private resolveApproval(credentialId: string, input: RevealInput): string {
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
        (r) => r.status === "pending" && r.credential_id === credentialId && r.requested_by === input.requested_by,
      );
    if (existing) throw approvalRequired(existing.id);

    const req: RevealRequest = {
      id: newId("rreq"),
      credential_id: credentialId,
      target_id: input.target_id,
      requested_by: input.requested_by,
      purpose: input.purpose,
      ttl_seconds: input.ttl_seconds,
      status: "pending",
      created_at: nowIso(),
      decided_at: null,
      decided_by: null,
    };
    this.repo.createRevealRequest(req);
    this.audit({
      actor: input.requested_by,
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
  async checkout(targetId: string, input: CheckoutInput): Promise<CheckoutResult> {
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
      actor: input.requested_by,
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
    let checkouts = 0;
    for (const s of this.repo.listCheckouts()) {
      if (s.status === "active" && isPast(s.expires_at)) {
        const provider = this.checkouts.get(s.mode);
        if (provider) await provider.cleanup(s);
        this.repo.updateCheckout(s.id, { status: "expired" });
        checkouts++;
      }
    }
    let reveals = 0;
    for (const r of this.repo.listReveals()) {
      if (r.status === "active" && isPast(r.expires_at)) {
        this.repo.updateReveal(r.id, { status: "expired" });
        reveals++;
      }
    }
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
    if (reveals || checkouts || reveal_requests)
      this.log.info("prune_old", { reveals, checkouts, reveal_requests, retentionDays });
    return { reveals, checkouts, reveal_requests };
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
