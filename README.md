<div align="center">

<img src="brand/logo/agentpass-terracotta.svg" alt="AgentPass" width="360" />

### Your servers' keys, kept for your coding agent.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

**AgentPass** is an MCP server that remembers how to log into your machines, so
you can tell Claude Code *"restart nginx on my vps"* and it just happens — without
your root password living in a chat log, a shell history, or a config file in
plaintext.

One process. No daemon, no database, no UI.

```
you → "add my vps, 23.x.x.x, root, <password>"     → add_host
you → "check the disk on my vps"                   → run
                                                     ↓
                                    ~/.agentpass/hosts.json   AES-256-GCM
                                    ~/.agentpass/master.key   0600
```

The secret is decrypted for the length of one login, written to a 0700 directory
that is wiped afterwards, and handed to the system `ssh` client — never to the
agent, and never into the conversation. `get_secret` exists for the times you
genuinely need the plaintext; it says so, and it is logged.

## Install

Needs [Node.js](https://nodejs.org) 22+ and an `ssh` client (on Windows: Git Bash,
which every Git for Windows install ships).

```bash
git clone https://github.com/sooua/AgentPass.git
cd AgentPass && pnpm install && pnpm build

claude mcp add agentpass -- node "$PWD/dist/index.js"
```

That is the whole setup. There is no token to mint and no service to start.

## Use

Talk to your agent:

> Remember my VPS: 23.238.1.51, user root, password …

> What's the uptime on my vps?

> Give me an ssh command for my vps, I want to poke around myself.

## Tools

| Tool | What it does |
|------|--------------|
| `add_host` | Store a machine + password or private key. Encrypted at rest. |
| `list_hosts` | What you have stored. Never includes secrets. |
| `remove_host` | Forget one. |
| `run` | Log in, run one command, return the output, wipe the login files. |
| `ssh_access` | Return a ready-to-run `ssh` command instead, for interactive work. |
| `get_secret` | Plaintext, when you really need it. Logged, with a reason. |

Hosts are addressed by the name you gave them, case-insensitively — `my vps`
finds `My VPS`.

## What's on disk

```
~/.agentpass/
  hosts.json     your machines; every secret AES-256-GCM encrypted
  master.key     32 random bytes, 0600 (+ Windows ACL)
  audit.jsonl    one line per action, secrets never in it
  access/        live logins; each wiped on TTL, on exit, and at next startup
```

Nothing leaves your machine. No account, no telemetry, no network calls except
the SSH connection you asked for.

## Honest limits

- **The agent can run anything you can.** `run` is a shell on your server. That is
  the point, and it is also the risk — the audit log tells you what it did, and
  your agent's own tool-approval gate is what stops it beforehand.
- **Whoever can read your user account can read the vault.** The master key sits
  next to the data at 0600, exactly like `~/.ssh/id_rsa`. This protects against a
  secret leaking through a chat transcript, not against someone already logged in
  as you.
- **`get_secret` puts plaintext in the conversation.** Once there, it is in the
  model's context and your transcript. Prefer `run` and `ssh_access`.
- **Password auth needs OpenSSH 8.4+** (for `SSH_ASKPASS_REQUIRE`) and, on
  Windows, Git Bash — the stock `ssh.exe` cannot launch the askpass helper.

## History

Versions 1.x were a bigger thing: a local daemon, an HTTP API, a Tauri desktop
app, scoped agent tokens, approval workflows with separation of duties, rotation
policies, and end-to-end encrypted sync. All of it worked; almost none of it
mattered for one person with a handful of servers. It is preserved in the git
history and in the [v1.0.3 release](https://github.com/sooua/AgentPass/releases/tag/v1.0.3)
if you need a multi-user vault.

## License

[MIT](LICENSE) © 2026 sooua
