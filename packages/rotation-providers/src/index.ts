import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { CredentialType } from "@agentpass/shared";
import type { RotationExecuteInput, RotationProvider } from "@agentpass/core";

// MVP rotation is MANUAL: core creates a RotationJob and the operator/agent calls
// mark_rotation_complete with the new secret. These providers are the seam for
// future AUTO rotation (generate + push the new secret to the target).

/** TODO: change the password on the target (SSH `passwd`, DB `ALTER USER`, API call). */
export class PasswordRotationProvider implements RotationProvider {
  supports(type: CredentialType): boolean {
    return type === "password" || type === "database_password";
  }
  async rotate(_input: RotationExecuteInput): Promise<{ new_secret_value: string; version: string }> {
    throw new Error("auto password rotation not implemented yet — use manual mark_rotation_complete");
  }
}

/**
 * Generates a fresh ed25519 keypair via the system `ssh-keygen` (we never
 * implement key crypto ourselves) and returns the new PRIVATE key as the rotated
 * secret. NOTE: installing the new PUBLIC key on the target and retiring the old
 * one is a separate step — do it through a GatewayProvider or an operator action.
 * Until that half exists, prefer manual rotation for keys already in use.
 */
export class SshKeyRotationProvider implements RotationProvider {
  supports(type: CredentialType): boolean {
    return type === "ssh_private_key";
  }

  async rotate(_input: RotationExecuteInput): Promise<{ new_secret_value: string; version: string }> {
    const dir = mkdtempSync(join(tmpdir(), "agentpass-keygen-"));
    try {
      const keyPath = join(dir, "id_ed25519");
      execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", "agentpass-rotated", "-f", keyPath, "-q"], {
        stdio: "ignore",
      });
      const priv = readFileSync(keyPath, "utf8");
      const version = createHash("sha256").update(priv).digest("hex").slice(0, 12);
      return { new_secret_value: priv, version };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
