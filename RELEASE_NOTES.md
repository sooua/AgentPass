# AgentPass v1.0.3

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

## Changes since 1.0.2

- **The app now starts its own daemon.** Up to 1.0.2 the installer shipped only
  the UI, so a fresh install had no daemon to talk to and every action failed
  with `Failed to fetch` until you started one from a terminal. The daemon is now
  bundled into the installer and launched on startup. If one is already listening
  (`pnpm daemon`, or a second window), the app attaches to it instead of starting
  a duplicate, and it shuts down the daemon it started when you quit.
- **Requires Node.js 22.5 or newer.** The bundled daemon runs on your system
  Node — the same interpreter the MCP server already uses.
- **Startup failures are legible.** No Node on PATH, or a daemon that starts and
  dies, now shows the reason (and the tail of `~/.agentpass/daemon.log`) in a
  banner instead of a bare `Failed to fetch` on whatever form you were filling in.

## Install

Download the installer for your OS from the assets below:

- **Windows** — `.msi` or `.exe`
- **macOS** — `.dmg` (universal: Intel + Apple Silicon)
- **Linux** — `.AppImage` or `.deb`

Install [Node.js](https://nodejs.org) 22.5+ if you don't have it, then launch the
app and point your agent's MCP config at it (see the README). In-app updates are
delivered through GitHub Releases.

## Notes

Auto-rotation ships **disabled** by default (no gateway yet installs the new
secret on the target); scheduled / after-reveal jobs are created and left for
manual completion. `ssh_agent_socket` checkout mode is not yet implemented — use
`temp_key_file` (the default).
