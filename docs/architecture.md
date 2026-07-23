# Architecture

## Overview

agentpass is a local-first desktop product that lets AI agents (Claude Code,
Codex, Cursor Agent, …) obtain server credentials in two modes:

1. **Direct Secret Access** (`reveal_secret`) — returns plaintext. High risk,
   fully supported, audited, rotation-aware.
2. **Agent Credential Checkout** (`checkout_ssh_access`) — issues temporary,
   expiring SSH access with no long-term secret handed to the agent. Recommended.

## Components

```
 Claude Code / agent
        │  (MCP stdio)
        ▼
 apps/mcp-server      thin MCP↔HTTP bridge, exposes 12 tools
        │  (HTTP + Bearer token, 127.0.0.1)
        ▼
 apps/daemon          Fastify API, local-only bind, token auth
        │
        ▼
 packages/core        AgentPassCore — all business logic, provider ports
        ├── packages/storage-sqlite         Repository + SecretBlobStore (node:sqlite)
        ├── packages/credential-providers   LocalEncryptedStoreProvider (AES-256-GCM) + stubs
        ├── packages/checkout-providers     TempKeyFileCheckoutProvider (+ ssh-agent stub)
        ├── packages/rotation-providers     manual flow in core; auto stubs
        └── packages/gateway-adapters       Warpgate/JumpServer stubs

 apps/desktop         Tauri 2 + React/Vite UI (also runs as plain web app)
```

## Ports / adapters

Every external capability sits behind an interface in `packages/core/src/ports.ts`
so it can be swapped without touching business logic:

- `CredentialStoreProvider` / `SecretRevealProvider` (`CredentialBackend`)
- `CheckoutProvider`
- `RotationProvider`
- `GatewayProvider`
- `Repository`, `SecretBlobStore`

The MVP ships one real implementation per port plus throwing stubs for the
future OpenBao / Infisical / Warpgate / JumpServer integrations.

## Data flow — reveal

1. Agent → `reveal_secret` (MCP) → daemon `POST /credentials/:id/reveal`.
2. Core loads credential metadata + rotation policy.
3. `CredentialBackend.revealSecret` decrypts the ciphertext blob.
4. Core writes a `SecretReveal`, bumps `reveal_count_since_rotation`, and —
   if policy requires — sets status `rotation_required` and creates a
   `RotationJob (reason=after_reveal)`.
5. Core writes an `AuditLog` (redacted) and returns plaintext + rotation info.

## Data flow — checkout

1. Agent → `checkout_ssh_access` → daemon `POST /targets/:id/checkout`.
2. Core picks an ssh_private_key credential, reveals it **into the daemon only**.
3. `CheckoutProvider.create` writes a 0600 key + throwaway `ssh_config` in a
   per-checkout dir and returns `ssh -F <cfg> <alias>`.
4. Core records a `CheckoutSession` with an expiry; a 30s sweep + startup scan
   wipe expired artifacts. `revoke` wipes immediately.

## Why a daemon + MCP split

The daemon is the single source of truth and the only holder of the master key.
The MCP server is stateless and just forwards authenticated calls, so the same
API also backs the desktop UI and any future CLI.

## How the desktop app starts the daemon

`apps/daemon/build.mjs` esbuild-bundles the daemon into a single
`apps/desktop/src-tauri/resources/daemon.mjs`, shipped as a Tauri resource. On
launch the Rust shell checks `127.0.0.1:$AGENTPASS_PORT`; if nothing answers it
spawns `node <resource>` and kills that child on exit. A daemon started by hand
(`pnpm daemon`) wins — the app attaches to it rather than starting a second.

A bundle plus the system Node is enough because the daemon has no native
dependencies: SQLite comes from the `node:sqlite` builtin, which is why Node
22.5+ is the install requirement. stdout is discarded (it carries the daemon
token); stderr goes to `~/.agentpass/daemon.log`. Startup failures — no Node on
PATH above all — surface in the UI through the `daemon_error` command.
