import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, versionOf } from "./crypto.js";

describe("crypto", () => {
  it("round-trips plaintext", () => {
    const key = randomBytes(32);
    const secret = "FAKE-super-secret-🔑";
    const blob = encrypt(key, secret);
    expect(blob).not.toContain(secret);
    expect(decrypt(key, blob)).toBe(secret);
  });

  it("fails auth with the wrong key", () => {
    const blob = encrypt(randomBytes(32), "FAKE");
    expect(() => decrypt(randomBytes(32), blob)).toThrow();
  });

  it("version changes when ciphertext changes", () => {
    const key = randomBytes(32);
    expect(versionOf(encrypt(key, "a"))).not.toBe(versionOf(encrypt(key, "b")));
  });
});
