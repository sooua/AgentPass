import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AgentPassCore } from "@agentpass/core";
import { LocalEncryptedStoreProvider } from "@agentpass/credential-providers";
import { TempKeyFileCheckoutProvider } from "@agentpass/checkout-providers";
import { SqliteStore } from "@agentpass/storage-sqlite";
import { SyncEngine } from "@agentpass/sync";
import { buildServer } from "./server.js";
import type { DaemonConfig } from "./config.js";

const TOKEN = "test-token-123";
const auth = { authorization: `Bearer ${TOKEN}` };

let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "agentpass-daemon-test-"));
  const store = new SqliteStore(":memory:");
  const core = new AgentPassCore({
    repo: store,
    backends: [new LocalEncryptedStoreProvider(randomBytes(32), store)],
    checkoutProviders: [new TempKeyFileCheckoutProvider(join(dir, "checkouts"))],
  });
  const cfg = {
    host: "127.0.0.1", port: 0, home: dir, dbPath: ":memory:",
    keyPath: join(dir, "k"), checkoutDir: join(dir, "checkouts"),
    syncConfigPath: join(dir, "sync.json"), token: TOKEN, uiDir: null,
  } satisfies DaemonConfig;
  const engine = new SyncEngine(core, join(dir, "sync.json"));
  app = await buildServer(core, engine, cfg);
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: auth, payload });

describe("daemon HTTP", () => {
  it("serves health without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(res.json().stats).toBeTypeOf("object");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/targets" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await app.inject({ method: "GET", url: "/targets", headers: { authorization: "Bearer nope" } });
    expect(res.statusCode).toBe(401);
  });

  it("runs the full target→credential→reveal→checkout flow with cascade", async () => {
    const cred = (await post("/credentials", {
      name: "vps-key", type: "ssh_private_key",
      secret_value: "-----BEGIN FAKE KEY-----\nx\n-----END FAKE KEY-----",
    })).json();
    const target = (await post("/targets", {
      name: "web", type: "ssh", host: "10.0.0.1", port: 22, username: "deploy",
      credential_ids: [cred.id],
    })).json();

    const chk = (await post(`/targets/${target.id}/checkout`, {
      requested_by: "agent", purpose: "deploy", ttl_seconds: 900, mode: "temp_key_file",
    })).json();
    expect(chk.ssh_command).toContain("ssh -F");

    // delete credential → target unlinked, checkout revoked (cascade)
    const del = await app.inject({ method: "DELETE", url: `/credentials/${cred.id}`, headers: auth });
    expect(del.statusCode).toBe(204);
    const t2 = (await app.inject({ method: "GET", url: `/targets/${target.id}`, headers: auth })).json();
    expect(t2.credential_ids).not.toContain(cred.id);
    const c2 = (await app.inject({ method: "GET", url: `/checkouts/${chk.checkout_id}`, headers: auth })).json();
    expect(c2.status).toBe("revoked");
  });

  it("rejects an oversized secret (>1 MiB)", async () => {
    const res = await post("/credentials", { name: "big", type: "api_token", secret_value: "x".repeat(1024 * 1024 + 1) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  // ---- B3: scoped agent tokens ----
  const authWith = (t: string) => ({ authorization: `Bearer ${t}` });
  const mkToken = async (body: unknown) => (await post("/agent-tokens", body)).json();

  it("creates a scoped token: plaintext returned once, list omits the hash", async () => {
    const created = await mkToken({ name: "ci", capabilities: ["list"] });
    expect(created.token).toMatch(/^apat_/);
    expect(created.token_hash).toBeUndefined();

    const list = (await app.inject({ method: "GET", url: "/agent-tokens", headers: auth })).json();
    expect(list.tokens).toHaveLength(1);
    expect(list.tokens[0].name).toBe("ci");
    expect(list.tokens[0].token_hash).toBeUndefined();
    expect(JSON.stringify(list.tokens[0])).not.toContain(created.token);
  });

  it("scoped token: allowed capability passes, missing capability is 403", async () => {
    const { token } = await mkToken({ name: "reader", capabilities: ["list"] });
    const ok = await app.inject({ method: "GET", url: "/targets", headers: authWith(token) });
    expect(ok.statusCode).toBe(200);
    // create target requires admin → forbidden
    const denied = await app.inject({
      method: "POST", url: "/targets", headers: authWith(token),
      payload: { name: "x", type: "ssh", host: "h", username: "u", credential_ids: [] },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("forbidden");
  });

  it("scoped token: reveal allowed for whitelisted env, 403 for another env", async () => {
    const cred = (await post("/credentials", { name: "pw", type: "password", secret_value: "S3CR3T" })).json();
    const devT = (await post("/targets", {
      name: "d", type: "ssh", host: "h", port: 22, username: "u", environment: "dev", credential_ids: [cred.id],
    })).json();
    const prodT = (await post("/targets", {
      name: "p", type: "ssh", host: "h", port: 22, username: "u", environment: "prod", credential_ids: [cred.id],
    })).json();
    const { token } = await mkToken({ name: "dev-agent", capabilities: ["reveal"], environments: ["dev"] });

    const okRes = await app.inject({
      method: "POST", url: `/credentials/${cred.id}/reveal`, headers: authWith(token),
      payload: { requested_by: "self", purpose: "p", ttl_seconds: 60, target_id: devT.id },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().secret_value).toBe("S3CR3T");

    const prodRes = await app.inject({
      method: "POST", url: `/credentials/${cred.id}/reveal`, headers: authWith(token),
      payload: { requested_by: "self", purpose: "p", ttl_seconds: 60, target_id: prodT.id },
    });
    expect(prodRes.statusCode).toBe(403);
    expect(prodRes.json().error.message).toContain("prod");
  });

  it("audit actor is the token name, not requested_by", async () => {
    const cred = (await post("/credentials", { name: "pw", type: "password", secret_value: "S" })).json();
    const t = (await post("/targets", {
      name: "d", type: "ssh", host: "h", port: 22, username: "u", environment: "dev", credential_ids: [cred.id],
    })).json();
    const { token } = await mkToken({ name: "billing-agent", capabilities: ["reveal"] });
    await app.inject({
      method: "POST", url: `/credentials/${cred.id}/reveal`, headers: authWith(token),
      payload: { requested_by: "lies", purpose: "p", ttl_seconds: 60, target_id: t.id },
    });
    const logs = (await app.inject({ method: "GET", url: "/audit-logs", headers: auth })).json().logs;
    const reveal = logs.find((l: { action: string }) => l.action === "reveal_secret");
    expect(reveal.actor).toBe("billing-agent");
  });

  it("rejects a revoked or expired token", async () => {
    const created = await mkToken({ name: "temp", capabilities: ["list"] });
    await post(`/agent-tokens/${created.id}/revoke`, {});
    const revoked = await app.inject({ method: "GET", url: "/targets", headers: authWith(created.token) });
    expect(revoked.statusCode).toBe(401);

    const expired = await mkToken({
      name: "old", capabilities: ["list"], expires_at: "2000-01-01T00:00:00.000Z",
    });
    const res = await app.inject({ method: "GET", url: "/targets", headers: authWith(expired.token) });
    expect(res.statusCode).toBe(401);
  });

  it("gates reveal behind approval when the policy requires it", async () => {
    const pol = (await post("/rotation-policies", { name: "gated", approval_required: true, rotate_after_reveal: false })).json();
    const cred = (await post("/credentials", { name: "pw", type: "password", secret_value: "FAKE", rotation_policy_id: pol.id })).json();

    const blocked = await post(`/credentials/${cred.id}/reveal`, { requested_by: "a", purpose: "p", ttl_seconds: 60 });
    expect(blocked.statusCode).toBe(403);
    const requestId = blocked.json().error.data.reveal_request_id;

    await post(`/reveal-requests/${requestId}/approve`, { decided_by: "me" });
    const okRes = await post(`/credentials/${cred.id}/reveal`, { requested_by: "a", purpose: "p", ttl_seconds: 60, approval_id: requestId });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().secret_value).toBe("FAKE");
  });
});
