import type { CredentialType } from "@agentpass/shared";
import type { CredentialBackend, RevealContext } from "@agentpass/core";

// Placeholder backends. They intentionally throw so misconfiguration fails loud
// rather than silently falling back to local storage. Wire real clients here.
// See docs/open-source-reuse.md for integration notes + license TODOs.

class UnimplementedBackend implements CredentialBackend {
  constructor(readonly kind: CredentialBackend["kind"], private readonly hint: string) {}
  private fail(): never {
    throw new Error(`${this.kind} backend not implemented yet — ${this.hint}`);
  }
  async putSecret(_i: { type: CredentialType; secret_value: string }) {
    return this.fail();
  }
  async updateSecret(_r: string, _v: string) {
    return this.fail();
  }
  async deleteSecret(_r: string) {
    return this.fail();
  }
  async revealSecret(_r: string, _c: RevealContext): Promise<string> {
    return this.fail();
  }
}

/** TODO: back with OpenBao KV v2 (github.com/openbao/openbao — MPL-2.0, confirm w/ legal). */
export class OpenBaoProvider extends UnimplementedBackend {
  constructor() {
    super("openbao", "set OPENBAO_ADDR + token and implement KV v2 client");
  }
}

/** TODO: back with Infisical API (github.com/Infisical/infisical — check license). */
export class InfisicalProvider extends UnimplementedBackend {
  constructor() {
    super("infisical", "set INFISICAL_* env and implement secrets client");
  }
}

/** TODO: back with OS keychain (keytar / Windows Credential Manager / Secret Service). */
export class SystemKeychainProvider extends UnimplementedBackend {
  constructor() {
    super("keychain", "integrate node-keytar or platform credential store");
  }
}
