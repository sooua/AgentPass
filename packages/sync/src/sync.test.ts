import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { AgentPassCore } from "@agentpass/core";
import { LocalEncryptedStoreProvider } from "@agentpass/credential-providers";
import { SqliteStore } from "@agentpass/storage-sqlite";
import { SyncEngine } from "./engine.js";
import { decryptPayload, encryptPayload } from "./crypto.js";

const FAKE = "FAKE-secret-value";
let dir: string;

function device(name: string) {
  const store = new SqliteStore(":memory:");
  const core = new AgentPassCore({
    repo: store,
    backends: [new LocalEncryptedStoreProvider(randomBytes(32), store)],
    checkoutProviders: [],
  });
  const engine = new SyncEngine(core, join(dir, `${name}.sync.json`));
  return { core, engine };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentpass-sync-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("crypto", () => {
  it("round-trips and rejects wrong passphrase", () => {
    const blob = encryptPayload("hello", "pw");
    expect(blob).not.toContain("hello");
    expect(decryptPayload(blob, "pw")).toBe("hello");
    expect(() => decryptPayload(blob, "nope")).toThrow();
  });
});

describe("two-device sync", () => {
  const shared = () => join(dir, "cloud");

  it("propagates a credential (with its secret) A→B", async () => {
    const a = device("a");
    a.engine.setPassphrase("shared-pass");
    a.engine.connectLocal({ dir: shared() });
    const cred = await a.core.createCredential({
      name: "db", type: "password", provider: "local_encrypted",
      secret_value: FAKE, metadata: {}, rotation_policy_id: null,
    });
    a.core.createTarget({
      name: "web", type: "ssh", host: "10.0.0.1", port: 22, username: "u",
      tags: [], environment: "dev", credential_ids: [cred.id],
    });
    expect((await a.engine.run()).status).toBe("pushed");

    const b = device("b");
    b.engine.setPassphrase("shared-pass");
    b.engine.connectLocal({ dir: shared() });
    expect((await b.engine.run()).status).toBe("pulled");

    expect(b.core.listTargets()).toHaveLength(1);
    const bCred = b.core.listCredentials().find((c) => c.id === cred.id)!;
    expect(bCred).toBeTruthy();
    const revealed = await b.core.reveal(bCred.id, { target_id: null, requested_by: "t", purpose: "p", ttl_seconds: 60 });
    expect(revealed.secret_value).toBe(FAKE);
  });

  it("propagates deletions via tombstones", async () => {
    const a = device("a");
    a.engine.setPassphrase("p"); a.engine.connectLocal({ dir: shared() });
    const cred = await a.core.createCredential({
      name: "x", type: "api_token", provider: "local_encrypted",
      secret_value: FAKE, metadata: {}, rotation_policy_id: null,
    });
    await a.engine.run();

    const b = device("b");
    b.engine.setPassphrase("p"); b.engine.connectLocal({ dir: shared() });
    await b.engine.run();
    expect(b.core.listCredentials()).toHaveLength(1);

    await a.core.deleteCredential(cred.id);
    await a.engine.run();
    await b.engine.run();
    expect(b.core.listCredentials()).toHaveLength(0);
  });

  it("refuses to sync without a passphrase and rejects a wrong one", async () => {
    const a = device("a");
    a.engine.connectLocal({ dir: shared() });
    expect((await a.engine.run()).status).toBe("error"); // no passphrase

    a.engine.setPassphrase("right");
    await a.core.createCredential({
      name: "x", type: "api_token", provider: "local_encrypted",
      secret_value: FAKE, metadata: {}, rotation_policy_id: null,
    });
    await a.engine.run();

    const b = device("b");
    b.engine.setPassphrase("wrong"); b.engine.connectLocal({ dir: shared() });
    expect((await b.engine.run()).status).toBe("error"); // decrypt fails
  });
});
