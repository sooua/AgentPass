import { createHash, createHmac } from "node:crypto";
import type { ConnectionResult, S3Config, SyncProvider, SyncVersion } from "../types.js";

const FILE = "agentpass-sync.json";
const HISTORY_PREFIX = "history/";
const MAX_HISTORY = 30;
const SERVICE = "s3";
const EMPTY_HASH = createHash("sha256").update("").digest("hex");

const sha256hex = (d: string) => createHash("sha256").update(d, "utf8").digest("hex");
const hmac = (key: string | Buffer, d: string) => createHmac("sha256", key).update(d, "utf8").digest();
const signingKey = (secret: string, date: string, region: string) =>
  hmac(hmac(hmac(hmac("AWS4" + secret, date), region), SERVICE), "aws4_request");
const enc = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const normPrefix = (p?: string) => (!p ? "" : p.replace(/^\/+/, "").replace(/\/*$/, "/"));

/** SigV4-signed path-style request — compatible with AWS S3, MinIO, R2, B2. */
async function s3Fetch(cfg: S3Config, method: string, key: string, query: Record<string, string>, body?: string): Promise<Response> {
  const endpoint = cfg.endpoint.replace(/\/+$/, "");
  const url = new URL(`${endpoint}/${cfg.bucket}/${key}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const host = url.host;
  const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const datestamp = amzdate.slice(0, 8);
  const payloadHash = body !== undefined ? sha256hex(body) : EMPTY_HASH;
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzdate}\n`;
  const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${datestamp}/${cfg.region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzdate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, datestamp, cfg.region), stringToSign).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(url.toString(), {
    method,
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzdate,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });
}

export async function testS3(cfg: S3Config): Promise<ConnectionResult> {
  try {
    const res = await s3Fetch(cfg, "GET", "", { "list-type": "2", "max-keys": "1" });
    if (res.status === 403) return { ok: false, error: "auth failed or forbidden" };
    if (res.status === 404) return { ok: false, error: "bucket not found" };
    if (!res.ok) return { ok: false, error: `server ${res.status}` };
    return { ok: true, account: cfg.bucket };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export class S3Provider implements SyncProvider {
  private prefix: string;
  constructor(private cfg: S3Config) {
    this.prefix = normPrefix(cfg.prefix);
  }

  async pull(): Promise<string | null> {
    const res = await s3Fetch(this.cfg, "GET", `${this.prefix}${FILE}`, {});
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`pull failed (${res.status})`);
    return (await res.text()) || null;
  }

  async push(payload: string): Promise<void> {
    const res = await s3Fetch(this.cfg, "PUT", `${this.prefix}${FILE}`, {}, payload);
    if (!res.ok) throw new Error(`push failed (${res.status})`);
    try {
      await s3Fetch(this.cfg, "PUT", `${this.prefix}${HISTORY_PREFIX}${Date.now()}.json`, {}, payload);
      for (const v of (await this.listVersions()).slice(MAX_HISTORY)) await s3Fetch(this.cfg, "DELETE", v.id, {}).catch(() => {});
    } catch {
      /* history is non-critical */
    }
  }

  async listVersions(): Promise<SyncVersion[]> {
    const res = await s3Fetch(this.cfg, "GET", "", { "list-type": "2", prefix: `${this.prefix}${HISTORY_PREFIX}` });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)]
      .map((m) => ({ id: m[1] ?? "", createdAt: parseInt((m[1] ?? "").split("/").pop() ?? "", 10) }))
      .filter((v) => Number.isFinite(v.createdAt))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getVersion(id: string): Promise<string | null> {
    const res = await s3Fetch(this.cfg, "GET", id, {});
    if (!res.ok) return null;
    return (await res.text()) || null;
  }
}
