import type {
  CheckoutArtifact,
  CheckoutCreateInput,
  CheckoutProvider,
} from "@agentpass/core";
import type { CheckoutSession, Credential, Target } from "@agentpass/shared";

/**
 * ssh_agent_socket mode (STUB). Future: spawn a scoped `ssh-agent`, `ssh-add`
 * the key from stdin, return IdentityAgent socket path; kill the agent on TTL/
 * revoke. Requires system OpenSSH ssh-agent — we do not implement the protocol.
 */
export class SshAgentSocketCheckoutProvider implements CheckoutProvider {
  readonly mode = "ssh_agent_socket" as const;

  supports(target: Target, credential: Credential): boolean {
    return target.type === "ssh" && credential.type === "ssh_private_key";
  }

  async create(_input: CheckoutCreateInput): Promise<CheckoutArtifact> {
    throw new Error("ssh_agent_socket checkout mode not implemented yet");
  }

  async cleanup(_session: CheckoutSession): Promise<void> {
    /* nothing materialized yet */
  }
}
