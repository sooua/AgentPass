#!/usr/bin/env node
// agentpass — an MCP server that keeps your servers' credentials and hands your
// coding agent temporary access to them. One process, no daemon, no UI.
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Store } from "./store.js";
import { materialize, run, sweep, wipe } from "./ssh.js";

const VERSION = "2.0.0";
const DEFAULT_TTL = 900;
const MAX_OUTPUT = 100_000;

const store = new Store();
const accessDir = join(store.dir, "access");

// Anything left by a killed process is gone before we serve the first request.
sweep(accessDir, 0);

/** Append-only, secrets never in it. Cheap enough to always be on. */
function audit(action: string, host: string, detail: Record<string, unknown> = {}): void {
  try {
    appendFileSync(join(store.dir, "audit.jsonl"), JSON.stringify({ ts: new Date().toISOString(), action, host, ...detail }) + "\n", { mode: 0o600 });
  } catch {
    /* a keyring that refuses to work because it cannot log is worse */
  }
}

const server = new McpServer({ name: "agentpass", version: VERSION });
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const hostArg = z.string().describe("Host name as you named it, e.g. 'my vps'. Case-insensitive.");

server.registerTool(
  "add_host",
  {
    title: "Remember a server",
    description:
      "Store a server and how to log into it. Give either password or private_key. The secret is encrypted at rest and never returned by any tool except get_secret.",
    inputSchema: {
      name: z.string().describe("What you want to call it, e.g. 'my vps'"),
      host: z.string().describe("Hostname or IP"),
      user: z.string(),
      port: z.number().int().positive().max(65535).optional(),
      password: z.string().optional(),
      private_key: z.string().optional().describe("PEM private key contents"),
    },
  },
  async ({ name, host, user, port, password, private_key }) => {
    if (!password === !private_key) return fail("give exactly one of password or private_key");
    const info = store.add(
      { name, host, user, port: port ?? 22, auth: private_key ? "key" : "password" },
      (private_key ?? password) as string,
    );
    audit("add_host", info.name, { auth: info.auth });
    return ok(info);
  },
);

server.registerTool(
  "list_hosts",
  { title: "List servers", description: "Every server you have stored. Secrets are not included.", inputSchema: {} },
  async () => ok(store.list()),
);

server.registerTool(
  "remove_host",
  { title: "Forget a server", description: "Delete a stored server and its secret.", inputSchema: { name: hostArg } },
  async ({ name }) => {
    const removed = store.remove(name);
    if (removed) audit("remove_host", name);
    return removed ? ok(`removed ${name}`) : fail(`no host named "${name}"`);
  },
);

server.registerTool(
  "ssh_access",
  {
    title: "Get an ssh command",
    description:
      "Materialize temporary login files and return a ready-to-run ssh command. Run it in a POSIX shell (Git Bash on Windows). The files are wiped when the TTL expires.",
    inputSchema: {
      name: hostArg,
      ttl_seconds: z.number().int().positive().max(86_400).optional().describe(`default ${DEFAULT_TTL}`),
    },
  },
  async ({ name, ttl_seconds }) => {
    const host = store.get(name);
    const ttl = (ttl_seconds ?? DEFAULT_TTL) * 1000;
    const dir = join(accessDir, randomUUID());
    const m = materialize(dir, host, store.secretOf(host));
    // unref: a pending wipe must never hold the process open.
    setTimeout(() => wipe(dir), ttl).unref();
    audit("ssh_access", host.name, { ttl_seconds: ttl / 1000 });
    return ok({ command: m.command, expires_in_seconds: ttl / 1000, note: "run this in a POSIX shell" });
  },
);

server.registerTool(
  "run",
  {
    title: "Run a command on a server",
    description: "Log in, run one command, return its output, and wipe the login files. Use ssh_access instead when you want an interactive session.",
    inputSchema: {
      name: hostArg,
      command: z.string().describe("Shell command to run on the server"),
      timeout_seconds: z.number().int().positive().max(600).optional().describe("default 60"),
    },
  },
  async ({ name, command, timeout_seconds }) => {
    const host = store.get(name);
    const dir = join(accessDir, randomUUID());
    const m = materialize(dir, host, store.secretOf(host));
    try {
      const r = await run(m, command, (timeout_seconds ?? 60) * 1000);
      audit("run", host.name, { command, exit_code: r.exit_code });
      return ok({
        exit_code: r.exit_code,
        stdout: r.stdout.slice(0, MAX_OUTPUT),
        stderr: r.stderr.slice(0, MAX_OUTPUT),
      });
    } finally {
      wipe(dir);
    }
  },
);

server.registerTool(
  "get_secret",
  {
    title: "Reveal a stored secret",
    description:
      "Return a host's password or private key in plaintext. Prefer run or ssh_access — this puts the secret into the conversation, where it stays. Every call is logged.",
    inputSchema: { name: hostArg, reason: z.string().describe("Why you need the plaintext") },
  },
  async ({ name, reason }) => {
    const host = store.get(name);
    audit("get_secret", host.name, { reason });
    return ok({ auth: host.auth, secret: store.secretOf(host) });
  },
);

await server.connect(new StdioServerTransport());
