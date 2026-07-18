# AgentPass v1.0.2

Local credential manager that gives AI agents (Claude Code, Codex, …) **scoped,
audited, expiring** access to your servers — instead of pasting long-term secrets
into a chat. Runs entirely on your machine: a local daemon + MCP bridge + desktop app.

## Highlights

- **Checkout over reveal.** `checkout_ssh_access` hands the agent a temporary,
  expiring `ssh` command — no long-term key leaves the vault. `reveal_secret`
  (plaintext) stays available but is the high-risk path, and every call is audited.
- **Agent tokens, two levels.** Give each agent its own token: **Standard**
  (reveal / checkout / list / rotate across all targets — everything an agent
  needs day-to-day) or **Root** (adds `admin`). Scope is enforced before the
  request runs and attributed by identity in the audit log.
- **Reveal approval with separation of duties.** When a credential's policy needs
  approval, the requester can **never** approve its own reveal — the approver must
  be a different identity. Approve from the desktop (Root) while the agent runs on
  its own Standard token.
- **Rotation.** Rotate-after-reveal / after N reveals / on a schedule, with an
  approval-aware manual flow and opt-in auto-rotation.
- **E2E-encrypted sync + encrypted backup.** Cross-device sync over local dir,
  GitHub Gist, WebDAV, or S3 — secrets are encrypted before they ever leave the
  host, with tombstone-based deletion propagation and item-level merge.
- **Local by default.** SQLite storage, AES-256-GCM secret blobs, a 0600 master
  key, and OS-level file ACLs.

## Changes since 1.0.1

- Desktop app now ships as **AgentPass** — installer, application name, and
  install directory use the capitalized product name (previously `agentpass`).
  Your vault is untouched: the config directory (`~/.agentpass`) and bundle
  identifier are unchanged. Note that the Windows/Linux install location and
  menu entry are renamed, so a fresh installer may land beside the old
  `agentpass` app — uninstall the old one if you don't want both.

## Install

Download the installer for your OS from the assets below:

- **Windows** — `.msi` or `.exe`
- **macOS** — `.dmg` (universal: Intel + Apple Silicon)
- **Linux** — `.AppImage` or `.deb`

Then start the daemon and point your agent's MCP config at it (see the README).
In-app updates are delivered through GitHub Releases.

## Notes

Auto-rotation ships **disabled** by default (no gateway yet installs the new
secret on the target); scheduled / after-reveal jobs are created and left for
manual completion. `ssh_agent_socket` checkout mode is not yet implemented — use
`temp_key_file` (the default).
