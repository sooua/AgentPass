import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Store } from "./store.js";
import { clip, materialize, sweep, wipe } from "./ssh.js";

const dir = mkdtempSync(join(tmpdir(), "agentpass-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const store = new Store(join(dir, "vault"));

describe("store", () => {
  it("encrypts secrets at rest and keeps them out of listings", () => {
    store.add({ name: "My VPS", host: "10.0.0.1", user: "root", port: 22, auth: "password" }, "hunter2");

    const onDisk = readFileSync(join(dir, "vault", "hosts.json"), "utf8");
    expect(onDisk).not.toContain("hunter2");
    expect(JSON.stringify(store.list())).not.toContain("hunter2");
    expect(store.secretOf(store.get("My VPS"))).toBe("hunter2");
  });

  it("finds a host however the agent capitalized it, and says so when it cannot", () => {
    expect(store.get("my vps").host).toBe("10.0.0.1");
    expect(() => store.get("nope")).toThrow(/no host named "nope".*My VPS/s);
  });

  it("replaces a host of the same name instead of duplicating it", () => {
    store.add({ name: "my vps", host: "10.0.0.2", user: "root", port: 22, auth: "password" }, "pw2");
    expect(store.list()).toHaveLength(1);
    expect(store.get("My VPS").host).toBe("10.0.0.2");
  });

  it("renames without being handed the password again", () => {
    const info = store.update("my vps", { name: "vps" });

    expect(info.name).toBe("vps");
    expect(store.secretOf(store.get("vps"))).toBe("pw2");
    expect(() => store.get("My VPS")).toThrow();
    store.update("vps", { name: "My VPS" }); // put it back for the tests below
  });

  it("refuses a rename onto an existing host, and an auth switch with no secret", () => {
    store.add({ name: "other", host: "10.0.0.9", user: "root", port: 22, auth: "password" }, "pw3");

    expect(() => store.update("My VPS", { name: "other" })).toThrow(/already exists/);
    expect(() => store.update("My VPS", { auth: "key" })).toThrow(/needs the new password/);
    expect(store.secretOf(store.get("My VPS"))).toBe("pw2"); // nothing half-applied
    store.remove("other");
  });

  it("says so when the master key no longer matches", () => {
    const stranger = new Store(join(dir, "other-vault"));
    stranger.add({ name: "x", host: "h", user: "u", port: 22, auth: "password" }, "s");
    const foreign = { ...stranger.get("x"), name: "My VPS" };

    expect(() => store.secretOf(foreign)).toThrow(/master\.key does not match|does not match this vault/);
  });

  it("removes", () => {
    expect(store.remove("MY VPS")).toBe(true);
    expect(store.remove("MY VPS")).toBe(false);
    expect(store.list()).toHaveLength(0);
  });
});

describe("ssh access", () => {
  const host = { name: "My VPS", host: "10.0.0.1", user: "root", port: 22, added_at: "", secret: "" };

  it("feeds a password through SSH_ASKPASS, never sshpass and never inline", () => {
    const m = materialize(join(dir, "a1"), { ...host, auth: "password" }, "hunter2");

    expect(m.command).toContain("SSH_ASKPASS_REQUIRE=force");
    expect(m.command).not.toContain("sshpass");
    expect(m.command).not.toContain("hunter2");
    expect(readFileSync(join(m.dir, "askpass.sh"), "utf8")).toMatch(/^#!\/bin\/sh\ncat '.*password'\n$/);
    expect(readFileSync(join(m.dir, "password"), "utf8")).toBe("hunter2");
  });

  it("emits shell-safe paths (a backslash would be eaten as an escape)", () => {
    const m = materialize(join(dir, "a2"), { ...host, auth: "key" }, "-----BEGIN KEY-----");

    expect(m.command).toMatch(/^ssh -F '.*\/config' my-vps$/);
    expect(m.command).not.toContain("\\");
    expect(readFileSync(join(m.dir, "config"), "utf8")).not.toContain("\\");
  });

  it("gives up on an unreachable host instead of burning the whole timeout", () => {
    const m = materialize(join(dir, "a4"), { ...host, auth: "key" }, "KEY");
    expect(readFileSync(join(m.dir, "config"), "utf8")).toContain("ConnectTimeout");
  });

  it("marks truncated output rather than silently cutting it", () => {
    expect(clip("hello", 10)).toBe("hello");
    expect(clip("hello", 4)).toBe("hell\n…[agentpass] truncated, 1 more bytes");
  });

  it("sweeps stale access dirs left behind by a killed process", () => {
    const base = join(dir, "access");
    materialize(join(base, "old"), { ...host, auth: "password" }, "pw");
    writeFileSync(join(base, "old", "config"), "x");

    expect(sweep(base, 0)).toBe(1);
    expect(sweep(base, 0)).toBe(0);
  });

  it("wipe removes everything, including the decrypted key", () => {
    const m = materialize(join(dir, "a3"), { ...host, auth: "key" }, "KEY");
    wipe(m.dir);
    expect(() => readFileSync(join(m.dir, "id_key"), "utf8")).toThrow();
  });
});
