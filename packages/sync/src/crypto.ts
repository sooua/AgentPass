import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * MANDATORY end-to-end encryption of the synced blob. Because agentpass syncs
 * SECRETS, the remote only ever stores an opaque envelope — no plaintext, no
 * metadata. AES-256-GCM with a scrypt-derived key and per-write salt+iv.
 */
interface EncWrapper {
  agentpass_enc: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export function isEncrypted(raw: string): boolean {
  return raw.includes('"agentpass_enc"');
}

export function encryptPayload(plain: string, passphrase: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const wrapper: EncWrapper = {
    agentpass_enc: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: enc.toString("base64"),
  };
  return JSON.stringify(wrapper);
}

/** Throws if the passphrase is wrong or the data is corrupt (GCM auth fails). */
export function decryptPayload(raw: string, passphrase: string): string {
  const w = JSON.parse(raw) as EncWrapper;
  const key = scryptSync(passphrase, Buffer.from(w.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(w.iv, "base64"));
  decipher.setAuthTag(Buffer.from(w.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(w.data, "base64")), decipher.final()]).toString("utf8");
}
