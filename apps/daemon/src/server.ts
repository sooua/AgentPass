import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { ZodError, type ZodTypeAny } from "zod";
import { AppError, type AgentPassCore } from "@agentpass/core";
import {
  auditQuerySchema,
  checkoutSchema,
  createCredentialSchema,
  createRotationJobSchema,
  createTargetSchema,
  credentialQuerySchema,
  decideRevealRequestSchema,
  markRotationFailedSchema,
  markRotationSuccessSchema,
  revealSchema,
  rotationPolicySchema,
  targetQuerySchema,
  updateCredentialSchema,
  updateRotationPolicySchema,
  updateTargetSchema,
} from "@agentpass/shared";
import type { DaemonConfig } from "./config.js";

const parse = <T>(schema: ZodTypeAny, data: unknown): T => {
  try {
    return schema.parse(data ?? {}) as T;
  } catch (e) {
    if (e instanceof ZodError)
      throw new AppError("validation_error", e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
    throw e;
  }
};

export async function buildServer(core: AgentPassCore, cfg: DaemonConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true }); // UI dev server is same-machine only

  // ---- local auth token (skip health + static UI) ----
  const expected = Buffer.from(`Bearer ${cfg.token}`);
  const tokenOk = (auth: string | undefined): boolean => {
    if (!auth) return false;
    const got = Buffer.from(auth);
    return got.length === expected.length && timingSafeEqual(got, expected);
  };
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    if (url === "/health" || url === "/" || url.startsWith("/ui")) return;
    if (!tokenOk(req.headers["authorization"])) {
      reply.code(401).send({ error: { code: "unauthorized", message: "missing or invalid token" } });
    }
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

  app.get("/health", async () => ({
    status: "ok",
    service: "agentpass",
    version: "0.1.0",
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
  app.post<{ Params: { id: string } }>("/credentials/:id/reveal", async (req) =>
    core.reveal(req.params.id, parse(revealSchema, req.body)),
  );
  app.get("/reveals", async () => ({ reveals: core.listReveals() }));
  app.get<{ Params: { id: string } }>("/reveals/:id", async (req) => core.getReveal(req.params.id));
  app.post<{ Params: { id: string } }>("/reveals/:id/revoke", async (req) => core.revokeReveal(req.params.id));

  // ---- reveal requests (approval gate) ----
  app.get("/reveal-requests", async () => ({ requests: core.listRevealRequests() }));
  app.get<{ Params: { id: string } }>("/reveal-requests/:id", async (req) =>
    core.getRevealRequest(req.params.id),
  );
  app.post<{ Params: { id: string } }>("/reveal-requests/:id/approve", async (req) =>
    core.decideRevealRequest(req.params.id, true, decideRevealRequestSchema.parse(req.body ?? {})),
  );
  app.post<{ Params: { id: string } }>("/reveal-requests/:id/deny", async (req) =>
    core.decideRevealRequest(req.params.id, false, decideRevealRequestSchema.parse(req.body ?? {})),
  );

  // ---- checkout (RECOMMENDED) ----
  app.post<{ Params: { id: string } }>("/targets/:id/checkout", async (req) =>
    core.checkout(req.params.id, parse(checkoutSchema, req.body)),
  );
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

  // ---- optional static Web UI (built Tauri/Vite frontend) ----
  if (cfg.uiDir) {
    await app.register(fastifyStatic, { root: cfg.uiDir, prefix: "/ui/" });
    app.get("/", async (_req, reply) => reply.redirect("/ui/"));
  }

  return app;
}
