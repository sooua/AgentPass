# agentpass

Local-first credential manager for AI agents (Claude Code, Codex, Cursor Agent).
It lets agents obtain server login info two ways:

- **Direct Secret Access** (`reveal_secret`) — plaintext, high-risk, audited,
  rotation-aware. Fully supported.
- **Agent Credential Checkout** (`checkout_ssh_access`) — temporary, expiring
  SSH access, no long-term secret handed to the agent. **Recommended.**

Manages, audits, and rotates SSH keys, passwords, API tokens, kubeconfigs and DB
credentials. Local-only daemon, encrypted at rest, redacted logs, adapter-first
so OpenBao / Infisical / Warpgate / JumpServer can be dropped in later.

> ⚠️ This tool **intentionally** supports revealing plaintext secrets to agents.
> That is a deliberate product capability — see [docs/security-model.md](docs/security-model.md).

## Stack
pnpm workspace · TypeScript (ESM) · Fastify daemon · MCP TS SDK · `node:sqlite` ·
Node `crypto` (AES-256-GCM) · Tauri 2 + React/Vite desktop · Vitest.

## Layout
```
apps/
  daemon/       Fastify local API (127.0.0.1, Bearer token)
  mcp-server/   MCP stdio server → HTTP bridge (12 tools)
  desktop/      Tauri 2 + React/Vite UI (also runs as plain web app)
packages/
  shared/               domain model + zod schemas
  core/                 AgentPassCore + provider ports + redaction logger
  storage-sqlite/       Repository + SecretBlobStore (node:sqlite)
  credential-providers/ LocalEncryptedStoreProvider (+ OpenBao/Infisical/keychain stubs)
  checkout-providers/   TempKeyFileCheckoutProvider (+ ssh-agent stub)
  rotation-providers/   auto-rotation stubs (manual flow lives in core)
  gateway-adapters/     Warpgate/JumpServer stubs
docs/    architecture, security-model, api, mcp-tools, rotation-model, open-source-reuse
docker/  docker-compose.dev.yml (optional future backends)
```

## Quick start
```bash
pnpm install
pnpm build          # tsc -b (typecheck + emit)
pnpm test           # vitest

# 1) start the daemon (prints its URL + local token)
pnpm daemon
#    → {"msg":"agentpass daemon listening","url":"http://127.0.0.1:4747","token":"...","home":"~/.agentpass"}

# 2) (optional) start the MCP server for Claude Code — reads ~/.agentpass/token
pnpm mcp

# 3) (optional) desktop UI
pnpm ui:dev         # web app at http://localhost:5273 (open Settings → paste token)
pnpm tauri:dev      # native Tauri 2 window (needs Rust; run `pnpm --filter @agentpass/desktop exec tauri icon <png>` once)
```
Dev without building first: `pnpm daemon:dev` (tsx watch).
If `4747` is blocked (`EACCES` — some Windows setups reserve it), set
`AGENTPASS_PORT=17470` (and matching `AGENTPASS_URL` for the MCP server / UI).

## For AI agents (Claude Code / Codex)

Agents reach agentpass through the **MCP server** — they never touch key files
directly. Prereqs: the daemon is running, and your targets + credentials exist
(create them in the desktop app's *Quick add server* form, which links a target
to its credential in one step).

**1. Register the MCP server**

Claude Code — `~/.claude.json` or a project `.mcp.json`:
```json
{
  "mcpServers": {
    "agentpass": {
      "command": "node",
      "args": ["/abs/path/to/agentpass/apps/mcp-server/dist/index.js"],
      "env": { "AGENTPASS_URL": "http://127.0.0.1:17470" }
    }
  }
}
```
Or: `claude mcp add agentpass -e AGENTPASS_URL=http://127.0.0.1:17470 -- node /abs/path/to/agentpass/apps/mcp-server/dist/index.js`

Codex — add the same entry under `mcp_servers` in your Codex config (`command` /
`args` / `env` identical).

The token is read automatically from `~/.agentpass/token` — don't put it in the
config. **`AGENTPASS_URL` must match the daemon's port** (use `17470` if `4747`
is blocked on your machine). Build the server first: `pnpm build`.

**2. Tools exposed** (16)
```
list_targets · search_targets · get_target · set_target_credentials
list_credentials · reveal_secret · list_reveal_requests · approve_reveal_request
checkout_ssh_access · revoke_checkout · get_checkout_status · list_active_checkouts
get_rotation_status · schedule_rotation · mark_rotation_complete · list_audit_logs
```

**3. Typical flow** — "log into a VPS and deploy". Just tell Claude Code:
> Use agentpass to check out SSH access to web-01, then run the deploy.

Under the hood it calls:
1. `search_targets({ q: "web" })` → finds `web-01`
2. `checkout_ssh_access({ target_id, purpose: "deploy", requested_by: "claude-code", ttl_seconds: 900 })`
   → returns `ssh -F /tmp/.../config web-01`
3. runs that command in its shell → logged in. Temp key, auto-expires (15 min), audited.
4. `revoke_checkout` to end early (optional).

**Two modes** (the tool descriptions steer agents to the safe one):
- **`checkout_ssh_access`** — *recommended.* Temporary, expiring SSH access; no
  long-term secret handed to the agent.
- **`reveal_secret`** — *high risk.* Returns plaintext (password / token /
  kubeconfig). Audited; may flag rotation. If policy requires approval it returns
  `403 approval_required` → approve it in the app's **Approvals** page → the agent
  retries with the `approval_id`.

Gotchas: `checkout_ssh_access` needs the target to have a linked
`ssh_private_key` credential (set it in the UI or via `set_target_credentials`);
password checkout returns an `sshpass`-based command (install `sshpass`); if the
daemon is down the tools return a clear "daemon unreachable — start it" error.

**Scoped tokens (limit an agent's blast radius).** By default an agent uses the
full-power root token (`~/.agentpass/token`). To give a *specific* agent only
part of the surface, mint a **scoped token** and hand it to that agent via
`AGENTPASS_TOKEN` in its MCP `env` (overrides the root token for that process):

```bash
TOKEN=$(cat ~/.agentpass/token); H="Authorization: Bearer $TOKEN"; U=http://127.0.0.1:17470
# a token that may only check out / list, only in dev, only on #web targets:
curl -s -XPOST $U/agent-tokens -H "$H" -H 'content-type: application/json' -d '{
  "name":"claude-dev","capabilities":["checkout","list"],
  "environments":["dev"],"target_tags":["web"]
}' | jq -r .token        # apat_… — shown ONCE, store it now
```
Then in `.mcp.json` set `"env": { "AGENTPASS_URL": "…", "AGENTPASS_TOKEN": "apat_…" }`.
That agent now gets **403 forbidden** if it tries `reveal_secret`, touches a
`prod` target, or manages tokens — and every audit entry is attributed to
`claude-dev`, not a self-reported name. Capabilities: `reveal` · `checkout` ·
`list` · `rotate` · `admin` (token management + CRUD). Empty `environments` /
`target_tags` / `target_ids` = no restriction. Optional `expires_at` (ISO) for a
TTL. Create/list/revoke in the desktop app's **Settings → Agent tokens**, or via
`GET /agent-tokens` and `POST /agent-tokens/:id/revoke`. See
[docs/security-model.md](docs/security-model.md#scoped-agent-tokens-b3).

## Demo flow (matches acceptance criteria)
```bash
TOKEN=$(cat ~/.agentpass/token); H="Authorization: Bearer $TOKEN"; U=http://127.0.0.1:4747

curl -s $U/health                                                    # {"status":"ok",...}

# create a rotate-after-reveal policy
POL=$(curl -s -XPOST $U/rotation-policies -H "$H" -H 'content-type: application/json' \
  -d '{"name":"rotate-on-reveal","rotate_after_reveal":true}' | jq -r .id)

# create a password credential (FAKE secret) using that policy
CRED=$(curl -s -XPOST $U/credentials -H "$H" -H 'content-type: application/json' \
  -d "{\"name\":\"db-pw\",\"type\":\"password\",\"secret_value\":\"FAKE-pw\",\"rotation_policy_id\":\"$POL\"}" | jq -r .id)

# reveal → returns plaintext + rotation_required + rotation_job_id, writes audit
curl -s -XPOST $U/credentials/$CRED/reveal -H "$H" -H 'content-type: application/json' \
  -d '{"requested_by":"claude-code","purpose":"debug","ttl_seconds":300}' | jq

# ssh key credential + target, then checkout → ssh_command
KEY=$(curl -s -XPOST $U/credentials -H "$H" -H 'content-type: application/json' \
  -d '{"name":"vps-key","type":"ssh_private_key","secret_value":"-----BEGIN FAKE KEY-----\nx\n-----END FAKE KEY-----"}' | jq -r .id)
TGT=$(curl -s -XPOST $U/targets -H "$H" -H 'content-type: application/json' \
  -d "{\"name\":\"web-01\",\"type\":\"ssh\",\"host\":\"10.0.0.5\",\"port\":22,\"username\":\"deploy\",\"credential_ids\":[\"$KEY\"]}" | jq -r .id)
CHK=$(curl -s -XPOST $U/targets/$TGT/checkout -H "$H" -H 'content-type: application/json' \
  -d '{"requested_by":"agent","purpose":"deploy","ttl_seconds":900,"mode":"temp_key_file"}')
echo $CHK | jq                                                       # {ssh_command:"ssh -F ... web-01", ...}
curl -s -XPOST $U/checkouts/$(echo $CHK | jq -r .checkout_id)/revoke -H "$H" | jq  # wipes temp key

curl -s "$U/audit-logs?limit=20" -H "$H" | jq                        # redacted trail
```

## Config (env)
`AGENTPASS_HOME` (default `~/.agentpass`) · `AGENTPASS_PORT` (4747) ·
`AGENTPASS_HOST` (127.0.0.1) · `AGENTPASS_TOKEN` · `AGENTPASS_UI_DIR`
(serve built UI from the daemon at `/ui`) · `AGENTPASS_LOG_LEVEL`.

## Security
Never commit real secrets; tests use fake values. See
[docs/security-model.md](docs/security-model.md). Data + master key live under
`~/.agentpass` (gitignored).
