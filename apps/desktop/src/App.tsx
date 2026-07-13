import { createContext, useContext, useEffect, useState } from "react";
import { Copy, KeyRound, Minus, Moon, RefreshCw, Settings as SettingsIcon, Sun, Trash2, X } from "lucide-react";
import { api, getToken, getUrl, setConn } from "./api.js";
import { usePrefs, type Lang, type Theme } from "./i18n.js";
import { SyncModal } from "./SyncModal.js";
import { checkForUpdate, installAndRestart, type UpdateInfo } from "./updater.js";
import { clearPin, hasPin, lockMinutes, setLockMinutes, setPin, verifyPin } from "./lock.js";

// Global refresh signal: the topbar refresh button bumps this; every useList
// includes it, so the active page refetches.
const RefreshCtx = createContext(0);

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
// Auto-connect the desktop app to the local daemon (reads the url+token the
// daemon publishes). Falls back to whatever is in Settings on the web build.
async function autoConnect(): Promise<void> {
  if (!inTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = (await invoke("daemon_conn")) as string;
    const { url, token } = JSON.parse(raw);
    if (url && token) setConn(url, token);
  } catch {
    /* daemon not up yet — Settings still works */
  }
}

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

// Debounce a value (filter inputs) so typing doesn't fire a request per keystroke.
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// Clipboard copy that never throws (Tauri webview / insecure context may block it).
function useCopy(): { state: "" | "ok" | "fail"; copy: (text: string) => void } {
  const [state, setState] = useState<"" | "ok" | "fail">("");
  const copy = (text: string) => {
    Promise.resolve()
      .then(() => navigator.clipboard?.writeText(text))
      .then(() => setState("ok"))
      .catch(() => setState("fail"))
      .finally(() => setTimeout(() => setState(""), 1800));
  };
  return { state, copy };
}

// Live SSE stream from the daemon (C3): replaces polling. Fires onEvent on every
// change so the active page refetches; tracks connection state; reconnects on
// drop (re-reading conn.json first).
function useLiveConnection(onEvent: () => void): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    let ctrl: AbortController | null = null;
    const connect = async () => {
      if (!alive) return;
      await autoConnect();
      ctrl = new AbortController();
      try {
        const res = await fetch(getUrl() + "/events", { headers: { authorization: `Bearer ${getToken()}` }, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error("no stream");
        setOk(true);
        onEvent(); // initial load now that we're authed
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (alive) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (chunk.startsWith("data:")) onEvent();
          }
        }
      } catch { /* stream dropped */ }
      if (alive) { setOk(false); setTimeout(() => void connect(), 3000); }
    };
    void connect();
    return () => { alive = false; ctrl?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ok;
}

// Re-runs fn when any dep changes; reload() forces a refetch (refresh button / after mutations).
function useList(fn: () => Promise<any>, deps: unknown[] = []): { data: any; err: string; reload: () => void } {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const nonce = useContext(RefreshCtx);
  useEffect(() => {
    let live = true;
    setErr("");
    fn().then((d) => live && setData(d)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, nonce]);
  return { data, err, reload: () => setTick((t) => t + 1) };
}

export default function App() {
  const [page, setPage] = useState<Page>("targets");
  const [nonce, setNonce] = useState(0);
  const { t, theme, setTheme } = usePrefs();
  const connected = useLiveConnection(() => setNonce((n) => n + 1));
  const [locked, setLocked] = useState(hasPin());
  // Idle auto-lock (only when a PIN is set).
  useEffect(() => {
    if (!hasPin() || locked) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => setLocked(true), lockMinutes() * 60000); };
    const evs = ["mousemove", "keydown", "click"] as const;
    evs.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => { clearTimeout(timer); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [locked]);
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;
  return (
    <RefreshCtx.Provider value={nonce}>
    <div className="root-col">
      {/* Top bar: brand left, actions right — one draggable row (sweep-style). */}
      <div className="topbar">
        <div className="topbar-brand" data-tauri-drag-region>
          <img src="logo.svg" width={34} height={34} alt="" data-tauri-drag-region />
          <span data-tauri-drag-region>AgentPass</span>
        </div>
        <div className="topbar-drag" data-tauri-drag-region />
        <div className="topbar-actions">
          <span className={`conn-dot ${connected ? "on" : "off"}`} title={connected ? t("conn.online") : t("conn.offline")} />
          <button className="iconbtn" title={t("common.refresh")} onClick={() => setNonce((n) => n + 1)}><RefreshCw size={18} /></button>
          <button className="iconbtn" title={t("settings.theme")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}</button>
          <button className={`iconbtn ${page === "settings" ? "on" : ""}`} title={t("nav.settings")} onClick={() => setPage("settings")}><SettingsIcon size={18} /></button>
        </div>
        <WindowButtons />
      </div>
      <div className="app">
        <aside className="sidebar">
          {PAGES.map((p) => (
            <div key={p.id} className={`navlink ${page === p.id ? "active" : ""}`} onClick={() => setPage(p.id)}>
              {t(p.key)}
            </div>
          ))}
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
    </RefreshCtx.Provider>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { t } = usePrefs();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const submit = async () => { (await verifyPin(pin)) ? onUnlock() : (setErr(true), setPin("")); };
  return (
    <div className="lockscreen">
      <img src="logo.svg" width={48} height={48} alt="" />
      <div className="lock-title">AgentPass</div>
      <input
        type="password" autoFocus value={pin} className={err ? "lock-err" : ""}
        onChange={(e) => { setPin(e.target.value); setErr(false); }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={t("lock.enter")}
      />
      <button className="btn-primary btn" onClick={submit}>{t("lock.unlock")}</button>
    </div>
  );
}

function LockCard() {
  const { t } = usePrefs();
  const [pin, setPin2] = useState("");
  const [min, setMin] = useState(lockMinutes());
  const [msg, setMsg] = useState("");
  const enabled = hasPin();
  return (
    <div className="card">
      <h3>{t("lock.title")}</h3>
      <div className="muted" style={{ marginBottom: 10 }}>{enabled ? t("lock.on") : t("lock.off")}</div>
      {!enabled ? (
        <>
          <label>{t("lock.setPin")}</label>
          <input type="password" value={pin} onChange={(e) => setPin2(e.target.value)} />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn-primary btn" disabled={pin.length < 4} onClick={async () => { await setPin(pin); setPin2(""); setMsg(t("lock.enabled")); }}>{t("lock.enable")}</button>
            <span className="muted">{msg} · {t("lock.min")}: <input type="number" value={min} min={1} style={{ width: 60, display: "inline-block" }} onChange={(e) => { setMin(Number(e.target.value)); setLockMinutes(Number(e.target.value)); }} /></span>
          </div>
        </>
      ) : (
        <button className="btn" onClick={() => { clearPin(); setMsg(t("lock.disabled")); }}>{t("lock.disable")} {msg}</button>
      )}
    </div>
  );
}

// Window controls (Tauri only) live in the top bar; window drags by the brand.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
async function tauriWin() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}
function WindowButtons() {
  if (!isTauri) return null;
  return (
    <div className="win-btns">
      <button className="win-btn" aria-label="minimize" title="minimize" onClick={() => void tauriWin().then((w) => w.minimize())}>
        <Minus size={16} />
      </button>
      <button className="win-btn close" aria-label="close" title="close" onClick={() => void tauriWin().then((w) => w.close())}>
        <X size={16} />
      </button>
    </div>
  );
}


function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

// No per-page header — nav names the page, refresh lives in the top bar.
function Head(_props: { title?: string; sub?: string; onRefresh?: () => void }) {
  return null;
}

// ---------------- Targets ----------------
function Targets() {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [env, setEnv] = useState("");
  const dq = useDebounced(q);
  const { data, err, reload } = useList(() => api.targets({ q: dq || undefined, environment: env || undefined }), [dq, env]);
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
      <QuickAdd onDone={reload} />
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

// ---------------- Quick add (one-step target + credential) ----------------
function QuickAdd({ onDone }: { onDone: () => void }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ name: "", host: "", port: 22, username: "", environment: "dev", credType: "password", secret: "" });
  const [err, setErr] = useState("");
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const submit = async () => {
    setErr("");
    try {
      const cred = await api.createCredential({ name: `${f.name} · ${f.credType}`, type: f.credType, secret_value: f.secret, provider: "local_encrypted" });
      await api.createTarget({
        name: f.name, type: "ssh", host: f.host, port: Number(f.port), username: f.username,
        environment: f.environment, tags: [], credential_ids: [cred.id],
      });
      setF({ name: "", host: "", port: 22, username: "", environment: "dev", credType: "password", secret: "" });
      onDone();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="card">
      <h3>{t("quickadd.title")}</h3>
      <div className="row">
        <div><label>{t("common.name")}</label><input value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><label>{t("targets.host")}</label><input value={f.host} onChange={(e) => set("host", e.target.value)} /></div>
        <div><label>{t("targets.port")}</label><input type="number" value={f.port} onChange={(e) => set("port", Number(e.target.value))} /></div>
      </div>
      <div className="row">
        <div><label>{t("targets.username")}</label><input value={f.username} onChange={(e) => set("username", e.target.value)} /></div>
        <div><label>{t("targets.environment")}</label>
          <select value={f.environment} onChange={(e) => set("environment", e.target.value)}><option>dev</option><option>staging</option><option>prod</option></select>
        </div>
        <div><label>{t("quickadd.credType")}</label>
          <select value={f.credType} onChange={(e) => set("credType", e.target.value)}><option value="password">password</option><option value="ssh_private_key">ssh_private_key</option></select>
        </div>
      </div>
      <label>{t("quickadd.secret")}</label>
      <textarea value={f.secret} onChange={(e) => set("secret", e.target.value)} placeholder={t("creds.fakeHint")} />
      {err && <div className="err">{err}</div>}
      <div style={{ marginTop: 12 }}>
        <button className="btn-primary btn" disabled={!f.name || !f.host || !f.username || !f.secret} onClick={submit}>{t("quickadd.create")}</button>
      </div>
    </div>
  );
}

// ---------------- Credentials ----------------
function Credentials() {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const dq = useDebounced(q);
  const { data, err, reload } = useList(() => api.credentials({ q: dq || undefined, status: status || undefined }), [dq, status]);
  const [form, setForm] = useState({ name: "", type: "password", secret_value: "", metadata: "" });
  const [fErr, setFErr] = useState("");
  const [revealCred, setRevealCred] = useState<any>(null);

  const submit = async () => {
    setFErr("");
    let metadata: Record<string, unknown> = {};
    if (form.metadata.trim()) {
      try { metadata = JSON.parse(form.metadata); }
      catch { setFErr("metadata must be valid JSON"); return; }
    }
    try {
      await api.createCredential({ name: form.name, type: form.type, secret_value: form.secret_value, metadata, provider: "local_encrypted" });
      setForm({ name: "", type: "password", secret_value: "", metadata: "" });
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
        <label>{t("creds.metadata")}</label>
        <input value={form.metadata} onChange={(e) => setForm({ ...form, metadata: e.target.value })} placeholder={t("creds.metadataHint")} />
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
  const { state: copyState, copy } = useCopy();
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
              <button className="btn btn-sm" onClick={() => copy(result.secret_value)}>{copyState === "ok" ? t("common.copied") : t("common.copy")}</button>
              <span className="muted">{copyState === "fail" ? t("common.copyFailed") : `${t("reveal.autoclear")} ${left}s`}</span>
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
  const { state: copyState, copy } = useCopy();
  const go = async () => {
    setErr("");
    try { setResult(await api.checkout(target.id, { purpose, requested_by: "desktop-ui", ttl_seconds: 900, mode: "temp_key_file" })); }
    catch (e: any) { setErr(e.message); }
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
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => copy(result.ssh_command)}>{copyState === "ok" ? t("common.copied") : t("common.copy")}</button>
              <span className="muted">{copyState === "fail" ? t("common.copyFailed") : `${t("checkout.meta")} ${short(result.checkout_id)} · ${t("common.expires")} ${time(result.expires_at)}`}</span>
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

// ---------------- Update panel ----------------
function UpdatePanel() {
  const { t } = usePrefs();
  const [status, setStatus] = useState("");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setStatus(t("update.checking")); setInfo(null);
    const r = await checkForUpdate();
    if (r.state === "web") setStatus(t("update.webOnly"));
    else if (r.state === "none") setStatus(t("update.upToDate"));
    else if (r.state === "error") setStatus("error: " + r.message);
    else { setInfo(r.info); setStatus(`${t("update.available")}: v${r.info.version}`); }
  };
  const install = async () => {
    if (!info) return;
    setBusy(true); setStatus(t("update.installing"));
    try { await installAndRestart(info); } catch (e: any) { setStatus("error: " + e.message); setBusy(false); }
  };

  return (
    <div className="card">
      <h3>{t("update.title")}</h3>
      <div className="toolbar">
        <button className="btn" onClick={check} disabled={busy}>{t("update.check")}</button>
        {info && <button className="btn-primary btn" onClick={install} disabled={busy}>{t("update.install")}</button>}
        <span className="muted">{status}</span>
      </div>
      {info?.body && <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{info.body}</div>}
    </div>
  );
}

// ---------------- Settings ----------------
function BackupPanel() {
  const { t } = usePrefs();
  const [pass, setPass] = useState("");
  const [blob, setBlob] = useState("");
  const [msg, setMsg] = useState("");
  const doExport = async () => {
    setMsg("");
    try {
      const r = await api.exportBackup(pass);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.blob], { type: "application/json" }));
      a.download = `agentpass-backup-${Date.now()}.json`;
      a.click();
      setMsg(t("backup.exported"));
    } catch (e: any) { setMsg(e.message); }
  };
  const doImport = async () => {
    setMsg("");
    try { const r = await api.importBackup(pass, blob.trim()); setMsg(`${t("backup.imported")} (${r.stats?.credentials ?? 0})`); }
    catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="card">
      <h3>{t("backup.title")}</h3>
      <div className="risk risk-good" style={{ marginBottom: 8 }}>{t("backup.desc")}</div>
      <label>{t("backup.pass")}</label>
      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
      <label>{t("backup.import")}</label>
      <textarea value={blob} onChange={(e) => setBlob(e.target.value)} placeholder={t("backup.paste")} style={{ minHeight: 70 }} />
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn-primary btn" disabled={!pass} onClick={doExport}>{t("backup.export")}</button>
        <button className="btn" disabled={!pass || !blob.trim()} onClick={doImport}>{t("backup.import")}</button>
        <span className="muted">{msg}</span>
      </div>
    </div>
  );
}

const CAPS = ["reveal", "checkout", "list", "rotate", "admin"] as const;
const ENVS = ["dev", "staging", "prod"] as const;

// Scoped per-agent tokens (B3): create a token bound to an agent name + a
// capability/environment/tag scope. Plaintext is shown once on creation.
function AgentTokensPanel() {
  const { t } = usePrefs();
  const { data, reload } = useList(() => api.agentTokens(), []);
  const [name, setName] = useState("");
  const [caps, setCaps] = useState<string[]>(["list"]);
  const [envs, setEnvs] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [days, setDays] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [msg, setMsg] = useState("");

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const create = async () => {
    setMsg(""); setPlaintext("");
    try {
      const r = await api.createAgentToken({
        name,
        capabilities: caps,
        environments: envs,
        target_tags: tags ? tags.split(",").map((s) => s.trim()).filter(Boolean) : [],
        expires_at: days ? new Date(Date.now() + Number(days) * 864e5).toISOString() : null,
      });
      setPlaintext(r.token);
      setName(""); setCaps(["list"]); setEnvs([]); setTags(""); setDays("");
      reload();
    } catch (e: any) { setMsg(e.message); }
  };

  return (
    <div className="card">
      <h3><KeyRound size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />{t("atok.title")}</h3>
      <div className="muted" style={{ marginBottom: 10 }}>{t("atok.desc")}</div>

      {plaintext && (
        <div className="risk risk-good" style={{ marginBottom: 12, wordBreak: "break-all" }}>
          <div style={{ marginBottom: 6 }}>{t("atok.once")}</div>
          <code>{plaintext}</code>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => void navigator.clipboard.writeText(plaintext)}>
            <Copy size={14} /> {t("atok.copy")}
          </button>
        </div>
      )}

      <label>{t("atok.name")}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-code-prod" />
      <label>{t("atok.caps")}</label>
      <div className="chips">
        {CAPS.map((c) => (
          <button key={c} className={caps.includes(c) ? "on" : ""} onClick={() => toggle(caps, setCaps, c)}>{c}</button>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: 6 }}>
        <button className="btn btn-sm" onClick={() => { setCaps(["reveal", "checkout", "list", "rotate"]); setEnvs([]); }}>{t("atok.preset")}</button>
        <span className="muted">{t("atok.presetHint")}</span>
      </div>
      {caps.includes("admin") && <div className="risk risk-high" style={{ marginTop: 8 }}>{t("atok.adminWarn")}</div>}
      <label>{t("atok.envs")}</label>
      <div className="chips">
        {ENVS.map((e) => (
          <button key={e} className={envs.includes(e) ? "on" : ""} onClick={() => toggle(envs, setEnvs, e)}>{e}</button>
        ))}
      </div>
      <label>{t("atok.tags")}</label>
      <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("atok.tagsPh")} />
      <label>{t("atok.expiry")}</label>
      <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} placeholder={t("atok.expiryPh")} />
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn-primary btn" disabled={!name || caps.length === 0} onClick={create}>{t("atok.create")}</button>
        <span className="muted">{msg}</span>
      </div>

      {data?.tokens?.length > 0 && (
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>{t("atok.name")}</th><th>{t("atok.caps")}</th><th>{t("atok.scope")}</th><th></th></tr></thead>
          <tbody>
            {data.tokens.map((tk: any) => (
              <tr key={tk.id} style={tk.revoked ? { opacity: 0.5 } : undefined}>
                <td>{tk.name}{tk.revoked ? ` (${t("atok.revoked")})` : ""}</td>
                <td>{tk.capabilities.join(", ")}</td>
                <td className="muted">{[tk.environments.join("/") || "*", (tk.target_tags.length ? `#${tk.target_tags.join(",#")}` : "")].filter(Boolean).join(" ")}</td>
                <td>{!tk.revoked && (
                  <button className="btn" title={t("atok.revoke")} onClick={async () => { await api.revokeAgentToken(tk.id); reload(); }}>
                    <Trash2 size={14} />
                  </button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Settings() {
  const { t, lang, setLang } = usePrefs();
  const [url, setUrl] = useState(getUrl());
  const [token, setToken] = useState(getToken());
  const [status, setStatus] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const save = () => { setConn(url, token); setStatus(t("settings.saved")); };
  const check = async () => {
    setStatus(t("settings.checking"));
    try { const h = await api.health(); setStatus(`ok — ${h.service} ${h.version}`); }
    catch (e: any) { setStatus("error: " + e.message); }
  };
  return (
    <>
      <div className="card">
        <h3>{t("sync.title")}</h3>
        <button className="btn-primary btn" onClick={() => setSyncOpen(true)}>{t("sync.open")}…</button>
      </div>
      {syncOpen && <SyncModal onClose={() => setSyncOpen(false)} />}
      <BackupPanel />
      <UpdatePanel />
      <div className="card">
        <h3>{t("settings.language")}</h3>
        <Seg<Lang> value={lang} onChange={setLang} options={[["en", "English"], ["zh", "中文"]]} />
      </div>
      <LockCard />
      <AgentTokensPanel />
      <div className="card">
        <h3>{t("settings.connTitle")}</h3>
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
    </>
  );
}
