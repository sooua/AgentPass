import { useEffect, useState } from "react";
import { api, getToken, getUrl, setConn } from "./api.js";
import { usePrefs, type Lang, type Theme } from "./i18n.js";
import { TitleBar } from "./TitleBar.js";

type Page = "targets" | "credentials" | "reveals" | "checkouts" | "rotation" | "requests" | "audit" | "settings";

// Settings is reached from the bottom-left icon, not the main nav.
const PAGES: { id: Page; key: string }[] = [
  { id: "targets", key: "nav.targets" },
  { id: "credentials", key: "nav.credentials" },
  { id: "reveals", key: "nav.reveals" },
  { id: "checkouts", key: "nav.checkouts" },
  { id: "rotation", key: "nav.rotation" },
  { id: "requests", key: "nav.requests" },
  { id: "audit", key: "nav.audit" },
];

const Badge = ({ v }: { v: string }) => <span className={`badge badge-${v}`}>{v}</span>;
const short = (s: string | null | undefined) => (s ? s.slice(0, 14) + "…" : "—");
const time = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");

// Re-runs fn when any dep changes; reload() forces a refetch (refresh button / after mutations).
function useList(fn: () => Promise<any>, deps: unknown[] = []): { data: any; err: string; reload: () => void } {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setErr("");
    fn().then((d) => live && setData(d)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, err, reload: () => setTick((t) => t + 1) };
}

export default function App() {
  const [page, setPage] = useState<Page>("targets");
  const { t, theme, setTheme } = usePrefs();
  return (
    <div className="root-col">
      <TitleBar />
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-row">
              <img src="/logo.svg" width={28} height={28} alt="" />
              agentpass
            </span>
            <small>{t("brand.sub")}</small>
          </div>
          {PAGES.map((p) => (
            <div key={p.id} className={`navlink ${page === p.id ? "active" : ""}`} onClick={() => setPage(p.id)}>
              {t(p.key)}
            </div>
          ))}
          <div className="side-controls">
            <button
              className="icon-btn"
              aria-label={t("settings.theme")}
              title={t("settings.theme")}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
            <button
              className={`icon-btn ${page === "settings" ? "on" : ""}`}
              aria-label={t("nav.settings")}
              title={t("nav.settings")}
              onClick={() => setPage("settings")}
            >
              <GearIcon />
            </button>
          </div>
        </aside>
        <main className="main">
          {page === "targets" && <Targets />}
          {page === "credentials" && <Credentials />}
          {page === "reveals" && <Reveals />}
          {page === "checkouts" && <Checkouts />}
          {page === "rotation" && <Rotation />}
          {page === "requests" && <Requests />}
          {page === "audit" && <Audit />}
          {page === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
);
const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function Head({ title, sub, onRefresh }: { title: string; sub: string; onRefresh?: () => void }) {
  const { t } = usePrefs();
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <div className="subtitle">{sub}</div>
      </div>
      {onRefresh && <button className="btn btn-sm" onClick={onRefresh}>↻ {t("common.refresh")}</button>}
    </div>
  );
}

// ---------------- Targets ----------------
function Targets() {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [env, setEnv] = useState("");
  const { data, err, reload } = useList(() => api.targets({ q: q || undefined, environment: env || undefined }), [q, env]);
  const creds = useList(() => api.credentials(), []);
  const [form, setForm] = useState({ name: "", type: "ssh", host: "", port: 22, username: "", environment: "dev", tags: "", credential_ids: [] as string[] });
  const [fErr, setFErr] = useState("");
  const [checkoutTarget, setCheckoutTarget] = useState<any>(null);

  const toggleCred = (id: string) =>
    setForm((f) => ({ ...f, credential_ids: f.credential_ids.includes(id) ? f.credential_ids.filter((x) => x !== id) : [...f.credential_ids, id] }));

  const submit = async () => {
    setFErr("");
    try {
      await api.createTarget({ ...form, port: Number(form.port), tags: form.tags ? form.tags.split(",").map((s) => s.trim()) : [] });
      setForm({ name: "", type: "ssh", host: "", port: 22, username: "", environment: "dev", tags: "", credential_ids: [] });
      reload();
    } catch (e: any) { setFErr(e.message); }
  };

  return (
    <>
      <Head title={t("targets.title")} sub={t("targets.sub")} onRefresh={reload} />
      <div className="card">
        <h3>{t("targets.add")}</h3>
        <div className="row">
          <div><label>{t("common.name")}</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label>{t("common.type")}</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>ssh</option><option>database</option><option>kubernetes</option><option>api</option>
            </select>
          </div>
          <div><label>{t("targets.environment")}</label>
            <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
              <option>dev</option><option>staging</option><option>prod</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div><label>{t("targets.host")}</label><input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
          <div><label>{t("targets.port")}</label><input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></div>
          <div><label>{t("targets.username")}</label><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        </div>
        <label>{t("targets.tags")}</label>
        <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        <label>{t("common.credentials")}</label>
        <div className="chips">
          {creds.data?.credentials?.filter((c: any) => c.status !== "revoked").map((c: any) => (
            <span key={c.id} className={`chip ${form.credential_ids.includes(c.id) ? "on" : ""}`} onClick={() => toggleCred(c.id)}>
              {c.name} <span className="muted">· {c.type}</span>
            </span>
          ))}
          {creds.data && !creds.data.credentials?.length && <span className="muted">{t("creds.empty")}</span>}
        </div>
        {fErr && <div className="err">{fErr}</div>}
        <div style={{ marginTop: 16 }}><button className="btn-primary btn" onClick={submit}>{t("targets.add")}</button></div>
      </div>

      <div className="filters">
        <input placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="">{t("common.all")}</option><option>dev</option><option>staging</option><option>prod</option>
        </select>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>{t("common.name")}</th><th>{t("common.type")}</th><th>{t("targets.endpoint")}</th><th>{t("targets.environment")}</th><th>{t("targets.creds")}</th><th></th></tr></thead>
          <tbody>
            {data?.targets?.map((tg: any) => (
              <tr key={tg.id}>
                <td>{tg.name}<div className="muted mono">{short(tg.id)}</div></td>
                <td>{tg.type}</td>
                <td className="mono">{tg.username}@{tg.host}:{tg.port}</td>
                <td><Badge v={tg.environment} /></td>
                <td>{tg.credential_ids.length}</td>
                <td className="toolbar">
                  <button className="btn-primary btn btn-sm" onClick={() => setCheckoutTarget(tg)}>{t("common.checkout")}</button>
                  <button className="btn btn-sm" onClick={async () => { await api.deleteTarget(tg.id); reload(); }}>{t("common.delete")}</button>
                </td>
              </tr>
            ))}
            {data && !data.targets?.length && <tr><td colSpan={6} className="empty">{t("targets.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {checkoutTarget && <CheckoutModal target={checkoutTarget} onClose={() => { setCheckoutTarget(null); reload(); }} />}
    </>
  );
}

// ---------------- Credentials ----------------
function Credentials() {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, err, reload } = useList(() => api.credentials({ q: q || undefined, status: status || undefined }), [q, status]);
  const [form, setForm] = useState({ name: "", type: "password", secret_value: "" });
  const [fErr, setFErr] = useState("");
  const [revealCred, setRevealCred] = useState<any>(null);

  const submit = async () => {
    setFErr("");
    try {
      await api.createCredential({ ...form, provider: "local_encrypted" });
      setForm({ name: "", type: "password", secret_value: "" });
      reload();
    } catch (e: any) { setFErr(e.message); }
  };

  return (
    <>
      <Head title={t("creds.title")} sub={t("creds.sub")} onRefresh={reload} />
      <div className="card">
        <h3>{t("creds.add")}</h3>
        <div className="row">
          <div><label>{t("common.name")}</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label>{t("common.type")}</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>password</option><option>ssh_private_key</option><option>api_token</option>
              <option>kubeconfig</option><option>database_password</option>
            </select>
          </div>
        </div>
        <label>{t("creds.secret")} {form.type === "ssh_private_key" && t("creds.sshHint")}</label>
        <textarea value={form.secret_value} onChange={(e) => setForm({ ...form, secret_value: e.target.value })} placeholder={t("creds.fakeHint")} />
        {fErr && <div className="err">{fErr}</div>}
        <div style={{ marginTop: 12 }}><button className="btn-primary btn" onClick={submit}>{t("creds.add")}</button></div>
      </div>

      <div className="filters">
        <input placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("common.all")}</option><option>active</option><option>rotation_required</option><option>expired</option><option>revoked</option>
        </select>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>{t("common.name")}</th><th>{t("common.type")}</th><th>{t("common.status")}</th><th>{t("creds.reveals")}</th><th>{t("creds.lastRotated")}</th><th></th></tr></thead>
          <tbody>
            {data?.credentials?.map((c: any) => (
              <tr key={c.id}>
                <td>{c.name}<div className="muted mono">{short(c.id)}</div></td>
                <td>{c.type}</td>
                <td><Badge v={c.status} /></td>
                <td>{c.reveal_count_since_rotation}</td>
                <td>{time(c.last_rotated_at)}</td>
                <td className="toolbar">
                  <button className="btn-danger btn btn-sm" onClick={() => setRevealCred(c)}>{t("common.reveal")}</button>
                  <button className="btn btn-sm" onClick={async () => { await api.scheduleRotation(c.id, { reason: "manual" }); reload(); }}>{t("common.rotate")}</button>
                  <button className="btn btn-sm" onClick={async () => { await api.deleteCredential(c.id); reload(); }}>{t("common.delete")}</button>
                </td>
              </tr>
            ))}
            {data && !data.credentials?.length && <tr><td colSpan={6} className="empty">{t("creds.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {revealCred && <RevealModal cred={revealCred} onClose={() => { setRevealCred(null); reload(); }} />}
    </>
  );
}

// ---------------- Reveal modal (HIGH RISK) ----------------
function RevealModal({ cred, onClose }: { cred: any; onClose: () => void }) {
  const { t } = usePrefs();
  const [purpose, setPurpose] = useState("");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(60);

  // Auto-clear the plaintext from the UI after 60s.
  useEffect(() => {
    if (!result) return;
    if (left <= 0) { setResult(null); return; }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [result, left]);

  const go = async () => {
    setErr(""); setPending(false);
    try {
      setResult(await api.reveal(cred.id, { purpose, requested_by: "desktop-ui", ttl_seconds: 300 }));
      setLeft(60);
    } catch (e: any) {
      if (String(e.message).includes("approval")) setPending(true);
      else setErr(e.message);
    }
  };
  const copy = async () => { await navigator.clipboard.writeText(result.secret_value); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("reveal.title")}</h2>
        <div className="muted">{cred.name} · {cred.type}</div>
        <div className="risk risk-high">{t("reveal.risk")}</div>
        {pending ? (
          <>
            <div className="risk risk-high">{t("reveal.pending")}</div>
            <div style={{ marginTop: 16 }}><button className="btn" onClick={onClose}>{t("common.done")}</button></div>
          </>
        ) : !result ? (
          <>
            <label>{t("reveal.purpose")}</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t("reveal.purposePh")} />
            {err && <div className="err">{err}</div>}
            <div className="toolbar" style={{ marginTop: 16 }}>
              <button className="btn-danger btn" disabled={!purpose} onClick={go}>{t("reveal.go")}</button>
              <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
            </div>
          </>
        ) : (
          <>
            <label>{t("reveal.value")}</label>
            <div className="secret-box">{result.secret_value}</div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={copy}>{copied ? t("common.copied") : t("common.copy")}</button>
              <span className="muted">{t("reveal.autoclear")} {left}s</span>
            </div>
            {result.rotation_required && (
              <div className="risk risk-high">{t("reveal.rotationReq")} {time(result.rotate_before)}. {t("reveal.job")}: <span className="mono">{short(result.rotation_job_id)}</span></div>
            )}
            <div className="muted">{t("reveal.revealId")} {short(result.reveal_id)}</div>
            <div style={{ marginTop: 16 }}><button className="btn" onClick={onClose}>{t("common.done")}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- Checkout modal (RECOMMENDED) ----------------
function CheckoutModal({ target, onClose }: { target: any; onClose: () => void }) {
  const { t } = usePrefs();
  const [purpose, setPurpose] = useState("");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const go = async () => {
    setErr("");
    try { setResult(await api.checkout(target.id, { purpose, requested_by: "desktop-ui", ttl_seconds: 900, mode: "temp_key_file" })); }
    catch (e: any) { setErr(e.message); }
  };
  const copy = async () => { await navigator.clipboard.writeText(result.ssh_command); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("checkout.title")}</h2>
        <div className="muted">{target.name} · {target.host}</div>
        <div className="risk risk-good">{t("checkout.risk")}</div>
        {!result ? (
          <>
            <label>{t("reveal.purpose")}</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t("checkout.purposePh")} />
            {err && <div className="err">{err}</div>}
            <div className="toolbar" style={{ marginTop: 16 }}>
              <button className="btn-primary btn" disabled={!purpose} onClick={go}>{t("common.checkout")}</button>
              <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
            </div>
          </>
        ) : (
          <>
            <label>{t("checkout.command")}</label>
            <div className="secret-box">{result.ssh_command}</div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={copy}>{copied ? t("common.copied") : t("common.copy")}</button>
              <span className="muted">{t("checkout.meta")} {short(result.checkout_id)} · {t("common.expires")} {time(result.expires_at)}</span>
            </div>
            <div style={{ marginTop: 16 }}><button className="btn" onClick={onClose}>{t("common.done")}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- Reveals ----------------
function Reveals() {
  const { t } = usePrefs();
  const { data, err, reload } = useList(() => api.reveals(), []);
  return (
    <>
      <Head title={t("reveals.title")} sub={t("reveals.sub")} onRefresh={reload} />
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>{t("reveals.credential")}</th><th>{t("reveals.requestedBy")}</th><th>{t("common.purpose")}</th><th>{t("reveals.revealed")}</th><th>{t("common.expires")}</th><th>{t("common.status")}</th><th></th></tr></thead>
          <tbody>
            {data?.reveals?.map((r: any) => (
              <tr key={r.id}>
                <td className="mono">{short(r.credential_id)}</td>
                <td>{r.requested_by}</td>
                <td>{r.purpose}</td>
                <td>{time(r.revealed_at)}</td>
                <td>{time(r.expires_at)}</td>
                <td><Badge v={r.status} /></td>
                <td>{r.status === "active" && <button className="btn btn-sm" onClick={async () => { await api.revokeReveal(r.id); reload(); }}>{t("common.revoke")}</button>}</td>
              </tr>
            ))}
            {data && !data.reveals?.length && <tr><td colSpan={7} className="empty">{t("reveals.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Checkouts ----------------
function Checkouts() {
  const { t } = usePrefs();
  const { data, err, reload } = useList(() => api.checkouts(), []);
  return (
    <>
      <Head title={t("checkouts.title")} sub={t("checkouts.sub")} onRefresh={reload} />
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>{t("checkouts.target")}</th><th>{t("checkouts.mode")}</th><th>{t("common.purpose")}</th><th>{t("checkouts.command")}</th><th>{t("common.expires")}</th><th>{t("common.status")}</th><th></th></tr></thead>
          <tbody>
            {data?.checkouts?.map((c: any) => (
              <tr key={c.id}>
                <td className="mono">{short(c.target_id)}</td>
                <td>{c.mode}</td>
                <td>{c.purpose}</td>
                <td className="mono">{c.ssh_command || "—"}</td>
                <td>{time(c.expires_at)}</td>
                <td><Badge v={c.status} /></td>
                <td>{c.status === "active" && <button className="btn btn-sm" onClick={async () => { await api.revokeCheckout(c.id); reload(); }}>{t("common.revoke")}</button>}</td>
              </tr>
            ))}
            {data && !data.checkouts?.length && <tr><td colSpan={7} className="empty">{t("checkouts.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Rotation ----------------
function Rotation() {
  const { t } = usePrefs();
  const { data, err, reload } = useList(() => api.rotationJobs(), []);
  const complete = async (id: string) => {
    const v = prompt(t("rotation.prompt"));
    if (!v) return;
    await api.markRotationSuccess(id, { new_secret_value: v });
    reload();
  };
  return (
    <>
      <Head title={t("rotation.title")} sub={t("rotation.sub")} onRefresh={reload} />
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>{t("reveals.credential")}</th><th>{t("rotation.reason")}</th><th>{t("common.status")}</th><th>{t("rotation.created")}</th><th>{t("rotation.completed")}</th><th></th></tr></thead>
          <tbody>
            {data?.jobs?.map((j: any) => (
              <tr key={j.id}>
                <td className="mono">{short(j.credential_id)}</td>
                <td>{j.reason}</td>
                <td><Badge v={j.status} /></td>
                <td>{time(j.created_at)}</td>
                <td>{time(j.completed_at)}</td>
                <td>{(j.status === "pending" || j.status === "running") && <button className="btn-primary btn btn-sm" onClick={() => complete(j.id)}>{t("rotation.mark")}</button>}</td>
              </tr>
            ))}
            {data && !data.jobs?.length && <tr><td colSpan={6} className="empty">{t("rotation.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Requests (approvals) ----------------
function Requests() {
  const { t } = usePrefs();
  const { data, err, reload } = useList(() => api.revealRequests(), []);
  return (
    <>
      <Head title={t("requests.title")} sub={t("requests.sub")} onRefresh={reload} />
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>{t("reveals.credential")}</th><th>{t("reveals.requestedBy")}</th><th>{t("common.purpose")}</th><th>{t("common.status")}</th><th>{t("requests.decidedBy")}</th><th></th></tr></thead>
          <tbody>
            {data?.requests?.map((r: any) => (
              <tr key={r.id}>
                <td className="mono">{short(r.credential_id)}</td>
                <td>{r.requested_by}</td>
                <td>{r.purpose}</td>
                <td><Badge v={r.status} /></td>
                <td>{r.decided_by || "—"}</td>
                <td className="toolbar">
                  {r.status === "pending" && <>
                    <button className="btn-primary btn btn-sm" onClick={async () => { await api.approveRevealRequest(r.id); reload(); }}>{t("common.approve")}</button>
                    <button className="btn-danger btn btn-sm" onClick={async () => { await api.denyRevealRequest(r.id); reload(); }}>{t("common.deny")}</button>
                  </>}
                </td>
              </tr>
            ))}
            {data && !data.requests?.length && <tr><td colSpan={6} className="empty">{t("requests.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Audit ----------------
function Audit() {
  const { t } = usePrefs();
  const { data, err, reload } = useList(() => api.audit(), []);
  return (
    <>
      <Head title={t("audit.title")} sub={t("audit.sub")} onRefresh={reload} />
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>{t("audit.time")}</th><th>{t("audit.actor")}</th><th>{t("audit.action")}</th><th>{t("audit.resource")}</th><th>{t("audit.risk")}</th><th>{t("common.purpose")}</th></tr></thead>
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
            {data && !data.logs?.length && <tr><td colSpan={6} className="empty">{t("audit.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Settings ----------------
function Settings() {
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const [url, setUrl] = useState(getUrl());
  const [token, setToken] = useState(getToken());
  const [status, setStatus] = useState("");
  const save = () => { setConn(url, token); setStatus(t("settings.saved")); };
  const check = async () => {
    setStatus(t("settings.checking"));
    try { const h = await api.health(); setStatus(`ok — ${h.service} ${h.version}`); }
    catch (e: any) { setStatus("error: " + e.message); }
  };
  return (
    <>
      <Head title={t("settings.title")} sub={t("settings.sub")} />
      <div className="card">
        <label>{t("settings.url")}</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} />
        <label>{t("settings.token")}</label>
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder={t("settings.tokenPh")} />
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="btn-primary btn" onClick={save}>{t("settings.save")}</button>
          <button className="btn" onClick={check}>{t("settings.test")}</button>
          <span className="muted">{status}</span>
        </div>
      </div>
      <div className="card">
        <h3>{t("settings.appearance")}</h3>
        <div className="row">
          <div>
            <label>{t("settings.language")}</label>
            <Seg<Lang> value={lang} onChange={setLang} options={[["en", "English"], ["zh", "中文"]]} />
          </div>
          <div>
            <label>{t("settings.theme")}</label>
            <Seg<Theme> value={theme} onChange={setTheme} options={[["light", t("theme.light")], ["dark", t("theme.dark")]]} />
          </div>
        </div>
      </div>
    </>
  );
}
