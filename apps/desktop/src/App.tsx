import { useEffect, useState } from "react";
import { api, getToken, getUrl, setConn } from "./api.js";

type Page = "targets" | "credentials" | "reveals" | "checkouts" | "rotation" | "audit" | "settings";

const PAGES: { id: Page; label: string }[] = [
  { id: "targets", label: "Targets" },
  { id: "credentials", label: "Credentials" },
  { id: "reveals", label: "Reveal history" },
  { id: "checkouts", label: "Checkout sessions" },
  { id: "rotation", label: "Rotation jobs" },
  { id: "audit", label: "Audit logs" },
  { id: "settings", label: "Settings" },
];

const Badge = ({ v }: { v: string }) => <span className={`badge badge-${v}`}>{v}</span>;
const short = (s: string | null | undefined) => (s ? s.slice(0, 14) + "…" : "—");
const time = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");

function useList(fn: () => Promise<any>, dep: number): { data: any; err: string; reload: () => void } {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    fn().then(setData).catch((e) => setErr(e.message));
  }, [dep, n]);
  return { data, err, reload: () => setN((x) => x + 1) };
}

export default function App() {
  const [page, setPage] = useState<Page>("targets");
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          agentpass<small>AI agent credential manager</small>
        </div>
        {PAGES.map((p) => (
          <div key={p.id} className={`navlink ${page === p.id ? "active" : ""}`} onClick={() => setPage(p.id)}>
            {p.label}
          </div>
        ))}
      </aside>
      <main className="main">
        {page === "targets" && <Targets />}
        {page === "credentials" && <Credentials />}
        {page === "reveals" && <Reveals />}
        {page === "checkouts" && <Checkouts />}
        {page === "rotation" && <Rotation />}
        {page === "audit" && <Audit />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}

// ---------------- Targets ----------------
function Targets() {
  const [dep, setDep] = useState(0);
  const { data, err } = useList(api.targets, dep);
  const [form, setForm] = useState({ name: "", type: "ssh", host: "", port: 22, username: "", environment: "dev", tags: "" });
  const [fErr, setFErr] = useState("");
  const [checkoutTarget, setCheckoutTarget] = useState<any>(null);

  const submit = async () => {
    setFErr("");
    try {
      await api.createTarget({
        ...form,
        port: Number(form.port),
        tags: form.tags ? form.tags.split(",").map((s) => s.trim()) : [],
      });
      setForm({ name: "", type: "ssh", host: "", port: 22, username: "", environment: "dev", tags: "" });
      setDep((x) => x + 1);
    } catch (e: any) {
      setFErr(e.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Targets</h1>
          <div className="subtitle">Servers, databases and clusters agents can log into.</div>
        </div>
      </div>
      <div className="card">
        <h3>Add target</h3>
        <div className="row">
          <div><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>ssh</option><option>database</option><option>kubernetes</option><option>api</option>
            </select>
          </div>
          <div><label>Environment</label>
            <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
              <option>dev</option><option>staging</option><option>prod</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div><label>Host</label><input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
          <div><label>Port</label><input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></div>
          <div><label>Username</label><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        </div>
        <label>Tags (comma separated)</label>
        <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        {fErr && <div className="err">{fErr}</div>}
        <div style={{ marginTop: 16 }}><button className="btn-primary btn" onClick={submit}>Create target</button></div>
      </div>

      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Endpoint</th><th>Env</th><th>Creds</th><th></th></tr></thead>
          <tbody>
            {data?.targets?.map((t: any) => (
              <tr key={t.id}>
                <td>{t.name}<div className="muted mono">{short(t.id)}</div></td>
                <td>{t.type}</td>
                <td className="mono">{t.username}@{t.host}:{t.port}</td>
                <td><Badge v={t.environment} /></td>
                <td>{t.credential_ids.length}</td>
                <td className="toolbar">
                  <button className="btn-primary btn btn-sm" onClick={() => setCheckoutTarget(t)}>Checkout</button>
                  <button className="btn btn-sm" onClick={async () => { await api.deleteTarget(t.id); setDep((x) => x + 1); }}>Delete</button>
                </td>
              </tr>
            ))}
            {data && !data.targets?.length && <tr><td colSpan={6} className="empty">No targets yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {checkoutTarget && <CheckoutModal target={checkoutTarget} onClose={() => setCheckoutTarget(null)} />}
    </>
  );
}

// ---------------- Credentials ----------------
function Credentials() {
  const [dep, setDep] = useState(0);
  const { data, err } = useList(api.credentials, dep);
  const [form, setForm] = useState({ name: "", type: "password", secret_value: "" });
  const [fErr, setFErr] = useState("");
  const [revealCred, setRevealCred] = useState<any>(null);

  const submit = async () => {
    setFErr("");
    try {
      await api.createCredential({ ...form, provider: "local_encrypted" });
      setForm({ name: "", type: "password", secret_value: "" });
      setDep((x) => x + 1);
    } catch (e: any) { setFErr(e.message); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Credentials</h1>
        <div className="subtitle">Encrypted at rest. Secrets never appear in listings or logs.</div></div></div>

      <div className="card">
        <h3>Add credential</h3>
        <div className="row">
          <div><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>password</option><option>ssh_private_key</option><option>api_token</option>
              <option>kubeconfig</option><option>database_password</option>
            </select>
          </div>
        </div>
        <label>Secret value {form.type === "ssh_private_key" && "(paste PEM private key)"}</label>
        <textarea value={form.secret_value} onChange={(e) => setForm({ ...form, secret_value: e.target.value })} placeholder="use a FAKE secret for demos" />
        {fErr && <div className="err">{fErr}</div>}
        <div style={{ marginTop: 12 }}><button className="btn-primary btn" onClick={submit}>Create credential</button></div>
      </div>

      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Reveals</th><th>Last rotated</th><th></th></tr></thead>
          <tbody>
            {data?.credentials?.map((c: any) => (
              <tr key={c.id}>
                <td>{c.name}<div className="muted mono">{short(c.id)}</div></td>
                <td>{c.type}</td>
                <td><Badge v={c.status} /></td>
                <td>{c.reveal_count_since_rotation}</td>
                <td>{time(c.last_rotated_at)}</td>
                <td className="toolbar">
                  <button className="btn-danger btn btn-sm" onClick={() => setRevealCred(c)}>Reveal</button>
                  <button className="btn btn-sm" onClick={async () => { await api.scheduleRotation(c.id, { reason: "manual" }); setDep((x) => x + 1); }}>Rotate</button>
                  <button className="btn btn-sm" onClick={async () => { await api.deleteCredential(c.id); setDep((x) => x + 1); }}>Delete</button>
                </td>
              </tr>
            ))}
            {data && !data.credentials?.length && <tr><td colSpan={6} className="empty">No credentials yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {revealCred && <RevealModal cred={revealCred} onClose={() => { setRevealCred(null); setDep((x) => x + 1); }} />}
    </>
  );
}

// ---------------- Reveal modal (HIGH RISK) ----------------
function RevealModal({ cred, onClose }: { cred: any; onClose: () => void }) {
  const [purpose, setPurpose] = useState("");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const go = async () => {
    setErr("");
    try {
      setResult(await api.reveal(cred.id, { purpose, requested_by: "desktop-ui", ttl_seconds: 300 }));
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reveal plaintext secret</h2>
        <div className="muted">{cred.name} · {cred.type}</div>
        <div className="risk risk-high">
          <b>High risk.</b> The plaintext secret will be exposed to the caller. This action is audited,
          and per policy may flag the credential for rotation. Prefer <b>Credential Checkout</b> when possible.
        </div>
        {!result ? (
          <>
            <label>Purpose (required, audited)</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. debug prod deploy" />
            {err && <div className="err">{err}</div>}
            <div className="toolbar" style={{ marginTop: 16 }}>
              <button className="btn-danger btn" disabled={!purpose} onClick={go}>Reveal anyway</button>
              <button className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <label>Secret value</label>
            <div className="secret-box">{result.secret_value}</div>
            {result.rotation_required && (
              <div className="risk risk-high">Rotation required before {time(result.rotate_before)}. Job: <span className="mono">{short(result.rotation_job_id)}</span></div>
            )}
            <div className="muted">Reveal id {short(result.reveal_id)} · expires {time(result.expires_at)}</div>
            <div style={{ marginTop: 16 }}><button className="btn" onClick={onClose}>Done</button></div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- Checkout modal (RECOMMENDED) ----------------
function CheckoutModal({ target, onClose }: { target: any; onClose: () => void }) {
  const [purpose, setPurpose] = useState("");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const go = async () => {
    setErr("");
    try {
      setResult(await api.checkout(target.id, { purpose, requested_by: "desktop-ui", ttl_seconds: 900, mode: "temp_key_file" }));
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Checkout SSH access</h2>
        <div className="muted">{target.name} · {target.host}</div>
        <div className="risk risk-good">
          <b>Recommended.</b> Issues temporary, expiring SSH access. No long-term secret is returned to the agent.
        </div>
        {!result ? (
          <>
            <label>Purpose (required, audited)</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. run migration" />
            {err && <div className="err">{err}</div>}
            <div className="toolbar" style={{ marginTop: 16 }}>
              <button className="btn-primary btn" disabled={!purpose} onClick={go}>Checkout</button>
              <button className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <label>SSH command</label>
            <div className="secret-box">{result.ssh_command}</div>
            <div className="muted">Checkout {short(result.checkout_id)} · expires {time(result.expires_at)}</div>
            <div style={{ marginTop: 16 }}><button className="btn" onClick={onClose}>Done</button></div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- Reveals ----------------
function Reveals() {
  const [dep, setDep] = useState(0);
  const { data, err } = useList(api.reveals, dep);
  return (
    <>
      <div className="page-head"><div><h1>Reveal history</h1>
        <div className="subtitle">Every plaintext reveal, with purpose and expiry.</div></div></div>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Credential</th><th>Requested by</th><th>Purpose</th><th>Revealed</th><th>Expires</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data?.reveals?.map((r: any) => (
              <tr key={r.id}>
                <td className="mono">{short(r.credential_id)}</td>
                <td>{r.requested_by}</td>
                <td>{r.purpose}</td>
                <td>{time(r.revealed_at)}</td>
                <td>{time(r.expires_at)}</td>
                <td><Badge v={r.status} /></td>
                <td>{r.status === "active" && <button className="btn btn-sm" onClick={async () => { await api.revokeReveal(r.id); setDep((x) => x + 1); }}>Revoke</button>}</td>
              </tr>
            ))}
            {data && !data.reveals?.length && <tr><td colSpan={7} className="empty">No reveals yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Checkouts ----------------
function Checkouts() {
  const [dep, setDep] = useState(0);
  const { data, err } = useList(api.checkouts, dep);
  return (
    <>
      <div className="page-head"><div><h1>Checkout sessions</h1>
        <div className="subtitle">Temporary access grants. Revoke wipes on-disk artifacts immediately.</div></div></div>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Target</th><th>Mode</th><th>Purpose</th><th>Command</th><th>Expires</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data?.checkouts?.map((c: any) => (
              <tr key={c.id}>
                <td className="mono">{short(c.target_id)}</td>
                <td>{c.mode}</td>
                <td>{c.purpose}</td>
                <td className="mono">{c.ssh_command || "—"}</td>
                <td>{time(c.expires_at)}</td>
                <td><Badge v={c.status} /></td>
                <td>{c.status === "active" && <button className="btn btn-sm" onClick={async () => { await api.revokeCheckout(c.id); setDep((x) => x + 1); }}>Revoke</button>}</td>
              </tr>
            ))}
            {data && !data.checkouts?.length && <tr><td colSpan={7} className="empty">No checkout sessions.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Rotation ----------------
function Rotation() {
  const [dep, setDep] = useState(0);
  const { data, err } = useList(api.rotationJobs, dep);
  const complete = async (id: string) => {
    const v = prompt("New secret value (FAKE for demos):");
    if (!v) return;
    await api.markRotationSuccess(id, { new_secret_value: v });
    setDep((x) => x + 1);
  };
  return (
    <>
      <div className="page-head"><div><h1>Rotation jobs</h1>
        <div className="subtitle">Complete a job with the new secret to reset counters and reactivate.</div></div></div>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Credential</th><th>Reason</th><th>Status</th><th>Created</th><th>Completed</th><th></th></tr></thead>
          <tbody>
            {data?.jobs?.map((j: any) => (
              <tr key={j.id}>
                <td className="mono">{short(j.credential_id)}</td>
                <td>{j.reason}</td>
                <td><Badge v={j.status} /></td>
                <td>{time(j.created_at)}</td>
                <td>{time(j.completed_at)}</td>
                <td>{(j.status === "pending" || j.status === "running") && <button className="btn-primary btn btn-sm" onClick={() => complete(j.id)}>Mark complete</button>}</td>
              </tr>
            ))}
            {data && !data.jobs?.length && <tr><td colSpan={6} className="empty">No rotation jobs.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Audit ----------------
function Audit() {
  const { data, err } = useList(api.audit, 0);
  return (
    <>
      <div className="page-head"><div><h1>Audit logs</h1>
        <div className="subtitle">Redacted, append-only. Newest first.</div></div></div>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Risk</th><th>Purpose</th></tr></thead>
          <tbody>
            {data?.logs?.map((l: any) => (
              <tr key={l.id}>
                <td>{time(l.timestamp)}</td>
                <td>{l.actor}</td>
                <td className="mono">{l.action}</td>
                <td className="mono">{l.resource_type}/{short(l.resource_id)}</td>
                <td><Badge v={l.risk_level} /></td>
                <td>{l.purpose || "—"}</td>
              </tr>
            ))}
            {data && !data.logs?.length && <tr><td colSpan={6} className="empty">No audit entries.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Settings ----------------
function Settings() {
  const [url, setUrl] = useState(getUrl());
  const [token, setToken] = useState(getToken());
  const [status, setStatus] = useState("");
  const save = () => { setConn(url, token); setStatus("saved"); };
  const check = async () => {
    setStatus("checking…");
    try { const h = await api.health(); setStatus(`ok — ${h.service} ${h.version}`); }
    catch (e: any) { setStatus("error: " + e.message); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1>
        <div className="subtitle">Local daemon connection. Token is read from ~/.agentpass/token on daemon start.</div></div></div>
      <div className="card">
        <label>Daemon URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} />
        <label>Local auth token</label>
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste from daemon startup log" />
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="btn-primary btn" onClick={save}>Save</button>
          <button className="btn" onClick={check}>Test connection</button>
          <span className="muted">{status}</span>
        </div>
      </div>
    </>
  );
}
