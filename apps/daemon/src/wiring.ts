import { AgentPassCore, createLogger } from "@agentpass/core";
import {
  SshAgentSocketCheckoutProvider,
  TempKeyFileCheckoutProvider,
} from "@agentpass/checkout-providers";
import { LocalEncryptedStoreProvider, loadOrCreateMasterKey } from "@agentpass/credential-providers";
import { PasswordRotationProvider, SshKeyRotationProvider } from "@agentpass/rotation-providers";
import { SqliteStore } from "@agentpass/storage-sqlite";
import type { DaemonConfig } from "./config.js";

export function buildCore(cfg: DaemonConfig): { core: AgentPassCore; store: SqliteStore } {
  const logger = createLogger((process.env.AGENTPASS_LOG_LEVEL as "info") ?? "info");
  const store = new SqliteStore(cfg.dbPath);
  const key = loadOrCreateMasterKey(cfg.keyPath);
  const local = new LocalEncryptedStoreProvider(key, store);

  const core = new AgentPassCore({
    repo: store,
    backends: [local],
    checkoutProviders: [
      new TempKeyFileCheckoutProvider(cfg.checkoutDir),
      new SshAgentSocketCheckoutProvider(), // registered; create() throws until implemented
    ],
    rotationProviders: [new PasswordRotationProvider(), new SshKeyRotationProvider()],
    logger,
  });
  return { core, store };
}
