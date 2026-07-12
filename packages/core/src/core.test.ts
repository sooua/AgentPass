import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SqliteStore } from "@agentpass/storage-sqlite";
import { LocalEncryptedStoreProvider } from "@agentpass/credential-providers";
import { TempKeyFileCheckoutProvider } from "@agentpass/checkout-providers";
import { SshKeyRotationProvider } from "@agentpass/rotation-providers";
import { AgentPassCore } from "./core.js";

const FAKE_PASSWORD = "FAKE-pw-do-not-use";
const FAKE_KEY = "-----BEGIN FAKE KEY-----\nnot-a-real-key\n-----END FAKE KEY-----";

let dir: string;
let core: AgentPassCore;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentpass-test-"));
  store = new SqliteStore(":memory:");
  const local = new LocalEncryptedStoreProvider(randomBytes(32), store);
  core = new AgentPassCore({
    repo: store,
    backends: [local],
    checkoutProviders: [new TempKeyFileCheckoutProvider(join(dir, "checkouts"))],
    rotationProviders: [new SshKeyRotationProvider()],
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reveal + rotation lifecycle", () => {
  it("reveals plaintext, audits, and flags rotation per policy", async () => {
    const policy = core.createRotationPolicy({
      name: "rotate-on-reveal",
      rotate_after_reveal: true,
      rotation_grace_period_minutes: 60,
      rotation_interval_days: null,
      max_reveals_before_rotation: null,
      auto_rotate_enabled: false,
      approval_required: false,
    });
    const cred = await core.createCredential({
      name: "db-pw",
      type: "password",
      provider: "local_encrypted",
      secret_value: FAKE_PASSWORD,
      metadata: {},
      rotation_policy_id: policy.id,
    });

    const res = await core.reveal(cred.id, {
      target_id: null,
      requested_by: "tester",
      purpose: "unit test",
      ttl_seconds: 300,
    });

    expect(res.secret_value).toBe(FAKE_PASSWORD);
    expect(res.rotation_required).toBe(true);
    expect(res.rotation_job_id).toBeTruthy();

    expect(core.getCredential(cred.id).status).toBe("rotation_required");
    expect(core.getCredential(cred.id).reveal_count_since_rotation).toBe(1);

    const audit = core.listAudit();
    expect(audit.some((a) => a.action === "reveal_secret")).toBe(true);
    expect(audit.some((a) => a.action === "rotation_required")).toBe(true);
    // secrets never land in audit metadata
    expect(JSON.stringify(audit)).not.toContain(FAKE_PASSWORD);

    const jobs = core.listRotationJobs();
    expect(jobs).toHaveLength(1);

    const done = await core.markRotationSuccess(jobs[0]!.id, { new_secret_value: "FAKE-pw-2" });
    expect(done.status).toBe("success");
    const after = core.getCredential(cred.id);
    expect(after.status).toBe("active");
    expect(after.reveal_count_since_rotation).toBe(0);
    // new secret is what reveal now returns
    const res2 = await core.reveal(cred.id, { target_id: null, requested_by: "t", purpose: "p", ttl_seconds: 60 });
    expect(res2.secret_value).toBe("FAKE-pw-2");
  });

  it("does not flag rotation without a policy", async () => {
    const cred = await core.createCredential({
      name: "token", type: "api_token", provider: "local_encrypted",
      secret_value: "FAKE-token", metadata: {}, rotation_policy_id: null,
    });
    const res = await core.reveal(cred.id, { target_id: null, requested_by: "t", purpose: "p", ttl_seconds: 60 });
    expect(res.rotation_required).toBe(false);
    expect(core.getCredential(cred.id).status).toBe("active");
  });
});

describe("auto rotation", () => {
  it("runs a pending job via ssh-keygen when policy opts in", async () => {
    const policy = core.createRotationPolicy({
      name: "auto",
      rotate_after_reveal: true,
      rotation_grace_period_minutes: 0,
      rotation_interval_days: null,
      max_reveals_before_rotation: null,
      auto_rotate_enabled: true,
      approval_required: false,
    });
    const cred = await core.createCredential({
      name: "vps-key", type: "ssh_private_key", provider: "local_encrypted",
      secret_value: FAKE_KEY, metadata: {}, rotation_policy_id: policy.id,
    });
    // reveal flags rotation + creates a pending job
    await core.reveal(cred.id, { target_id: null, requested_by: "t", purpose: "p", ttl_seconds: 60 });
    expect(core.listRotationJobs().some((j) => j.status === "pending")).toBe(true);

    const res = await core.runAutoRotations();
    expect(res.ran).toBe(1);

    const after = core.getCredential(cred.id);
    expect(after.status).toBe("active");
    expect(after.reveal_count_since_rotation).toBe(0);
    // secret was replaced with a real generated key, not the fake input
    const revealed = await core.reveal(cred.id, { target_id: null, requested_by: "t", purpose: "p", ttl_seconds: 60 });
    expect(revealed.secret_value).not.toBe(FAKE_KEY);
    expect(revealed.secret_value).toContain("OPENSSH PRIVATE KEY");
  });
});

describe("approval gate", () => {
  const policyWithApproval = () =>
    core.createRotationPolicy({
      name: "needs-approval", rotate_after_reveal: false, rotation_grace_period_minutes: 0,
      rotation_interval_days: null, max_reveals_before_rotation: null,
      auto_rotate_enabled: false, approval_required: true,
    });

  it("blocks reveal without approval, then allows it once approved", async () => {
    const p = policyWithApproval();
    const cred = await core.createCredential({
      name: "prod-pw", type: "password", provider: "local_encrypted",
      secret_value: FAKE_PASSWORD, metadata: {}, rotation_policy_id: p.id,
    });
    const revealArgs = { target_id: null, requested_by: "agent", purpose: "p", ttl_seconds: 60 };

    await expect(core.reveal(cred.id, revealArgs)).rejects.toMatchObject({ code: "approval_required" });
    const reqs = core.listRevealRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.status).toBe("pending");

    core.decideRevealRequest(reqs[0]!.id, true, { decided_by: "me" });
    const res = await core.reveal(cred.id, { ...revealArgs, approval_id: reqs[0]!.id });
    expect(res.secret_value).toBe(FAKE_PASSWORD);
    // approval is single-use
    await expect(core.reveal(cred.id, { ...revealArgs, approval_id: reqs[0]!.id })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("delete cascade", () => {
  it("unlinks credential from targets and revokes its checkouts on delete", async () => {
    const cred = await core.createCredential({
      name: "k", type: "ssh_private_key", provider: "local_encrypted",
      secret_value: FAKE_KEY, metadata: {}, rotation_policy_id: null,
    });
    const target = core.createTarget({
      name: "h", type: "ssh", host: "1.1.1.1", port: 22, username: "u",
      tags: [], environment: "dev", credential_ids: [cred.id],
    });
    const chk = await core.checkout(target.id, { purpose: "p", requested_by: "a", ttl_seconds: 900, mode: "temp_key_file" });

    await core.deleteCredential(cred.id);
    expect(core.getTarget(target.id).credential_ids).not.toContain(cred.id);
    expect(core.getCheckout(chk.checkout_id).status).toBe("revoked");
  });
});

describe("scheduled rotation scan", () => {
  it("enqueues a job when next_rotation_due_at has passed", async () => {
    const cred = await core.createCredential({
      name: "t", type: "api_token", provider: "local_encrypted",
      secret_value: "FAKE", metadata: {}, rotation_policy_id: null,
    });
    store.updateCredential(cred.id, { next_rotation_due_at: "2000-01-01T00:00:00.000Z" });
    expect(core.scanDueRotations()).toBe(1);
    expect(core.getCredential(cred.id).status).toBe("rotation_required");
    expect(core.listRotationJobs().some((j) => j.reason === "scheduled")).toBe(true);
    // idempotent: an open job already exists
    expect(core.scanDueRotations()).toBe(0);
  });
});

describe("prune", () => {
  it("deletes terminal reveals older than retention", async () => {
    const cred = await core.createCredential({
      name: "t", type: "api_token", provider: "local_encrypted",
      secret_value: "FAKE", metadata: {}, rotation_policy_id: null,
    });
    const r = await core.reveal(cred.id, { target_id: null, requested_by: "a", purpose: "p", ttl_seconds: 60 });
    store.updateReveal(r.reveal_id, { status: "expired", revealed_at: "2000-01-01T00:00:00.000Z" });
    expect(core.pruneOld(30).reveals).toBe(1);
    expect(core.listReveals()).toHaveLength(0);
  });
});

describe("ssh checkout", () => {
  it("issues an ssh_command and cleans up on revoke", async () => {
    const cred = await core.createCredential({
      name: "vps-key", type: "ssh_private_key", provider: "local_encrypted",
      secret_value: FAKE_KEY, metadata: {}, rotation_policy_id: null,
    });
    const target = core.createTarget({
      name: "web-01", type: "ssh", host: "10.0.0.5", port: 22, username: "deploy",
      tags: [], environment: "dev", credential_ids: [cred.id],
    });

    const chk = await core.checkout(target.id, {
      purpose: "deploy", requested_by: "agent", ttl_seconds: 900, mode: "temp_key_file",
    });
    expect(chk.ssh_command).toContain("ssh -F");
    expect(chk.checkout_path && existsSync(chk.checkout_path)).toBe(true);

    await core.revokeCheckout(chk.checkout_id);
    expect(core.getCheckout(chk.checkout_id).status).toBe("revoked");
    expect(existsSync(chk.checkout_path!)).toBe(false);
  });
});
