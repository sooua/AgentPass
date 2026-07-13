import { useEffect, useState } from "react";
import { Cloud, CloudOff, Database, FileCode, Folder, History as HistoryIcon, RefreshCw, RotateCcw, Server, X } from "lucide-react";
import { api } from "./api.js";
import { usePrefs } from "./i18n.js";

const PROVIDERS = [
  { id: "gist", name: "GitHub Gist", Icon: FileCode, available: true },
  { id: "local", nameKey: "sync.localFolder", Icon: Folder, available: true },
  { id: "webdav", name: "WebDAV", Icon: Server, available: true },
  { id: "s3", name: "S3", Icon: Database, available: true },
  { id: "gdrive", name: "Google Drive", Icon: Cloud, available: false },
  { id: "onedrive", name: "Microsoft OneDrive", Icon: Cloud, available: false },
] as const;

function relTime(ms: number, t: (k: string) => string): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t("sync.st.pushed") && `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`switch ${checked ? "on" : ""}`}>
      <span className="knob" />
    </button>
  );
}

export function SyncModal({ onClose }: { onClose: () => void }) {
  const { t } = usePrefs();
  const [state, setState] = useState<any>(null);
  const [tab, setTab] = useState<"services" | "status">("services");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [encOpen, setEncOpen] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [token, setToken] = useState("");
  const [dav, setDav] = useState({ url: "", username: "", password: "" });
  const [dir, setDir] = useState("");
  const [s3, setS3] = useState({ endpoint: "", region: "us-east-1", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "" });

  const refresh = () => api.syncState().then(setState).catch(() => {});
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const connect = async (id: string, cfg: unknown) => {
    setBusy(true);
    try { const s = await api.syncConnect(id, cfg); setState(s); if (s.connected) setConnectingId(null); }
    finally { setBusy(false); }
  };
  const runSync = async () => { setBusy(true); try { await api.syncRun(); await refresh(); } finally { setBusy(false); } };
  const openHistory = async () => { setLoadingHistory(true); setHistory((await api.syncVersions().catch(() => ({ versions: [] }))).versions || []); setLoadingHistory(false); };
  const applyEnc = async () => { if (!pass.trim()) return; setState(await api.syncPassphrase(pass.trim())); setEncOpen(false); setPass(""); };
  const doRestore = async () => { if (!restoreId) return; setBusy(true); try { await api.syncRestore(restoreId); await refresh(); setHistory(null); } finally { setBusy(false); setRestoreId(null); } };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <div className="seg tabs">
            <button className={tab === "services" ? "on" : ""} onClick={() => { setTab("services"); setHistory(null); }}>{t("sync.tabServices")}</button>
            <button className={tab === "status" ? "on" : ""} onClick={() => { setTab("status"); setHistory(null); }}>{t("sync.tabStatus")}</button>
          </div>
          <button className="icon-btn ghost" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="sync-body">
          {history ? (
            <History versions={history} loading={loadingHistory} busy={busy} t={t}
              onBack={() => setHistory(null)}
              onRestore={(v) => setRestoreId(v.id)} />
          ) : tab === "status" ? (
            <Status state={state} t={t} />
          ) : (
            <div className="sync-list">
              {PROVIDERS.map((p) => {
                const connected = state?.provider === p.id && state?.connected;
                const isConnecting = connectingId === p.id;
                const name = (p as any).nameKey ? t((p as any).nameKey) : (p as any).name;
                return (
                  <div key={p.id} className="sync-card">
                    <div className="sync-card-row">
                      <div className="sync-ic"><p.Icon size={22} /></div>
                      <div className="sync-meta">
                        <div className="sync-name">{name}<span className={`dot ${connected ? "on" : ""}`} /></div>
                        <div className="muted">
                          {connected ? `${state?.account ?? ""}${state?.lastSyncedAt ? " · " + relTime(state.lastSyncedAt, t) : ""}`
                            : p.available ? t("sync.notConnected") : t("sync.soon")}
                        </div>
                      </div>
                      {connected ? (
                        <div className="sync-actions">
                          <button className="card-action" onClick={runSync} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} />{t("sync.run")}</button>
                          <button className="card-action" onClick={openHistory}><HistoryIcon size={15} />{t("sync.history")}</button>
                          <button className="icon-btn ghost danger" title={t("sync.disconnect")} onClick={async () => { setState(await api.syncDisconnect()); }}><CloudOff size={16} /></button>
                        </div>
                      ) : p.available ? (
                        <button className="btn-primary btn btn-sm" onClick={() => setConnectingId(isConnecting ? null : p.id)}><Cloud size={15} />{t("sync.connect")}</button>
                      ) : (
                        <span className="soon-chip">{t("sync.notYet")}</span>
                      )}
                    </div>

                    {connected && (
                      <div className="sync-toggle">
                        <div><div className="sync-name sm">{t("sync.auto")}</div><div className="muted">{t("sync.autoDesc")}</div></div>
                        <Switch checked={!!state?.autoSync} onChange={async (v) => setState(await api.syncAuto(v))} />
                      </div>
                    )}
                    {connected && (
                      <div className="sync-toggle">
                        <div><div className="sync-name sm">{t("sync.e2e")}</div><div className="muted">{t("sync.e2eDesc")}</div></div>
                        <Switch checked={!!state?.encrypted} onChange={(v) => { if (v) setEncOpen(true); else void api.syncPassphrase("").then(setState); }} />
                      </div>
                    )}
                    {connected && encOpen && !state?.encrypted && (
                      <div className="sync-encform">
                        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyEnc()} placeholder={t("sync.setPass")} />
                        <button className="btn-primary btn btn-sm" onClick={applyEnc}>{t("sync.enable")}</button>
                      </div>
                    )}

                    {!connected && isConnecting && p.id === "gist" && (
                      <div className="sync-connform">
                        <label>{t("sync.token")}</label>
                        <div className="row2"><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" />
                          <button className="btn-primary btn btn-sm" disabled={busy} onClick={() => connect("gist", { token: token.trim() })}>{t("sync.connect")}</button></div>
                      </div>
                    )}
                    {!connected && isConnecting && p.id === "local" && (
                      <div className="sync-connform">
                        <label>{t("sync.dir")}</label>
                        <div className="row2"><input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="C:\\Users\\me\\Dropbox\\agentpass" />
                          <button className="btn-primary btn btn-sm" disabled={busy || !dir} onClick={() => connect("local", { dir })}>{t("sync.connect")}</button></div>
                      </div>
                    )}
                    {!connected && isConnecting && p.id === "webdav" && (
                      <div className="sync-connform">
                        <label>{t("sync.url")}</label>
                        <input value={dav.url} onChange={(e) => setDav({ ...dav, url: e.target.value })} placeholder="https://dav.example.com/agentpass/" />
                        <div className="row2" style={{ marginTop: 8 }}>
                          <input value={dav.username} onChange={(e) => setDav({ ...dav, username: e.target.value })} placeholder={t("sync.username")} />
                          <input type="password" value={dav.password} onChange={(e) => setDav({ ...dav, password: e.target.value })} placeholder={t("sync.password")} />
                        </div>
                        <button className="btn-primary btn btn-sm full" disabled={busy} onClick={() => connect("webdav", dav)} style={{ marginTop: 8 }}>{t("sync.connect")}</button>
                      </div>
                    )}
                    {!connected && isConnecting && p.id === "s3" && (
                      <div className="sync-connform">
                        <label>{t("sync.endpoint")}</label>
                        <input value={s3.endpoint} onChange={(e) => setS3({ ...s3, endpoint: e.target.value })} placeholder="https://s3.amazonaws.com" />
                        <div className="row2" style={{ marginTop: 8 }}>
                          <input value={s3.bucket} onChange={(e) => setS3({ ...s3, bucket: e.target.value })} placeholder={t("sync.bucket")} />
                          <input value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value })} placeholder={t("sync.region")} />
                        </div>
                        <div className="row2" style={{ marginTop: 8 }}>
                          <input value={s3.accessKeyId} onChange={(e) => setS3({ ...s3, accessKeyId: e.target.value })} placeholder={t("sync.accessKey")} />
                          <input type="password" value={s3.secretAccessKey} onChange={(e) => setS3({ ...s3, secretAccessKey: e.target.value })} placeholder={t("sync.secretKey")} />
                        </div>
                        <input value={s3.prefix} onChange={(e) => setS3({ ...s3, prefix: e.target.value })} placeholder={t("sync.prefix")} style={{ marginTop: 8 }} />
                        <button className="btn-primary btn btn-sm full" disabled={busy} onClick={() => connect("s3", { ...s3, prefix: s3.prefix || undefined })} style={{ marginTop: 8 }}>{t("sync.connect")}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {restoreId && (
          <div className="overlay" onClick={(e) => { e.stopPropagation(); setRestoreId(null); }}>
            <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
              <h3>{t("sync.restore")}</h3>
              <div className="muted" style={{ marginBottom: 8 }}>{t("sync.restoreConfirm")}</div>
              <div className="toolbar" style={{ marginTop: 16 }}>
                <button className="btn-primary btn" disabled={busy} onClick={doRestore}>{t("sync.restore")}</button>
                <button className="btn" onClick={() => setRestoreId(null)}>{t("common.cancel")}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Status({ state, t }: { state: any; t: (k: string) => string }) {
  if (!state?.connected) return <div className="empty">{t("sync.notConnectedAny")}</div>;
  const st = state.lastStatus ?? "idle";
  const F = ({ l, children }: { l: string; children: any }) => (<div className="status-field"><span className="muted">{l}</span><span>{children}</span></div>);
  return (
    <div>
      <F l={t("sync.provider")}>{state.provider}</F>
      <F l={t("sync.account")}>{state.account ?? "—"}</F>
      <F l={t("common.status")}><span className={`badge badge-${st === "error" ? "failed" : "active"}`}>{t("sync.st." + st) || st}</span></F>
      {state.lastMessage && <F l="—">{state.lastMessage}</F>}
      <F l={t("sync.lastSync")}>{state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleString() : "—"}</F>
      <F l={t("sync.deviceId")}><code className="mono">{String(state.deviceId).slice(0, 12)}</code></F>
    </div>
  );
}

function History({ versions, loading, busy, t, onBack, onRestore }: { versions: any[]; loading: boolean; busy: boolean; t: (k: string) => string; onBack: () => void; onRestore: (v: any) => void }) {
  return (
    <div>
      <button className="linkbtn" onClick={onBack}>{t("sync.back")}</button>
      {loading ? <div className="empty">{t("sync.loading")}</div>
        : !versions.length ? <div className="empty">{t("sync.noHistory")}</div>
        : <div className="sync-list">{versions.map((v) => (
            <div key={v.id} className="version-row">
              <div><div>{new Date(v.createdAt).toLocaleString()}</div><div className="muted mono">{String(v.id).slice(0, 18)}{v.label ? " · " + v.label : ""}</div></div>
              <button className="btn btn-sm" disabled={busy} onClick={() => onRestore(v)}><RotateCcw size={12} />{t("sync.restore")}</button>
            </div>))}</div>}
    </div>
  );
}
