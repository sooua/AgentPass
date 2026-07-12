import { afterEach, describe, expect, it, vi } from "vitest";
import { GistProvider } from "./providers/gist.js";
import { WebDavProvider } from "./providers/webdav.js";
import { S3Provider } from "./providers/s3.js";

afterEach(() => vi.restoreAllMocks());

describe("S3Provider (SigV4)", () => {
  it("signs a push with a well-formed AWS4-HMAC-SHA256 authorization", async () => {
    let captured: any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      captured = { url, init };
      return new Response("", { status: 200 });
    }));
    const p = new S3Provider({ endpoint: "https://s3.amazonaws.com", region: "us-east-1", bucket: "b", accessKeyId: "AKIA", secretAccessKey: "secret" });
    await p.push("payload").catch(() => {});
    const auth: string = captured.init.headers.Authorization;
    expect(auth).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIA\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(captured.init.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips push → pull", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      const key = url.split("?")[0]!;
      if ((init?.method ?? "GET") === "PUT") { store.set(key, init.body); return new Response("", { status: 200 }); }
      const v = store.get(key);
      return new Response(v ?? "", { status: v != null ? 200 : 404 });
    }));
    const p = new S3Provider({ endpoint: "https://s3.amazonaws.com", region: "us-east-1", bucket: "b", accessKeyId: "A", secretAccessKey: "s" });
    await p.push("hello-ciphertext");
    expect(await p.pull()).toBe("hello-ciphertext");
  });
});

describe("GistProvider", () => {
  it("creates a gist then reads it back, adopting its id", async () => {
    let gistId: string | null = null;
    let content = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      const m = init?.method ?? "GET";
      if (url.includes("/gists?per_page")) return new Response("[]", { status: 200 });
      if (url.endsWith("/gists") && m === "POST") {
        gistId = "g1";
        content = JSON.parse(init.body).files["agentpass-sync.json"].content;
        return new Response(JSON.stringify({ id: "g1" }), { status: 201 });
      }
      if (gistId && url.endsWith(`/gists/${gistId}`) && m === "GET")
        return new Response(JSON.stringify({ files: { "agentpass-sync.json": { content } } }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    let saved = "";
    const p = new GistProvider({ token: "ghp_x" }, (id) => { saved = id; });
    expect(await p.pull()).toBeNull(); // nothing yet
    await p.push("cipher");
    expect(saved).toBe("g1");
    expect(await p.pull()).toBe("cipher");
  });
});

describe("WebDavProvider", () => {
  it("round-trips + sends Basic auth", async () => {
    const store = new Map<string, string>();
    let auth = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      auth = init?.headers?.Authorization ?? auth;
      const m = init?.method ?? "GET";
      if (m === "PUT") { store.set(url, init.body); return new Response("", { status: 201 }); }
      if (m === "MKCOL" || m === "PROPFIND") return new Response("", { status: 207 });
      const v = store.get(url);
      return new Response(v ?? "", { status: v != null ? 200 : 404 });
    }));
    const p = new WebDavProvider({ url: "https://dav.example.com/ap/", username: "u", password: "p" });
    await p.push("data");
    expect(await p.pull()).toBe("data");
    expect(auth).toBe("Basic " + Buffer.from("u:p").toString("base64"));
  });
});
