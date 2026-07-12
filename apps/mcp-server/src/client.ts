import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonClient {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  patch(path: string, body?: unknown): Promise<unknown>;
  ping(): Promise<void>;
}

function resolveToken(): string {
  if (process.env.AGENTPASS_TOKEN) return process.env.AGENTPASS_TOKEN;
  const home = process.env.AGENTPASS_HOME ?? join(homedir(), ".agentpass");
  const tokenPath = join(home, "token");
  if (existsSync(tokenPath)) return readFileSync(tokenPath, "utf8").trim();
  throw new Error("AGENTPASS_TOKEN not set and ~/.agentpass/token missing — start the daemon first");
}

export function createClient(): DaemonClient {
  const base = process.env.AGENTPASS_URL ?? "http://127.0.0.1:4747";
  const token = resolveToken();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const handle = async (res: Response): Promise<unknown> => {
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = (json as { error?: { message?: string } })?.error?.message ?? res.statusText;
      throw new Error(`daemon ${res.status}: ${msg}`);
    }
    return json;
  };

  const send = (method: string) => async (path: string, body?: unknown) =>
    handle(await fetch(base + path, { method, headers, body: JSON.stringify(body ?? {}) }));

  return {
    get: async (path) => handle(await fetch(base + path, { headers })),
    post: send("POST"),
    patch: send("PATCH"),
    ping: async () => {
      try {
        const res = await fetch(base + "/health");
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        throw new Error(
          `agentpass daemon unreachable at ${base} — start it with \`pnpm daemon\` (set AGENTPASS_URL if on a non-default port)`,
        );
      }
    },
  };
}
