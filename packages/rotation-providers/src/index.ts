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

/** TODO: generate a new keypair, install the public key on the target, retire the old. */
export class SshKeyRotationProvider implements RotationProvider {
  supports(type: CredentialType): boolean {
    return type === "ssh_private_key";
  }
  async rotate(_input: RotationExecuteInput): Promise<{ new_secret_value: string; version: string }> {
    throw new Error("auto ssh key rotation not implemented yet — use manual mark_rotation_complete");
  }
}
