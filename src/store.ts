// The whole vault: one encrypted JSON file plus a 0600 master key, both under
// ~/.agentpass. No daemon, no database — a personal keyring holds a handful of
// machines, and a file the OS already protects is the right size for that.
import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Auth = "password" | "key";

export interface Host {
  name: string;
  host: string;
  user: string;
  port: number;
  auth: Auth;
  /** AES-256-GCM ciphertext — never the plaintext. */
  secret: string;
  added_at: string;
}

/** What the agent is allowed to see: everything except the secret. */
export type HostInfo = Omit<Host, "secret">;

const ALGO = "aes-256-gcm";

export const home = (): string => process.env.AGENTPASS_HOME ?? join(homedir(), ".agentpass");

/**
 * chmod everywhere, plus an ACL on Windows where chmod is a no-op.
 *
 * `isDir` is not cosmetic. `/inheritance:r` drops every inherited ACE, so on a
 * directory the replacement grant has to be inheritable — (OI)(CI) — or the
 * folder's existing children are left with an empty DACL that not even their
 * owner can open, and anything created later inherits nothing.
 */
export function lockDown(path: string, mode = 0o600, isDir = false): void {
  try {
    chmodSync(path, mode);
  } catch {
    /* non-POSIX */
  }
  if (process.platform !== "win32") return;
  const user = process.env.USERNAME;
  if (!user) return;
  try {
    execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${user}:${isDir ? "(OI)(CI)F" : "F"}`], {
      stdio: "ignore",
    });
  } catch {
    /* icacls missing or path locked — the chmod attempt stands */
  }
}

// ciphertext wire format (base64): [12B iv][16B tag][N ct]
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(key: Buffer, blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const decipher = createDecipheriv(ALGO, key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

// ponytail: master key on disk at 0600, same as the OS protects your ssh keys.
// Upgrade path if this ever guards more than one person's machines: OS keychain.
function masterKey(dir: string): Buffer {
  const keyPath = join(dir, "master.key");
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error("master key must be 32 bytes");
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  lockDown(keyPath);
  return key;
}

export class Store {
  private readonly file: string;
  private readonly key: Buffer;

  constructor(readonly dir = home()) {
    mkdirSync(dir, { recursive: true });
    lockDown(dir, 0o700, true);
    this.file = join(dir, "hosts.json");
    this.key = masterKey(dir);
  }

  private read(): Host[] {
    if (!existsSync(this.file)) return [];
    const raw = JSON.parse(readFileSync(this.file, "utf8")) as { hosts?: Host[] };
    return raw.hosts ?? [];
  }

  // ponytail: last writer wins. Two agents adding a host in the same second is
  // not a race worth a lock file for a single-user keyring; the temp+rename at
  // least means a crash can never leave a half-written vault.
  private write(hosts: Host[]): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, hosts }, null, 2), { mode: 0o600 });
    lockDown(tmp);
    renameSync(tmp, this.file);
  }

  list(): HostInfo[] {
    return this.read().map(({ secret: _secret, ...info }) => info);
  }

  /** Case-insensitive so the agent can use the name a human said out loud. */
  find(name: string): Host | undefined {
    const want = name.trim().toLowerCase();
    return this.read().find((h) => h.name.toLowerCase() === want);
  }

  get(name: string): Host {
    const h = this.find(name);
    if (!h) {
      const known = this.list().map((k) => k.name);
      throw new Error(`no host named "${name}"${known.length ? `. Known: ${known.join(", ")}` : " — add one first"}`);
    }
    return h;
  }

  add(input: Omit<Host, "secret" | "added_at">, secret: string): HostInfo {
    if (!input.name.trim()) throw new Error("name is required");
    if (!secret) throw new Error("a password or private key is required");
    const hosts = this.read().filter((h) => h.name.toLowerCase() !== input.name.trim().toLowerCase());
    const host: Host = { ...input, name: input.name.trim(), secret: encrypt(this.key, secret), added_at: new Date().toISOString() };
    hosts.push(host);
    this.write(hosts);
    const { secret: _secret, ...info } = host;
    return info;
  }

  remove(name: string): boolean {
    const hosts = this.read();
    const left = hosts.filter((h) => h.name.toLowerCase() !== name.trim().toLowerCase());
    if (left.length === hosts.length) return false;
    this.write(left);
    return true;
  }

  /** Decrypt one host's secret. Every caller of this writes an audit line. */
  secretOf(host: Host): string {
    return decrypt(this.key, host.secret);
  }
}
