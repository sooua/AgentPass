import { useEffect, useState } from "react";
import { api, getToken, getUrl, setConn } from "./api.js";
import { usePrefs, type Lang, type Theme } from "./i18n.js";

type Page = "targets" | "credentials" | "reveals" | "checkouts" | "rotation" | "audit" | "settings";

const PAGES: { id: Page; key: string }[] = [
  { id: "targets", key: "nav.targets" },
  { id: "credentials", key: "nav.credentials" },
  { id: "reveals", key: "nav.reveals" },
  { id: "checkouts", key: "nav.checkouts" },
  { id: "rotation", key: "nav.rotation" },
  { id: "audit", key: "nav.audit" },
  { id: "settings", key: "nav.settings" },
];

const Badge = ({ v }: { v: string }) => <span className={`badge badge-${v}`}>{v}</span>;
const short = (s: string | null | undefined) => (s ? s.slice(0, 14) + "…" : "—");
const time = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");

function useList(fn: () => Promise<any>, dep: number): { data: any; err: string } {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fn().then(setData).catch((e) => setErr(e.message));
  }, [dep]);
  return { data, err };
}

export default function App() {
  const [page, setPage] = useState<Page>("targets");
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  return (
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
          <Seg<Lang> value={lang} onChange={setLang} options={[["en", "EN"], ["zh", "中文"]]} />
          <Seg<Theme> value={theme} onChange={setTheme} options={[["light", t("theme.light")], ["dark", t("theme.dark")]]} />
        </div>
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

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <div className="subtitle">{sub}</div>
      </div>
    </div>
  );
}

// ---------------- Targets ----------------
function Targets() {
  const { t } = usePrefs();
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
      <Head title={t("targets.title")} sub={t("targets.sub")} />
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
        {fErr && <div className="err">{fErr}</div>}
        <div style={{ marginTop: 16 }}><button className="btn-primary btn" onClick={submit}>{t("targets.add")}</button></div>
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
                  <button className="btn btn-sm" onClick={async () => { await api.deleteTarget(tg.id); setDep((x) => x + 1); }}>{t("common.delete")}</button>
                </td>
              </tr>
            ))}
            {data && !data.targets?.length && <tr><td colSpan={6} className="empty">{t("targets.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {checkoutTarget && <CheckoutModal target={checkoutTarget} onClose={() => setCheckoutTarget(null)} />}
    </>
  );
}

// ---------------- Credentials ----------------
function Credentials() {
  const { t } = usePrefs();
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
      <Head title={t("creds.title")} sub={t("creds.sub")} />
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
                  <button className="btn btn-sm" onClick={async () => { await api.scheduleRotation(c.id, { reason: "manual" }); setDep((x) => x + 1); }}>{t("common.rotate")}</button>
                  <button className="btn btn-sm" onClick={async () => { await api.deleteCredential(c.id); setDep((x) => x + 1); }}>{t("common.delete")}</button>
                </td>
              </tr>
            ))}
            {data && !data.credentials?.length && <tr><td colSpan={6} className="empty">{t("creds.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {revealCred && <RevealModal cred={revealCred} onClose={() => { setRevealCred(null); setDep((x) => x + 1); }} />}
    </>
  );
}

// ---------------- Reveal modal (HIGH RISK) ----------------
function RevealModal({ cred, onClose }: { cred: any; onClose: () => void }) {
  const { t } = usePrefs();
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
        <h2>{t("reveal.title")}</h2>
        <div className="muted">{cred.name} · {cred.type}</div>
        <div className="risk risk-high">{t("reveal.risk")}</div>
        {!result ? (
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
            {result.rotation_required && (
              <div className="risk risk-high">{t("reveal.rotationReq")} {time(result.rotate_before)}. {t("reveal.job")}: <span className="mono">{short(result.rotation_job_id)}</span></div>
            )}
            <div className="muted">{t("reveal.revealId")} {short(result.reveal_id)} · {t("common.expires")} {time(result.expires_at)}</div>
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
  const go = async () => {
    setErr("");
    try {
      setResult(await api.checkout(target.id, { purpose, requested_by: "desktop-ui", ttl_seconds: 900, mode: "temp_key_file" }));
    } catch (e: any) { setErr(e.message); }
  };
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
            <div className="muted">{t("checkout.meta")} {short(result.checkout_id)} · {t("common.expires")} {time(result.expires_at)}</div>
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
  const [dep, setDep] = useState(0);
  const { data, err } = useList(api.reveals, dep);
  return (
    <>
      <Head title={t("reveals.title")} sub={t("reveals.sub")} />
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
                <td>{r.status === "active" && <button className="btn btn-sm" onClick={async () => { await api.revokeReveal(r.id); setDep((x) => x + 1); }}>{t("common.revoke")}</button>}</td>
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
  const [dep, setDep] = useState(0);
  const { data, err } = useList(api.checkouts, dep);
  return (
    <>
      <Head title={t("checkouts.title")} sub={t("checkouts.sub")} />
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
                <td>{c.status === "active" && <button className="btn btn-sm" onClick={async () => { await api.revokeCheckout(c.id); setDep((x) => x + 1); }}>{t("common.revoke")}</button>}</td>
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
  const [dep, setDep] = useState(0);
  const { data, err } = useList(api.rotationJobs, dep);
  const complete = async (id: string) => {
    const v = prompt(t("rotation.prompt"));
    if (!v) return;
    await api.markRotationSuccess(id, { new_secret_value: v });
    setDep((x) => x + 1);
  };
  return (
    <>
      <Head title={t("rotation.title")} sub={t("rotation.sub")} />
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

// ---------------- Audit ----------------
function Audit() {
  const { t } = usePrefs();
  const { data, err } = useList(api.audit, 0);
  return (
    <>
      <Head title={t("audit.title")} sub={t("audit.sub")} />
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
