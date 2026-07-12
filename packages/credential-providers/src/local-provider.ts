import { newId, type CredentialType } from "@agentpass/shared";
import type {
  CredentialBackend,
  RevealContext,
  SecretBlobStore,
} from "@agentpass/core";
import { decrypt, encrypt, versionOf } from "./crypto.js";

/**
 * LocalEncryptedStoreProvider — the MVP credential backend.
 * Secret material is AES-256-GCM encrypted and stored as opaque ciphertext in
 * the SecretBlobStore (SQLite). Metadata lives in the core Repository. Plaintext
 * exists only transiently during putSecret/revealSecret and is never logged.
 */
export class LocalEncryptedStoreProvider implements CredentialBackend {
  readonly kind = "local_encrypted" as const;

  constructor(
    private readonly key: Buffer,
    private readonly blobs: SecretBlobStore,
  ) {}

  async putSecret(input: {
    type: CredentialType;
    secret_value: string;
  }): Promise<{ secret_ref: string; version: string }> {
    const secret_ref = newId("sref");
    const blob = encrypt(this.key, input.secret_value);
    this.blobs.put(secret_ref, blob);
    return { secret_ref, version: versionOf(blob) };
  }

  async updateSecret(
    secret_ref: string,
    secret_value: string,
  ): Promise<{ version: string }> {
    if (this.blobs.get(secret_ref) == null)
      throw new Error(`secret_ref not found: ${secret_ref}`);
    const blob = encrypt(this.key, secret_value);
    this.blobs.put(secret_ref, blob);
    return { version: versionOf(blob) };
  }

  async deleteSecret(secret_ref: string): Promise<void> {
    this.blobs.delete(secret_ref);
  }

  async revealSecret(secret_ref: string, _ctx: RevealContext): Promise<string> {
    const blob = this.blobs.get(secret_ref);
    if (blob == null) throw new Error(`secret_ref not found: ${secret_ref}`);
    return decrypt(this.key, blob);
  }
}
