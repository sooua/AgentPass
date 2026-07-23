# MCP Tools

`apps/mcp-server` exposes these tools to Claude Code over stdio. It reads
`AGENTPASS_URL` (default `http://127.0.0.1:4747`) and `AGENTPASS_TOKEN`
(or `~/.agentpass/token`) and forwards authenticated calls to the daemon.

| Tool | Inputs | Purpose |
|------|--------|---------|
| `list_targets` | — | List targets |
| `get_target` | `target_id` | One target |
| `search_targets` | `q?, environment?, type?, tag?, limit?` | Filtered target search (token-cheaper than list) |
| `set_target_credentials` | `target_id, credential_ids` | Link credentials so a target can be checked out |
| `list_credentials` | — | Credential metadata (no secrets) |
| `list_reveal_requests` | — | Pending/decided reveal approvals |
| `approve_reveal_request` | `request_id` | Approve *another* identity's gated reveal (self-approval → 403); then reveal again with `approval_id` |
| `reveal_secret` | `credential_id, purpose, requested_by, ttl_seconds?, target_id?` | **HIGH RISK** plaintext reveal |
| `checkout_ssh_access` | `target_id, purpose, requested_by, ttl_seconds?, mode?, credential_id?` | **Recommended** temporary SSH access |
| `revoke_checkout` | `checkout_id` | Revoke + wipe artifacts |
| `get_checkout_status` | `checkout_id` | One checkout |
| `list_active_checkouts` | — | Active checkouts |
| `get_rotation_status` | `credential_id` | Rotation state + jobs |
| `schedule_rotation` | `credential_id, reason?, target_id?` | Create rotation job |
| `mark_rotation_complete` | `rotation_job_id, new_secret_value, new_secret_version?` | Complete rotation |
| `list_audit_logs` | `limit?` | Recent audit entries |
| `create_agent_token` | `name, capabilities, environments?, target_tags?, target_ids?, expires_at?` | **ADMIN** — mint a scoped token; plaintext returned once |
| `list_agent_tokens` | — | **ADMIN** — scoped tokens (metadata only) |
| `revoke_agent_token` | `token_id` | **ADMIN** — revoke a scoped token |

The three `*_agent_token` tools require an admin/root token; a non-admin scoped
token calling them gets `403 forbidden`. See [security-model.md](./security-model.md#scoped-agent-tokens-b3).

## `reveal_secret` behavior
- Returns `secret_value` (plaintext) plus `rotation_required`, `rotate_before`, `reveal_id`, `rotation_job_id`.
- Writes an audit log entry (`reveal_secret`).
- If the credential's policy has `rotate_after_reveal=true` (or the reveal count
  crosses `max_reveals_before_rotation`), sets credential `status=rotation_required`
  and creates a `RotationJob(reason=after_reveal)`.

## `checkout_ssh_access` behavior
- `mode=temp_key_file` (only value the MCP tool accepts) writes a 0600 key +
  `ssh_config`, returns `ssh_command` and `expires_at`. `ssh_agent_socket` is a
  daemon-side stub, not offered by the MCP tool until implemented.
- TTL controls key-file lifetime, not live SSH connections: an already-open
  session survives expiry. Password credentials feed the password to the system
  ssh through `SSH_ASKPASS` (no `sshpass`, which has no Windows build); the
  command carries the env vars, so run it in a POSIX shell.
- Writes an audit log entry (`checkout_ssh_access`). Does **not** return a
  long-term secret — use `reveal_secret` for that.

## Register with Claude Code
`~/.claude.json` (or project `.mcp.json`):
```json
{
  "mcpServers": {
    "agentpass": {
      "command": "node",
      "args": ["D:/dev/Owner/agentpass/apps/mcp-server/dist/index.js"],
      "env": { "AGENTPASS_URL": "http://127.0.0.1:4747" }
    }
  }
}
```
The daemon must be running first (the MCP server reads its token file). Launching
the desktop app is enough — it starts the bundled daemon itself; `pnpm daemon`
does the same from a source checkout.
