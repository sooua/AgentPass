// Minimal daemon client. Base URL + local token live in localStorage (Settings).
const LS_URL = "agentpass.url";
const LS_TOKEN = "agentpass.token";

export const getUrl = () => localStorage.getItem(LS_URL) || "http://127.0.0.1:4747";
export const getToken = () => localStorage.getItem(LS_TOKEN) || "";
export const setConn = (url: string, token: string) => {
  localStorage.setItem(LS_URL, url);
  localStorage.setItem(LS_TOKEN, token);
};

async function req(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(getUrl() + path, {
    method,
    headers: { authorization: `Bearer ${getToken()}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `${res.status} ${res.statusText}`);
  return json;
}

const qs = (params: Record<string, string | undefined>) => {
  const p = Object.entries(params).filter(([, v]) => v);
  return p.length ? "?" + new URLSearchParams(p as [string, string][]).toString() : "";
};

export const api = {
  health: () => req("GET", "/health"),
  targets: (f: Record<string, string | undefined> = {}) => req("GET", "/targets" + qs(f)),
  createTarget: (b: unknown) => req("POST", "/targets", b),
  patchTarget: (id: string, b: unknown) => req("PATCH", `/targets/${id}`, b),
  deleteTarget: (id: string) => req("DELETE", `/targets/${id}`),
  credentials: (f: Record<string, string | undefined> = {}) => req("GET", "/credentials" + qs(f)),
  createCredential: (b: unknown) => req("POST", "/credentials", b),
  deleteCredential: (id: string) => req("DELETE", `/credentials/${id}`),
  reveal: (id: string, b: unknown) => req("POST", `/credentials/${id}/reveal`, b),
  reveals: () => req("GET", "/reveals"),
  revokeReveal: (id: string) => req("POST", `/reveals/${id}/revoke`),
  revealRequests: () => req("GET", "/reveal-requests"),
  // decided_by is the authenticated identity (the desktop's root token = "root");
  // the daemon ignores any body value, so approving here always acts as "root" —
  // distinct from an agent's scoped token, which is what makes the reveal succeed.
  approveRevealRequest: (id: string) => req("POST", `/reveal-requests/${id}/approve`),
  denyRevealRequest: (id: string) => req("POST", `/reveal-requests/${id}/deny`),
  checkout: (id: string, b: unknown) => req("POST", `/targets/${id}/checkout`, b),
  checkouts: () => req("GET", "/checkouts"),
  revokeCheckout: (id: string) => req("POST", `/checkouts/${id}/revoke`),
  rotationJobs: () => req("GET", "/rotation-jobs"),
  scheduleRotation: (id: string, b: unknown) => req("POST", `/credentials/${id}/rotation-jobs`, b),
  markRotationSuccess: (id: string, b: unknown) => req("POST", `/rotation-jobs/${id}/mark-success`, b),
  audit: (f: Record<string, string | undefined> = {}) => req("GET", "/audit-logs" + qs({ limit: "200", ...f })),
  syncState: () => req("GET", "/sync/state"),
  syncPassphrase: (passphrase: string) => req("POST", "/sync/passphrase", { passphrase }),
  syncAuto: (enabled: boolean) => req("POST", "/sync/auto", { enabled }),
  syncConnect: (provider: string, cfg: unknown) => req("POST", `/sync/connect/${provider}`, cfg),
  syncDisconnect: () => req("POST", "/sync/disconnect"),
  syncRun: () => req("POST", "/sync/run"),
  syncVersions: () => req("GET", "/sync/versions"),
  syncRestore: (id: string) => req("POST", `/sync/restore/${id}`),
  exportBackup: (passphrase: string) => req("POST", "/export", { passphrase }),
  importBackup: (passphrase: string, blob: string) => req("POST", "/import", { passphrase, blob }),
  agentTokens: () => req("GET", "/agent-tokens"),
  createAgentToken: (b: unknown) => req("POST", "/agent-tokens", b),
  revokeAgentToken: (id: string) => req("POST", `/agent-tokens/${id}/revoke`),
};
