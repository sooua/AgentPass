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

export const api = {
  health: () => req("GET", "/health"),
  targets: () => req("GET", "/targets"),
  createTarget: (b: unknown) => req("POST", "/targets", b),
  deleteTarget: (id: string) => req("DELETE", `/targets/${id}`),
  credentials: () => req("GET", "/credentials"),
  createCredential: (b: unknown) => req("POST", "/credentials", b),
  deleteCredential: (id: string) => req("DELETE", `/credentials/${id}`),
  reveal: (id: string, b: unknown) => req("POST", `/credentials/${id}/reveal`, b),
  reveals: () => req("GET", "/reveals"),
  revokeReveal: (id: string) => req("POST", `/reveals/${id}/revoke`),
  checkout: (id: string, b: unknown) => req("POST", `/targets/${id}/checkout`, b),
  checkouts: () => req("GET", "/checkouts"),
  revokeCheckout: (id: string) => req("POST", `/checkouts/${id}/revoke`),
  rotationJobs: () => req("GET", "/rotation-jobs"),
  scheduleRotation: (id: string, b: unknown) => req("POST", `/credentials/${id}/rotation-jobs`, b),
  markRotationSuccess: (id: string, b: unknown) => req("POST", `/rotation-jobs/${id}/mark-success`, b),
  audit: () => req("GET", "/audit-logs?limit=200"),
};
