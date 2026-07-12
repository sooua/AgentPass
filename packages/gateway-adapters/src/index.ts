import type { Target } from "@agentpass/shared";
import type { GatewayProvider } from "@agentpass/core";

// Future connection-gateway seam. Instead of handing credentials to the agent at
// all, route the session through a bastion that brokers SSH/DB/K8s and records
// the session. Not wired into the MVP — adapter surface + license TODOs only.

class UnimplementedGateway implements GatewayProvider {
  constructor(readonly name: string, private readonly hint: string) {}
  async createSession(_input: { target: Target; ttl_seconds: number }): Promise<{ url: string; expires_at: string }> {
    throw new Error(`${this.name} gateway not implemented yet — ${this.hint}`);
  }
}

/** TODO: Warpgate (github.com/warp-tech/warpgate — Apache-2.0/ELv2, confirm w/ legal). */
export class WarpgateGatewayProvider extends UnimplementedGateway {
  constructor() {
    super("warpgate", "provision target + role via Warpgate admin API, return access URL");
  }
}

/** TODO: JumpServer (github.com/jumpserver/jumpserver — GPLv3, confirm w/ legal). */
export class JumpServerGatewayProvider extends UnimplementedGateway {
  constructor() {
    super("jumpserver", "create asset + session via JumpServer API, return connection token");
  }
}
