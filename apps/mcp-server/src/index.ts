import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient } from "./client.js";

const client = createClient();

const server = new McpServer({ name: "agentpass", version: "0.1.0" });

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// ---- read tools ----
server.registerTool(
  "list_targets",
  { title: "List targets", description: "List all managed servers/targets.", inputSchema: {} },
  async () => ok(await client.get("/targets")),
);

server.registerTool(
  "get_target",
  { title: "Get target", description: "Get one target by id.", inputSchema: { target_id: z.string() } },
  async ({ target_id }) => ok(await client.get(`/targets/${target_id}`)),
);

server.registerTool(
  "list_credentials",
  { title: "List credentials", description: "List credential metadata (no secrets).", inputSchema: {} },
  async () => ok(await client.get("/credentials")),
);

// ---- reveal (HIGH RISK: returns plaintext) ----
server.registerTool(
  "reveal_secret",
  {
    title: "Reveal secret (HIGH RISK)",
    description:
      "Return a credential's PLAINTEXT secret. Audited. May flag the credential for rotation per policy. Prefer checkout_ssh_access when possible.",
    inputSchema: {
      credential_id: z.string(),
      purpose: z.string(),
      requested_by: z.string(),
      ttl_seconds: z.number().int().positive().max(86400).default(300),
      target_id: z.string().nullable().default(null),
    },
  },
  async ({ credential_id, ...body }) => ok(await client.post(`/credentials/${credential_id}/reveal`, body)),
);

// ---- checkout (RECOMMENDED) ----
server.registerTool(
  "checkout_ssh_access",
  {
    title: "Checkout SSH access (recommended)",
    description:
      "Get temporary SSH access to a target without exposing long-term secrets. Returns an ssh_command that expires. Audited.",
    inputSchema: {
      target_id: z.string(),
      purpose: z.string(),
      requested_by: z.string(),
      ttl_seconds: z.number().int().positive().max(86400).default(900),
      mode: z.enum(["temp_key_file", "ssh_agent_socket"]).default("temp_key_file"),
      credential_id: z.string().optional(),
    },
  },
  async ({ target_id, ...body }) => ok(await client.post(`/targets/${target_id}/checkout`, body)),
);

server.registerTool(
  "revoke_checkout",
  { title: "Revoke checkout", description: "Revoke a checkout session and wipe its temp artifacts.", inputSchema: { checkout_id: z.string() } },
  async ({ checkout_id }) => ok(await client.post(`/checkouts/${checkout_id}/revoke`)),
);

server.registerTool(
  "get_checkout_status",
  { title: "Get checkout status", description: "Get one checkout session by id.", inputSchema: { checkout_id: z.string() } },
  async ({ checkout_id }) => ok(await client.get(`/checkouts/${checkout_id}`)),
);

server.registerTool(
  "list_active_checkouts",
  { title: "List active checkouts", description: "List checkout sessions still active.", inputSchema: {} },
  async () => {
    const { checkouts } = (await client.get("/checkouts")) as { checkouts: { status: string }[] };
    return ok({ checkouts: checkouts.filter((c) => c.status === "active") });
  },
);

// ---- rotation ----
server.registerTool(
  "get_rotation_status",
  {
    title: "Get rotation status",
    description: "Rotation state for a credential (status, counts, due date) plus its rotation jobs.",
    inputSchema: { credential_id: z.string() },
  },
  async ({ credential_id }) => {
    const cred = (await client.get(`/credentials/${credential_id}`)) as Record<string, unknown>;
    const { jobs } = (await client.get("/rotation-jobs")) as { jobs: { credential_id: string }[] };
    return ok({
      credential_id,
      status: cred.status,
      reveal_count_since_rotation: cred.reveal_count_since_rotation,
      last_rotated_at: cred.last_rotated_at,
      next_rotation_due_at: cred.next_rotation_due_at,
      jobs: jobs.filter((j) => j.credential_id === credential_id),
    });
  },
);

server.registerTool(
  "schedule_rotation",
  {
    title: "Schedule rotation",
    description: "Create a rotation job for a credential (manual rotation flow).",
    inputSchema: {
      credential_id: z.string(),
      reason: z.enum(["manual", "after_reveal", "scheduled", "compromised"]).default("manual"),
      target_id: z.string().nullable().default(null),
    },
  },
  async ({ credential_id, ...body }) => ok(await client.post(`/credentials/${credential_id}/rotation-jobs`, body)),
);

server.registerTool(
  "mark_rotation_complete",
  {
    title: "Mark rotation complete",
    description: "Complete a rotation job with the new secret value; resets rotation counters and reactivates the credential.",
    inputSchema: {
      rotation_job_id: z.string(),
      new_secret_value: z.string(),
      new_secret_version: z.string().optional(),
    },
  },
  async ({ rotation_job_id, ...body }) => ok(await client.post(`/rotation-jobs/${rotation_job_id}/mark-success`, body)),
);

server.registerTool(
  "list_audit_logs",
  { title: "List audit logs", description: "List recent audit log entries (redacted).", inputSchema: { limit: z.number().int().positive().max(1000).default(100) } },
  async ({ limit }) => ok(await client.get(`/audit-logs?limit=${limit}`)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for MCP protocol; diagnostics go to stderr.
  console.error("agentpass mcp-server ready (stdio)");
}

main().catch((err) => {
  console.error("mcp-server failed:", err.message);
  process.exit(1);
});
