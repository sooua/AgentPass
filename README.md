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
