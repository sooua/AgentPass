import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CheckoutArtifact,
  CheckoutCreateInput,
  CheckoutProvider,
} from "@agentpass/core";
import type { CheckoutSession, Credential, Target } from "@agentpass/shared";

const aliasFor = (t: Target): string =>
  t.name.replace(/[^A-Za-z0-9_.-]/g, "-").toLowerCase() || t.id;

/**
 * temp_key_file mode: materialize an SSH private key + throwaway ssh_config in a
 * per-checkout directory (0600 key). The agent logs in with `ssh -F <cfg> <alias>`.
 * TTL expiry / revoke wipe the directory. We never implement SSH ourselves —
 * this only prepares inputs for the system OpenSSH client.
 */
export class TempKeyFileCheckoutProvider implements CheckoutProvider {
  readonly mode = "temp_key_file" as const;

  constructor(private readonly baseDir: string) {}

  supports(target: Target, credential: Credential): boolean {
    return target.type === "ssh" && credential.type === "ssh_private_key";
  }

  async create(input: CheckoutCreateInput): Promise<CheckoutArtifact> {
    const dir = join(this.baseDir, input.checkout_id);
    mkdirSync(dir, { recursive: true });
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* non-POSIX */
    }

    const keyPath = join(dir, "id_key");
    const key = input.secret_value.endsWith("\n")
      ? input.secret_value
      : input.secret_value + "\n";
    writeFileSync(keyPath, key, { mode: 0o600 });
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      /* non-POSIX */
    }

    const alias = aliasFor(input.target);
    const configPath = join(dir, "config");
    const config = [
      `# agentpass temporary checkout ${input.checkout_id}`,
      `Host ${alias}`,
      `    HostName ${input.target.host}`,
      `    User ${input.target.username}`,
      `    Port ${input.target.port}`,
      `    IdentityFile ${keyPath}`,
      `    IdentitiesOnly yes`,
      `    StrictHostKeyChecking accept-new`,
      "",
    ].join("\n");
    writeFileSync(configPath, config, { mode: 0o600 });

    return {
      checkout_path: dir,
      ssh_command: `ssh -F ${configPath} ${alias}`,
    };
  }

  async cleanup(session: CheckoutSession): Promise<void> {
    if (!session.checkout_path) return;
    rmSync(session.checkout_path, { recursive: true, force: true });
  }
}
