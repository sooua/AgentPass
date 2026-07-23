import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Credential, Target } from "@agentpass/shared";
import { TempKeyFileCheckoutProvider } from "./temp-key-file.js";

const base = mkdtempSync(join(tmpdir(), "agentpass-checkout-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const target = {
  id: "tgt_1", name: "Crystal US VPS", type: "ssh", host: "10.0.0.1", port: 22,
  username: "root", tags: [], environment: "dev", credential_ids: [],
  created_at: "", updated_at: "",
} as unknown as Target;

const credential = (type: string) => ({ id: "cred_1", name: "c", type } as unknown as Credential);

const checkout = (type: string, secret: string, id: string) =>
  new TempKeyFileCheckoutProvider(base).create({
    checkout_id: id, target, credential: credential(type), secret_value: secret, ttl_seconds: 60,
  });

describe("temp_key_file checkout", () => {
  it("drives password login through SSH_ASKPASS, not sshpass", async () => {
    const art = await checkout("password", "hunter2", "co_pw");

    expect(art.ssh_command).not.toContain("sshpass");
    expect(art.ssh_command).toContain("SSH_ASKPASS_REQUIRE=force");
    // The helper must print the password and nothing else — ssh reads one line.
    const helper = readFileSync(join(art.checkout_path, "askpass.sh"), "utf8");
    expect(helper).toMatch(/^#!\/bin\/sh\ncat '.*password'\n$/);
    expect(readFileSync(join(art.checkout_path, "password"), "utf8")).toBe("hunter2");
    // The password itself never rides along in the command.
    expect(art.ssh_command).not.toContain("hunter2");
  });

  it("emits shell-safe paths (a Windows backslash would be eaten as an escape)", async () => {
    const art = await checkout("ssh_private_key", "-----BEGIN KEY-----", "co_key");

    expect(art.ssh_command).toMatch(/^ssh -F '.*\/config' crystal-us-vps$/);
    expect(art.ssh_command).not.toContain("\\");
    expect(readFileSync(join(art.checkout_path, "config"), "utf8")).not.toContain("\\");
  });
});
