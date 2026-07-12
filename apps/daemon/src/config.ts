import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonConfig {
  host: string;
  port: number;
  home: string;
  dbPath: string;
  keyPath: string;
  checkoutDir: string;
  token: string;
  uiDir: string | null;
}

export function loadConfig(): DaemonConfig {
  const home = process.env.AGENTPASS_HOME ?? join(homedir(), ".agentpass");
  mkdirSync(home, { recursive: true });

  const tokenPath = join(home, "token");
  let token = process.env.AGENTPASS_TOKEN ?? "";
  if (!token) {
    if (existsSync(tokenPath)) {
      token = readFileSync(tokenPath, "utf8").trim();
    } else {
      token = randomBytes(24).toString("base64url");
      writeFileSync(tokenPath, token, { mode: 0o600 });
    }
  }

  const uiDir = process.env.AGENTPASS_UI_DIR ?? null;

  return {
    host: process.env.AGENTPASS_HOST ?? "127.0.0.1", // local-only bind by default
    port: Number(process.env.AGENTPASS_PORT ?? 4747),
    home,
    dbPath: process.env.AGENTPASS_DB ?? join(home, "agentpass.sqlite"),
    keyPath: join(home, "master.key"),
    checkoutDir: join(home, "checkouts"),
    token,
    uiDir: uiDir && existsSync(uiDir) ? uiDir : null,
  };
}
