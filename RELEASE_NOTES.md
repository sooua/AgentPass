# agentpass v1.0.0

Local credential manager that gives AI agents (Claude Code, Codex, …) **scoped,
audited, expiring** access to your servers — instead of pasting long-term secrets
into a chat. Runs entirely on your machine: a local daemon + MCP bridge + desktop app.

## Highlights

- **Checkout over reveal.** `checkout_ssh_access` hands the agent a temporary,
  expiring `ssh` command — no long-term key leaves the vault. `reveal_secret`
  (plaintext) stays available but is the high-risk path, and every call is audited.
- **Scoped agent tokens.** Give each agent its own token limited by capability,
  environment, and target — enforced before the request runs, attributed by
  identity in the audit log. One-click **"Recommended agent token"** preset in the
  desktop app (full operational power, no `admin`).
- **Reveal approval with separation of duties.** When a credential's policy needs
  approval, the requester can **never** approve its own reveal — the approver must
  be a different identity. Approve from the desktop (root) while the agent runs on
  its own scoped token.
- **Rotation.** Rotate-after-reveal / after N reveals / on a schedule, with an
  approval-aware manual flow and opt-in auto-rotation.
- **E2E-encrypted sync + encrypted backup.** Cross-device sync over local dir,
  GitHub Gist, WebDAV, or S3 — secrets are encrypted before they ever leave the
  host, with tombstone-based deletion propagation and item-level merge.
- **Local by default.** SQLite storage, AES-256-GCM secret blobs, a 0600 master
  key, and OS-level file ACLs.

## Install

Download the installer for your OS from the assets below:

- **Windows** — `.msi` or `.exe`
- **macOS** — `.dmg` (universal: Intel + Apple Silicon)
- **Linux** — `.AppImage` or `.deb`

Then start the daemon and point your agent's MCP config at it (see the README).
In-app updates are delivered through GitHub Releases.

## Notes

First stable release. Auto-rotation ships **disabled** by default (no gateway yet
installs the new secret on the target); scheduled/after-reveal jobs are created
and left for manual completion. `ssh_agent_socket` checkout mode is not yet
implemented — use `temp_key_file` (the default).
