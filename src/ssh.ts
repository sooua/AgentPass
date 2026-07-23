// Everything that touches the system ssh client. We never implement SSH — we
// materialize the inputs it wants in a 0700 directory, hand back a command (or
// run it), and wipe the directory afterwards.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lockDown, type Host } from "./store.js";

/** Forward slashes and quotes: a Windows backslash is an escape to every shell
 *  that would run this, and home directories have spaces in them. */
const sh = (p: string): string => `'${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;

const aliasFor = (name: string): string => name.replace(/[^A-Za-z0-9_.-]/g, "-").toLowerCase();

export interface Materialized {
  dir: string;
  /** Ready to paste into a POSIX shell. */
  command: string;
  /** argv + env for spawning ssh ourselves. */
  argv: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Write a throwaway ssh_config (+ key or askpass helper) for one login.
 *
 * Password auth goes through ssh's own SSH_ASKPASS hook rather than `sshpass`,
 * which has no Windows build. SSH_ASKPASS_REQUIRE=force is what makes ssh use
 * the helper even when it has a terminal to prompt on (OpenSSH 8.4+).
 */
export function materialize(dir: string, host: Host, secret: string): Materialized {
  mkdirSync(dir, { recursive: true });
  lockDown(dir, 0o700, true);
  const alias = aliasFor(host.name);
  const configPath = join(dir, "config");
  const lines = [
    `# agentpass temporary access`,
    `Host ${alias}`,
    `    HostName ${host.host}`,
    `    User ${host.user}`,
    `    Port ${host.port}`,
    `    StrictHostKeyChecking accept-new`,
    // Without this a powered-off machine burns the caller's whole timeout doing
    // nothing. Ten seconds is long enough for a slow link, short enough that
    // "the box is down" comes back as an answer rather than a hang.
    `    ConnectTimeout 10`,
  ];

  if (host.auth === "password") {
    const pwPath = join(dir, "password");
    writeFileSync(pwPath, secret, { mode: 0o600 });
    const askPath = join(dir, "askpass.sh");
    writeFileSync(askPath, `#!/bin/sh\ncat ${sh(pwPath)}\n`, { mode: 0o700 });
    lines.push(`    PreferredAuthentications password`, `    PubkeyAuthentication no`);
    writeFileSync(configPath, lines.join("\n") + "\n", { mode: 0o600 });
    return {
      dir,
      command: `SSH_ASKPASS=${sh(askPath)} SSH_ASKPASS_REQUIRE=force ssh -F ${sh(configPath)} ${alias}`,
      argv: ["-F", configPath, alias],
      env: { SSH_ASKPASS: askPath.replace(/\\/g, "/"), SSH_ASKPASS_REQUIRE: "force" },
    };
  }

  const keyPath = join(dir, "id_key");
  writeFileSync(keyPath, secret.endsWith("\n") ? secret : secret + "\n", { mode: 0o600 });
  lines.push(`    IdentityFile ${keyPath.replace(/\\/g, "/")}`, `    IdentitiesOnly yes`);
  writeFileSync(configPath, lines.join("\n") + "\n", { mode: 0o600 });
  return {
    dir,
    command: `ssh -F ${sh(configPath)} ${alias}`,
    argv: ["-F", configPath, alias],
    env: {},
  };
}

/**
 * A POSIX shell to run ssh through. Not a stylistic choice: SSH_ASKPASS needs to
 * launch a shell script, and Windows' own ssh.exe cannot. Git for Windows ships
 * an OpenSSH that can, so we go through its shell.
 */
function posixShell(): string {
  if (process.platform !== "win32") return "/bin/sh";
  for (const c of [
    "C:/Program Files/Git/bin/bash.exe",
    "C:/Program Files (x86)/Git/bin/bash.exe",
    `${process.env.LOCALAPPDATA ?? ""}/Programs/Git/bin/bash.exe`,
  ]) {
    if (c && existsSync(c)) return c;
  }
  // Last resort: PATH. Throws at spawn time with a readable error if absent.
  return "bash";
}

export interface RunResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

/** Run one command on the host and return what it printed. */
export function run(m: Materialized, command: string, timeoutMs: number): Promise<RunResult> {
  const full = `${m.command} ${JSON.stringify(command)}`;
  return new Promise((resolve, reject) => {
    const child = spawn(posixShell(), ["-c", full], {
      env: { ...process.env, ...m.env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\nagentpass: timed out after ${timeoutMs / 1000}s`;
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`could not start a shell to run ssh (${e.message}). On Windows this needs Git Bash.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exit_code: code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/**
 * Cut long output down, and say so. Silence here is dangerous: an agent handed
 * the first 100 kB of a log with no marker will reason about it as if it were
 * the whole thing and answer confidently wrong.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[agentpass] truncated, ${text.length - max} more bytes`;
}

export const wipe = (dir: string): void => rmSync(dir, { recursive: true, force: true });

/**
 * Drop access directories older than their grace period. Called at startup
 * because the timer that normally wipes one dies with the process — a killed
 * MCP server must not leave a decrypted key on disk until the next reboot.
 */
export function sweep(baseDir: string, maxAgeMs: number): number {
  if (!existsSync(baseDir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(baseDir)) {
    const dir = join(baseDir, entry);
    try {
      // Clamped and >=, so maxAgeMs 0 means "everything". A filesystem can hand
      // back an mtime a hair ahead of the clock (NTFS rounding), and a negative
      // age would make the startup sweep silently skip a live secret.
      const age = Math.max(0, Date.now() - statSync(dir).mtimeMs);
      if (age >= maxAgeMs) {
        wipe(dir);
        removed++;
      }
    } catch {
      /* vanished under us — fine, that was the goal */
    }
  }
  return removed;
}
