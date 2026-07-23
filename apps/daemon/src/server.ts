import { timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z, ZodError, type ZodTypeAny } from "zod";
import { AppError, forbidden, notFound, type AgentPassCore } from "@agentpass/core";
import { decryptPayload, encryptPayload, type SyncEngine } from "@agentpass/sync";
import {
  MAX_SECRET_BYTES,
  auditQuerySchema,
  checkoutSchema,
  createAgentTokenSchema,
  createCredentialSchema,
  createRotationJobSchema,
  createTargetSchema,
  credentialQuerySchema,
  markRotationFailedSchema,
  markRotationSuccessSchema,
  revealSchema,
  rotationPolicySchema,
  targetQuerySchema,
  updateCredentialSchema,
  updateRotationPolicySchema,
  updateTargetSchema,
  type AgentToken,
  type AuditLog,
  type Capability,
  type RevealInput,
} from "@agentpass/shared";
import type { DaemonConfig } from "./config.js";

// Single source of truth for the version — read from package.json so it can't
// drift from the release. Resolves relative to this file in both dist and src.
// The single-file bundle shipped inside the desktop app has no package.json
// next to it, so build.mjs inlines the same value as __AGENTPASS_VERSION__.
declare const __AGENTPASS_VERSION__: string;
const VERSION: string =
  typeof __AGENTPASS_VERSION__ !== "undefined"
    ? __AGENTPASS_VERSION__
    : (createRequire(import.meta.url)("../package.json") as { version: string }).version;

/** The authenticated caller resolved by the onRequest hook. root = full-power
 * ~/.agentpass/token; token = a scoped AgentToken whose scope is enforced. */
interface AgentIdentity {
  name: string;
  root: boolean;
  token: AgentToken | null;
}

declare module "fastify" {
  interface FastifyRequest {
    agent: AgentIdentity;
  }
}

/**
 * Capability required per route (method + route pattern). Anything not listed
 * falls through to "admin" — a deny-by-default that is safe because the root
 * token bypasses this map entirely; only opt-in scoped tokens are constrained.
 */
const ROUTE_CAP: Record<string, Capability> = {
  "GET /events": "list",
  "GET /targets": "list",
  "GET /targets/:id": "list",
  "GET /credentials": "list",
  "GET /credentials/:id": "list",
  "POST /credentials/:id/reveal": "reveal",
  "GET /reveals": "list",
  "GET /reveals/:id": "list",
  "POST /reveals/:id/revoke": "reveal",
  "GET /reveal-requests": "list",
  "GET /reveal-requests/:id": "list",
  "POST /targets/:id/checkout": "checkout",
  "GET /checkouts": "list",
  "GET /checkouts/:id": "list",
  "POST /checkouts/:id/revoke": "checkout",
  "GET /rotation-policies": "list",
  "GET /rotation-jobs": "list",
  "POST /credentials/:id/rotation-jobs": "rotate",
  "POST /rotation-jobs/:id/mark-success": "rotate",
  "POST /rotation-jobs/:id/mark-failed": "rotate",
  "POST /rotation-jobs/run-auto": "rotate",
  "GET /audit-logs": "list",
};

const parse = <T>(schema: ZodTypeAny, data: unknown): T => {
  try {
    return schema.parse(data ?? {}) as T;
  } catch (e) {
    if (e instanceof ZodError)
      throw new AppError("validation_error", e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
    throw e;
  }
};

export async function buildServer(core: AgentPassCore, engine: SyncEngine, cfg: DaemonConfig): Promise<FastifyInstance> {
  // Body limit sits above MAX_SECRET_BYTES so the schema (not the transport) is
  // what rejects an oversized secret — giving a clean 400 validation_error.
  const app = Fastify({ logger: false, bodyLimit: MAX_SECRET_BYTES + 512 * 1024 });
  await app.register(cors, { origin: true }); // UI dev server is same-machine only

  // ---- auth: root token (full power) or scoped AgentToken (B3) ----
  const expected = Buffer.from(`Bearer ${cfg.token}`);
  const rootOk = (auth: string | undefined): boolean => {
    if (!auth) return false;
    const got = Buffer.from(auth);
    return got.length === expected.length && timingSafeEqual(got, expected);
  };
  const bearer = (auth: string | undefined): string | null =>
    auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    if (url === "/health" || url === "/" || url.startsWith("/ui")) return;

    const auth = req.headers["authorization"];
    if (rootOk(auth)) {
      req.agent = { name: "root", root: true, token: null };
      return;
    }
    const raw = bearer(auth);
    const token = raw ? core.tokens.authenticate(raw) : null;
    if (!token) {
      reply.code(401).send({ error: { code: "unauthorized", message: "missing or invalid token" } });
      return;
    }
    req.agent = { name: token.name, root: false, token };
    // Capability gate (env/tag scoping is enforced per-target in reveal/checkout).
    const cap = ROUTE_CAP[`${req.method} ${req.routeOptions.url ?? url}`] ?? "admin";
    core.tokens.authorize(token, { capability: cap }); // throws 403 forbidden
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError)
      return reply
        .code(err.status)
        .send({ error: { code: err.code, message: err.message, ...(err.data ? { data: err.data } : {}) } });
    if (err instanceof ZodError)
      return reply.code(400).send({ error: { code: "validation_error", message: err.message } });
    // Never leak internals (may reference secret refs). Log server-side only.
    core.log.error("unhandled_error", { message: (err as Error).message });
    return reply.code(500).send({ error: { code: "internal", message: "internal error" } });
  });

  // A scoped token must not learn about activity on targets outside its scope via
  // the event stream. Root / unrestricted tokens see everything; a scoped token
  // sees an event only if it could authorize a `list` against that target, and
  // never sees target-less events (nothing to check the scope against).
  const canSeeEvent = (agent: AgentIdentity, e: AuditLog): boolean => {
    const token = agent.token;
    if (agent.root || !token) return true;
    const scoped =
      token.environments.length > 0 || token.target_tags.length > 0 || token.target_ids.length > 0;
    if (!scoped) return true;
    if (!e.target_id) return false;
    let target;
    try {
      target = core.getTarget(e.target_id);
    } catch {
      return false; // target gone → can't prove scope → hide
    }
    try {
      core.tokens.authorize(token, {
        capability: "list",
        env: target.environment,
        targetTags: target.tags,
        targetId: target.id,
      });
      return true;
    } catch {
      return false;
    }
  };

  // ---- live change stream (SSE) — replaces UI polling ----
  app.get("/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(": connected\n\n");
    const agent = req.agent;
    const unsub = core.subscribe((e) => {
      if (!canSeeEvent(agent, e)) return;
      reply.raw.write(`data: ${JSON.stringify({ action: e.action, resource_type: e.resource_type, ts: e.timestamp })}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25000);
    req.raw.on("close", () => { clearInterval(ping); unsub(); });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "agentpass",
    version: VERSION,
    stats: core.stats(),
  }));

  // ---- targets ----
  app.get("/targets", async (req) => ({
    targets: core.listTargets(targetQuerySchema.parse(req.query ?? {})),
  }));
  app.post("/targets", async (req, reply) => {
    const t = core.createTarget(parse(createTargetSchema, req.body));
    return reply.code(201).send(t);
  });
  app.get<{ Params: { id: string } }>("/targets/:id", async (req) => core.getTarget(req.params.id));
  app.patch<{ Params: { id: string } }>("/targets/:id", async (req) =>
    core.updateTarget(req.params.id, parse(updateTargetSchema, req.body)),
  );
  app.delete<{ Params: { id: string } }>("/targets/:id", async (req, reply) => {
    await core.deleteTarget(req.params.id);
    return reply.code(204).send();
  });

  // ---- credentials ----
  app.get("/credentials", async (req) => ({
    credentials: core.listCredentials(credentialQuerySchema.parse(req.query ?? {})),
  }));
  app.post("/credentials", async (req, reply) => {
    const c = await core.createCredential(parse(createCredentialSchema, req.body));
    return reply.code(201).send(c);
  });
  app.get<{ Params: { id: string } }>("/credentials/:id", async (req) => core.getCredential(req.params.id));
  app.patch<{ Params: { id: string } }>("/credentials/:id", async (req) =>
    core.updateCredential(req.params.id, parse(updateCredentialSchema, req.body)),
  );
  app.delete<{ Params: { id: string } }>("/credentials/:id", async (req, reply) => {
    await core.deleteCredential(req.params.id);
    return reply.code(204).send();
  });

  // ---- reveal (HIGH RISK) ----
  app.post<{ Params: { id: string } }>("/credentials/:id/reveal", async (req) => {
    const input = parse<RevealInput>(revealSchema, req.body);
    const { token } = req.agent;
    if (token) {
      const target = input.target_id ? core.getTarget(input.target_id) : null;
      // A token restricted to specific environments must reveal against a target
      // so the environment can actually be checked — no target = no proof.
      if (!target && token.environments.length > 0)
        throw forbidden("scoped token must pass target_id so its environment can be verified");
      core.tokens.authorize(token, {
        capability: "reveal",
        env: target?.environment ?? null,
        targetTags: target?.tags,
        targetId: target?.id ?? null,
      });
    }
    return core.reveal(req.params.id, input, req.agent.name);
  });
  app.get("/reveals", async () => ({ reveals: core.listReveals() }));
  app.get<{ Params: { id: string } }>("/reveals/:id", async (req) => core.getReveal(req.params.id));
  app.post<{ Params: { id: string } }>("/reveals/:id/revoke", async (req) => core.revokeReveal(req.params.id));

  // ---- reveal requests (approval gate) ----
  app.get("/reveal-requests", async () => ({ requests: core.listRevealRequests() }));
  app.get<{ Params: { id: string } }>("/reveal-requests/:id", async (req) =>
    core.getRevealRequest(req.params.id),
  );
  // decided_by is the AUTHENTICATED identity, not a body field — otherwise an
  // agent could name itself anything and defeat the separation-of-duties check.
  app.post<{ Params: { id: string } }>("/reveal-requests/:id/approve", async (req) =>
    core.decideRevealRequest(req.params.id, true, { decided_by: req.agent.name }),
  );
  app.post<{ Params: { id: string } }>("/reveal-requests/:id/deny", async (req) =>
    core.decideRevealRequest(req.params.id, false, { decided_by: req.agent.name }),
  );

  // ---- checkout (RECOMMENDED) ----
  app.post<{ Params: { id: string } }>("/targets/:id/checkout", async (req) => {
    const { token } = req.agent;
    if (token) {
      const target = core.getTarget(req.params.id); // 404 if missing
      core.tokens.authorize(token, {
        capability: "checkout",
        env: target.environment,
        targetTags: target.tags,
        targetId: target.id,
      });
    }
    return core.checkout(req.params.id, parse(checkoutSchema, req.body), req.agent.name);
  });
  app.get("/checkouts", async () => ({ checkouts: core.listCheckouts() }));
  app.get<{ Params: { id: string } }>("/checkouts/:id", async (req) => core.getCheckout(req.params.id));
  app.post<{ Params: { id: string } }>("/checkouts/:id/revoke", async (req) => core.revokeCheckout(req.params.id));

  // ---- rotation policies ----
  app.get("/rotation-policies", async () => ({ policies: core.listRotationPolicies() }));
  app.post("/rotation-policies", async (req, reply) =>
    reply.code(201).send(core.createRotationPolicy(parse(rotationPolicySchema, req.body))),
  );
  app.patch<{ Params: { id: string } }>("/rotation-policies/:id", async (req) =>
    core.updateRotationPolicy(req.params.id, parse(updateRotationPolicySchema, req.body)),
  );

  // ---- rotation jobs ----
  app.get("/rotation-jobs", async () => ({ jobs: core.listRotationJobs() }));
  app.post<{ Params: { id: string } }>("/credentials/:id/rotation-jobs", async (req, reply) =>
    reply.code(201).send(core.createRotationJob(req.params.id, parse(createRotationJobSchema, req.body))),
  );
  app.post<{ Params: { id: string } }>("/rotation-jobs/:id/mark-success", async (req) =>
    core.markRotationSuccess(req.params.id, parse(markRotationSuccessSchema, req.body)),
  );
  app.post<{ Params: { id: string } }>("/rotation-jobs/:id/mark-failed", async (req) =>
    core.markRotationFailed(req.params.id, parse(markRotationFailedSchema, req.body)),
  );
  // Trigger the auto-rotation pass on demand (also runs on a timer).
  app.post("/rotation-jobs/run-auto", async () => core.runAutoRotations());

  // ---- audit ----
  app.get("/audit-logs", async (req) => ({
    logs: core.listAudit(auditQuerySchema.parse(req.query ?? {})),
  }));

  // ---- scoped agent tokens (B3, admin only via ROUTE_CAP default) ----
  app.post("/agent-tokens", async (req, reply) => {
    const { token, plaintext } = core.tokens.create(parse(createAgentTokenSchema, req.body));
    // Plaintext is returned exactly once and never persisted.
    return reply.code(201).send({ ...token, token: plaintext });
  });
  app.get("/agent-tokens", async () => ({ tokens: core.tokens.list() }));
  app.post<{ Params: { id: string } }>("/agent-tokens/:id/revoke", async (req) => {
    const t = core.tokens.revoke(req.params.id);
    if (!t) throw notFound("agent_token", req.params.id);
    return t;
  });

  // ---- sync (E2E-encrypted cross-device sync) ----
  const webdavCfg = z.object({ url: z.string().url(), username: z.string(), password: z.string() });
  const s3Cfg = z.object({
    endpoint: z.string().url(), region: z.string(), bucket: z.string(),
    accessKeyId: z.string(), secretAccessKey: z.string(), prefix: z.string().optional(),
  });
  app.get("/sync/state", async () => engine.getState());
  app.post("/sync/passphrase", async (req) =>
    engine.setPassphrase(parse<{ passphrase: string }>(z.object({ passphrase: z.string() }), req.body).passphrase),
  );
  app.post("/sync/auto", async (req) =>
    engine.setAutoSync(parse<{ enabled: boolean }>(z.object({ enabled: z.boolean() }), req.body).enabled),
  );
  app.post("/sync/connect/local", async (req) =>
    engine.connectLocal(parse<{ dir: string }>(z.object({ dir: z.string().min(1) }), req.body)),
  );
  app.post("/sync/connect/gist", async (req) =>
    engine.connectGist(parse<{ token: string }>(z.object({ token: z.string().min(1) }), req.body).token),
  );
  app.post("/sync/connect/webdav", async (req) => engine.connectWebDav(parse(webdavCfg, req.body)));
  app.post("/sync/connect/s3", async (req) => engine.connectS3(parse(s3Cfg, req.body)));
  // ---- encrypted backup / restore (E2E, offline) ----
  app.post("/export", async (req) => {
    const { passphrase } = parse<{ passphrase: string }>(z.object({ passphrase: z.string().min(1) }), req.body);
    const bundle = await core.exportBundle();
    return { blob: encryptPayload(JSON.stringify(bundle), passphrase) };
  });
  app.post("/import", async (req) => {
    const { passphrase, blob } = parse<{ passphrase: string; blob: string }>(
      z.object({ passphrase: z.string().min(1), blob: z.string().min(1) }),
      req.body,
    );
    let bundle;
    try {
      bundle = JSON.parse(decryptPayload(blob, passphrase));
    } catch {
      throw new AppError("bad_request", "decrypt failed — wrong passphrase or corrupt backup", 400);
    }
    await core.applyBundle(bundle);
    return { ok: true, stats: core.stats() };
  });

  app.post("/sync/disconnect", async () => engine.disconnect());
  app.post("/sync/run", async () => engine.run());
  app.get("/sync/versions", async () => ({ versions: await engine.listVersions() }));
  app.post<{ Params: { id: string } }>("/sync/restore/:id", async (req) => engine.restoreVersion(req.params.id));

  // ---- optional static Web UI (built Tauri/Vite frontend) ----
  if (cfg.uiDir) {
    await app.register(fastifyStatic, { root: cfg.uiDir, prefix: "/ui/" });
    app.get("/", async (_req, reply) => reply.redirect("/ui/"));
  }

  return app;
}
