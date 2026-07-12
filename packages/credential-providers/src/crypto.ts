import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { secureLocalFile } from "@agentpass/shared";

const ALGO = "aes-256-gcm";

// ciphertext wire format (base64): [12B iv][16B tag][N ct]
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(key: Buffer, blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Short non-secret version tag derived from ciphertext (for rotation tracking). */
export function versionOf(blob: string): string {
  return createHash("sha256").update(blob).digest("hex").slice(0, 12);
}

// ponytail: master key on disk at 0600. Upgrade path = OS keychain via a
// SystemKeychainProvider or a KMS-backed KeyProvider. See docs/security-model.md.
export function loadOrCreateMasterKey(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error("master key must be 32 bytes");
    return key;
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  secureLocalFile(keyPath); // POSIX chmod + Windows ACL lockdown
  return key;
}
