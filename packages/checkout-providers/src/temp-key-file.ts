import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { secureLocalFile } from "@agentpass/shared";
import type {
  CheckoutArtifact,
  CheckoutCreateInput,
  CheckoutProvider,
} from "@agentpass/core";
import type { CheckoutSession, Credential, Target } from "@agentpass/shared";

const aliasFor = (t: Target): string =>
  t.name.replace(/[^A-Za-z0-9_.-]/g, "-").toLowerCase() || t.id;

/** Forward slashes (OpenSSH takes them on every OS; a Windows backslash would be
 *  eaten as an escape by the shell that runs the emitted command). */
const fwd = (p: string): string => p.replace(/\\/g, "/");

/** Same, quoted for a POSIX shell — the checkout dir sits under the user's home,
 *  which on Windows is routinely `C:/Users/First Last/…`. */
const sh = (p: string): string => `'${fwd(p).replace(/'/g, "'\\''")}'`;

/**
 * temp_key_file mode: materialize an SSH private key + throwaway ssh_config in a
 * per-checkout directory (0600 key). The agent logs in with `ssh -F <cfg> <alias>`.
 * TTL expiry / revoke wipe the directory. We never implement SSH ourselves —
 * this only prepares inputs for the system OpenSSH client.
 *
 * Two properties worth knowing:
 *  - TTL governs credential availability, NOT live connections. Expiry removes
 *    the key file (on the ≤30s maintenance sweep, or immediately on revoke); an
 *    SSH session already established with that key keeps running until the user
 *    closes it. Kill live sessions on the target if that matters.
 *  - Password mode feeds the password to the system ssh through SSH_ASKPASS
 *    instead of `sshpass`, which does not exist on Windows. Needs OpenSSH 8.4+
 *    for SSH_ASKPASS_REQUIRE; older clients ignore it and prompt interactively.
 */
export class TempKeyFileCheckoutProvider implements CheckoutProvider {
  readonly mode = "temp_key_file" as const;

  constructor(private readonly baseDir: string) {
    // Lock the base dir ONCE (full ACL). Per-checkout files inherit it on Windows,
    // so create() skips the expensive per-file icacls spawn (E1).
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
    secureLocalFile(this.baseDir, 0o700);
  }

  supports(target: Target, credential: Credential): boolean {
    return target.type === "ssh" && (credential.type === "ssh_private_key" || credential.type === "password");
  }

  async create(input: CheckoutCreateInput): Promise<CheckoutArtifact> {
    const dir = join(this.baseDir, input.checkout_id);
    mkdirSync(dir, { recursive: true });
    secureLocalFile(dir, 0o700, { windowsAcl: false });
    const alias = aliasFor(input.target);
    const configPath = join(dir, "config");
    const common = [
      `# agentpass temporary checkout ${input.checkout_id}`,
      `Host ${alias}`,
      `    HostName ${input.target.host}`,
      `    User ${input.target.username}`,
      `    Port ${input.target.port}`,
      `    StrictHostKeyChecking accept-new`,
    ];

    if (input.credential.type === "password") {
      // Password login: the password goes to a 0600 file (never into the result)
      // and reaches ssh through its own SSH_ASKPASS hook — no sshpass, which has
      // no Windows build. SSH_ASKPASS_REQUIRE=force is what makes ssh use the
      // helper even when it has a terminal to prompt on.
      const pwPath = join(dir, "password");
      writeFileSync(pwPath, input.secret_value, { mode: 0o600 });
      secureLocalFile(pwPath, 0o600, { windowsAcl: false });
      const askPath = join(dir, "askpass.sh");
      writeFileSync(askPath, `#!/bin/sh\ncat ${sh(pwPath)}\n`, { mode: 0o700 });
      secureLocalFile(askPath, 0o700, { windowsAcl: false });
      const config = [...common, `    PreferredAuthentications password`, `    PubkeyAuthentication no`, ""].join("\n");
      writeFileSync(configPath, config, { mode: 0o600 });
      return {
        checkout_path: dir,
        ssh_command: `SSH_ASKPASS=${sh(askPath)} SSH_ASKPASS_REQUIRE=force ssh -F ${sh(configPath)} ${alias}`,
      };
    }

    const keyPath = join(dir, "id_key");
    const key = input.secret_value.endsWith("\n") ? input.secret_value : input.secret_value + "\n";
    writeFileSync(keyPath, key, { mode: 0o600 });
    secureLocalFile(keyPath, 0o600, { windowsAcl: false }); // inherits baseDir ACL on Windows
    const config = [...common, `    IdentityFile ${fwd(keyPath)}`, `    IdentitiesOnly yes`, ""].join("\n");
    writeFileSync(configPath, config, { mode: 0o600 });
    return { checkout_path: dir, ssh_command: `ssh -F ${sh(configPath)} ${alias}` };
  }

  async cleanup(session: CheckoutSession): Promise<void> {
    if (!session.checkout_path) return;
    rmSync(session.checkout_path, { recursive: true, force: true });
  }
}
