import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "zh";
export type Theme = "light" | "dark";

// Flat key dictionaries. English is the fallback for any missing zh key.
const en: Record<string, string> = {
  "brand.sub": "AI agent credential manager",
  "nav.targets": "Targets",
  "nav.credentials": "Credentials",
  "nav.reveals": "Reveal history",
  "nav.checkouts": "Checkout sessions",
  "nav.rotation": "Rotation jobs",
  "nav.requests": "Approvals",
  "nav.audit": "Audit logs",
  "nav.settings": "Settings",

  "common.create": "Create",
  "common.refresh": "Refresh",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.copyFailed": "Copy blocked — select manually",
  "common.approve": "Approve",
  "common.deny": "Deny",
  "common.search": "Search",
  "common.all": "All",
  "common.credentials": "Credentials",
  "common.delete": "Delete",
  "common.revoke": "Revoke",
  "common.cancel": "Cancel",
  "common.done": "Done",
  "common.rotate": "Rotate",
  "common.checkout": "Checkout",
  "common.reveal": "Reveal",
  "common.name": "Name",
  "common.type": "Type",
  "common.status": "Status",
  "common.purpose": "Purpose",
  "common.expires": "Expires",

  "targets.title": "Targets",
  "targets.sub": "Servers, databases and clusters agents can log into.",
  "targets.add": "Add target",
  "targets.environment": "Environment",
  "targets.host": "Host",
  "targets.port": "Port",
  "targets.username": "Username",
  "targets.tags": "Tags (comma separated)",
  "targets.endpoint": "Endpoint",
  "targets.creds": "Creds",
  "targets.empty": "No targets yet.",

  "creds.title": "Credentials",
  "creds.sub": "Encrypted at rest. Secrets never appear in listings or logs.",
  "creds.add": "Add credential",
  "creds.secret": "Secret value",
  "creds.sshHint": "(paste PEM private key)",
  "creds.fakeHint": "use a FAKE secret for demos",
  "creds.reveals": "Reveals",
  "creds.lastRotated": "Last rotated",
  "creds.empty": "No credentials yet.",
  "creds.metadata": "Metadata (JSON, optional)",
  "creds.metadataHint": "e.g. db username, connection hints — stored, never used to log in",
  "quickadd.title": "Quick add server",
  "quickadd.sub": "Create the server and its credential in one step — they're linked automatically.",
  "quickadd.credType": "Credential",
  "quickadd.secret": "Password / private key",
  "quickadd.create": "Add server + credential",

  "reveal.title": "Reveal plaintext secret",
  "reveal.risk": "High risk. The plaintext secret will be exposed to the caller. This action is audited, and per policy may flag the credential for rotation. Prefer Credential Checkout when possible.",
  "reveal.purpose": "Purpose (required, audited)",
  "reveal.purposePh": "e.g. debug prod deploy",
  "reveal.go": "Reveal anyway",
  "reveal.value": "Secret value",
  "reveal.rotationReq": "Rotation required before",
  "reveal.job": "Job",
  "reveal.revealId": "Reveal id",

  "checkout.title": "Checkout SSH access",
  "checkout.risk": "Recommended. Issues temporary, expiring SSH access. No long-term secret is returned to the agent.",
  "checkout.purposePh": "e.g. run migration",
  "checkout.command": "SSH command",
  "checkout.meta": "Checkout",

  "reveals.title": "Reveal history",
  "reveals.sub": "Every plaintext reveal, with purpose and expiry.",
  "reveals.requestedBy": "Requested by",
  "reveals.revealed": "Revealed",
  "reveals.credential": "Credential",
  "reveals.empty": "No reveals yet.",

  "checkouts.title": "Checkout sessions",
  "checkouts.sub": "Temporary access grants. Revoke wipes on-disk artifacts immediately.",
  "checkouts.target": "Target",
  "checkouts.mode": "Mode",
  "checkouts.command": "Command",
  "checkouts.empty": "No checkout sessions.",

  "rotation.title": "Rotation jobs",
  "rotation.sub": "Complete a job with the new secret to reset counters and reactivate.",
  "rotation.reason": "Reason",
  "rotation.created": "Created",
  "rotation.completed": "Completed",
  "rotation.mark": "Mark complete",
  "rotation.prompt": "New secret value (FAKE for demos):",
  "rotation.empty": "No rotation jobs.",

  "audit.title": "Audit logs",
  "audit.sub": "Redacted, append-only. Newest first.",
  "audit.time": "Time",
  "audit.actor": "Actor",
  "audit.action": "Action",
  "audit.resource": "Resource",
  "audit.risk": "Risk",
  "audit.empty": "No audit entries.",

  "settings.title": "Settings",
  "settings.sub": "Local daemon connection. Token is read from ~/.agentpass/token on daemon start.",
  "settings.url": "Daemon URL",
  "settings.token": "Local auth token",
  "settings.tokenPh": "paste from daemon startup log",
  "settings.save": "Save",
  "settings.test": "Test connection",
  "settings.saved": "saved",
  "settings.checking": "checking…",
  "update.title": "Updates",
  "update.sub": "Check for and install new versions.",
  "update.check": "Check for updates",
  "update.checking": "Checking…",
  "update.upToDate": "You're on the latest version.",
  "update.available": "New version available",
  "update.install": "Install & restart",
  "update.installing": "Downloading…",
  "update.webOnly": "Updates are available in the desktop app only.",
  "settings.appearance": "Appearance",
  "settings.language": "Language",
  "settings.theme": "Theme",
  "theme.light": "Light",
  "theme.dark": "Dark",

  "reveal.pending": "This credential requires approval. A request was created — ask an operator to approve it in Approvals, then reveal again.",
  "reveal.autoclear": "Secret auto-clears in",

  "requests.title": "Reveal approvals",
  "requests.sub": "Reveals blocked by policy. Approve or deny each request.",
  "requests.decidedBy": "Decided by",
  "requests.empty": "No reveal requests.",

  "sync.title": "Sync",
  "sync.sub": "Cross-device sync, end-to-end encrypted. The cloud only ever stores ciphertext.",
  "sync.warn": "A passphrase is mandatory — secrets are encrypted with it before leaving this device. Use the SAME passphrase on every device. Lose it and the synced data is unrecoverable.",
  "sync.provider": "Provider",
  "sync.passphrase": "Sync passphrase (E2E)",
  "sync.connect": "Connect",
  "sync.disconnect": "Disconnect",
  "sync.run": "Sync now",
  "sync.auto": "Auto-sync",
  "sync.connected": "Connected",
  "sync.notConnected": "Not connected",
  "sync.dir": "Folder path",
  "sync.token": "GitHub token (PAT)",
  "sync.url": "WebDAV URL",
  "sync.username": "Username",
  "sync.password": "Password",
  "sync.endpoint": "S3 endpoint",
  "sync.region": "Region",
  "sync.bucket": "Bucket",
  "sync.accessKey": "Access key id",
  "sync.secretKey": "Secret access key",
  "sync.prefix": "Prefix (optional)",
  "sync.tabServices": "Cloud services",
  "sync.tabStatus": "Sync status",
  "sync.autoDesc": "Auto-upload after local changes",
  "sync.e2e": "End-to-end encryption",
  "sync.e2eDesc": "Encrypt uploads with a passphrase; the cloud stores ciphertext only (other devices need the same passphrase)",
  "sync.setPass": "Set sync passphrase…",
  "sync.enable": "Enable",
  "sync.history": "History",
  "sync.restore": "Restore",
  "sync.back": "← Back",
  "sync.noHistory": "No history versions.",
  "sync.loading": "Loading…",
  "sync.soon": "Coming soon",
  "sync.notYet": "Planned",
  "sync.localFolder": "Local folder",
  "sync.open": "Sync",
  "sync.account": "Account",
  "sync.lastSync": "Last sync",
  "sync.deviceId": "Device ID",
  "sync.notConnectedAny": "Not connected to any cloud service.",
  "sync.st.idle": "Idle", "sync.st.uptodate": "Up to date", "sync.st.pushed": "Uploaded", "sync.st.pulled": "Pulled", "sync.st.error": "Sync failed",
};

const zh: Record<string, string> = {
  "brand.sub": "AI agent 凭据管家",
  "nav.targets": "目标",
  "nav.credentials": "凭据",
  "nav.reveals": "明文记录",
  "nav.checkouts": "签出会话",
  "nav.rotation": "轮换任务",
  "nav.requests": "审批",
  "nav.audit": "审计日志",
  "nav.settings": "设置",

  "common.create": "创建",
  "common.refresh": "刷新",
  "common.copy": "复制",
  "common.copied": "已复制",
  "common.copyFailed": "复制被拦截 —— 请手动选择",
  "common.approve": "批准",
  "common.deny": "拒绝",
  "common.search": "搜索",
  "common.all": "全部",
  "common.credentials": "凭据",
  "common.delete": "删除",
  "common.revoke": "吊销",
  "common.cancel": "取消",
  "common.done": "完成",
  "common.rotate": "轮换",
  "common.checkout": "签出",
  "common.reveal": "明文",
  "common.name": "名称",
  "common.type": "类型",
  "common.status": "状态",
  "common.purpose": "用途",
  "common.expires": "过期",

  "targets.title": "目标",
  "targets.sub": "agent 可登录的服务器、数据库与集群。",
  "targets.add": "新增目标",
  "targets.environment": "环境",
  "targets.host": "主机",
  "targets.port": "端口",
  "targets.username": "用户名",
  "targets.tags": "标签（逗号分隔）",
  "targets.endpoint": "端点",
  "targets.creds": "凭据数",
  "targets.empty": "暂无目标。",

  "creds.title": "凭据",
  "creds.sub": "静态加密存储。密文不会出现在列表或日志中。",
  "creds.add": "新增凭据",
  "creds.secret": "密钥值",
  "creds.sshHint": "（粘贴 PEM 私钥）",
  "creds.fakeHint": "演示请用假密钥",
  "creds.reveals": "明文次数",
  "creds.lastRotated": "上次轮换",
  "creds.empty": "暂无凭据。",
  "creds.metadata": "元数据（JSON，可选）",
  "creds.metadataHint": "如 DB 用户名、连接提示 —— 仅记录，不用于登录",
  "quickadd.title": "快速添加服务器",
  "quickadd.sub": "一步创建服务器及其凭据 —— 自动关联。",
  "quickadd.credType": "凭据",
  "quickadd.secret": "密码 / 私钥",
  "quickadd.create": "添加服务器 + 凭据",

  "reveal.title": "明文暴露密钥",
  "reveal.risk": "高风险。明文将暴露给调用方。此操作被审计，并可能按策略触发轮换。尽量优先用凭据签出。",
  "reveal.purpose": "用途（必填，会审计）",
  "reveal.purposePh": "例如：排查生产部署",
  "reveal.go": "仍然暴露",
  "reveal.value": "密钥值",
  "reveal.rotationReq": "需在此前轮换",
  "reveal.job": "任务",
  "reveal.revealId": "记录 id",

  "checkout.title": "签出 SSH 访问",
  "checkout.risk": "推荐。签发临时、会过期的 SSH 访问。不向 agent 返回长期密钥。",
  "checkout.purposePh": "例如：执行迁移",
  "checkout.command": "SSH 命令",
  "checkout.meta": "签出",

  "reveals.title": "明文记录",
  "reveals.sub": "每次明文暴露，含用途与过期时间。",
  "reveals.requestedBy": "申请人",
  "reveals.revealed": "暴露时间",
  "reveals.credential": "凭据",
  "reveals.empty": "暂无明文记录。",

  "checkouts.title": "签出会话",
  "checkouts.sub": "临时访问授权。吊销会立即清除落盘文件。",
  "checkouts.target": "目标",
  "checkouts.mode": "模式",
  "checkouts.command": "命令",
  "checkouts.empty": "暂无签出会话。",

  "rotation.title": "轮换任务",
  "rotation.sub": "用新密钥完成任务以重置计数并重新激活凭据。",
  "rotation.reason": "原因",
  "rotation.created": "创建时间",
  "rotation.completed": "完成时间",
  "rotation.mark": "标记完成",
  "rotation.prompt": "新密钥值（演示用假值）：",
  "rotation.empty": "暂无轮换任务。",

  "audit.title": "审计日志",
  "audit.sub": "已脱敏，仅追加。最新在前。",
  "audit.time": "时间",
  "audit.actor": "操作者",
  "audit.action": "动作",
  "audit.resource": "资源",
  "audit.risk": "风险",
  "audit.empty": "暂无审计记录。",

  "settings.title": "设置",
  "settings.sub": "本地 daemon 连接。token 在 daemon 启动时从 ~/.agentpass/token 读取。",
  "settings.url": "Daemon 地址",
  "settings.token": "本地鉴权 token",
  "settings.tokenPh": "从 daemon 启动日志粘贴",
  "settings.save": "保存",
  "settings.test": "测试连接",
  "settings.saved": "已保存",
  "settings.checking": "检测中…",
  "update.title": "更新",
  "update.sub": "检查并安装新版本。",
  "update.check": "检查更新",
  "update.checking": "检查中…",
  "update.upToDate": "已是最新版本。",
  "update.available": "有新版本",
  "update.install": "安装并重启",
  "update.installing": "下载中…",
  "update.webOnly": "在线更新仅桌面版可用。",
  "settings.appearance": "外观",
  "settings.language": "语言",
  "settings.theme": "主题",
  "theme.light": "浅色",
  "theme.dark": "深色",

  "reveal.pending": "该凭据需审批。已创建请求 —— 请管理员在「审批」中批准后再暴露。",
  "reveal.autoclear": "密钥将在此后自动清除",

  "requests.title": "暴露审批",
  "requests.sub": "被策略拦截的明文暴露。逐条批准或拒绝。",
  "requests.decidedBy": "处理人",
  "requests.empty": "暂无暴露请求。",

  "sync.title": "同步",
  "sync.sub": "跨设备同步，端到端加密。云端只存密文。",
  "sync.warn": "口令必填 —— 密钥在离开本机前用它加密。每台设备用同一口令。口令丢失则同步数据不可恢复。",
  "sync.provider": "后端",
  "sync.passphrase": "同步口令（E2E）",
  "sync.connect": "连接",
  "sync.disconnect": "断开",
  "sync.run": "立即同步",
  "sync.auto": "自动同步",
  "sync.connected": "已连接",
  "sync.notConnected": "未连接",
  "sync.dir": "文件夹路径",
  "sync.token": "GitHub 令牌 (PAT)",
  "sync.url": "WebDAV 地址",
  "sync.username": "用户名",
  "sync.password": "密码",
  "sync.endpoint": "S3 端点",
  "sync.region": "区域",
  "sync.bucket": "存储桶",
  "sync.accessKey": "Access Key ID",
  "sync.secretKey": "Secret Access Key",
  "sync.prefix": "前缀（可选）",
  "sync.tabServices": "云服务",
  "sync.tabStatus": "同步状态",
  "sync.autoDesc": "本地改动后自动上传",
  "sync.e2e": "端到端加密",
  "sync.e2eDesc": "用口令加密上传的数据，云端只存密文（其它设备需相同口令）",
  "sync.setPass": "设置同步口令…",
  "sync.enable": "启用",
  "sync.history": "历史版本",
  "sync.restore": "恢复",
  "sync.back": "← 返回",
  "sync.noHistory": "暂无历史版本。",
  "sync.loading": "加载中…",
  "sync.soon": "即将支持",
  "sync.notYet": "后续支持",
  "sync.localFolder": "本地文件夹",
  "sync.open": "同步",
  "sync.account": "账号",
  "sync.lastSync": "上次同步",
  "sync.deviceId": "设备 ID",
  "sync.notConnectedAny": "尚未连接任何云服务。",
  "sync.st.idle": "待同步", "sync.st.uptodate": "已是最新", "sync.st.pushed": "已上传", "sync.st.pulled": "已拉取", "sync.st.error": "同步失败",
};

const dicts: Record<Lang, Record<string, string>> = { en, zh };

interface Prefs {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  t: (key: string) => string;
}

const PrefsCtx = createContext<Prefs | null>(null);

const initialTheme = (): Theme => {
  const saved = localStorage.getItem("agentpass.theme") as Theme | null;
  if (saved) return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
const initialLang = (): Lang => {
  const saved = localStorage.getItem("agentpass.lang") as Lang | null;
  if (saved) return saved;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
};

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setLang = (l: Lang) => {
    localStorage.setItem("agentpass.lang", l);
    setLangState(l);
  };
  const setTheme = (t: Theme) => {
    localStorage.setItem("agentpass.theme", t);
    setThemeState(t);
  };
  const t = (key: string) => dicts[lang][key] ?? en[key] ?? key;

  return <PrefsCtx.Provider value={{ lang, theme, setLang, setTheme, t }}>{children}</PrefsCtx.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsCtx);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
