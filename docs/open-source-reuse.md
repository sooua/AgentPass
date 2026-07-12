# Open-Source Reuse

## What the MVP builds itself (minimal, on purpose)
- **Local encrypted store** — Node `crypto` AES-256-GCM over `node:sqlite` blobs.
  Just enough to hold secrets locally; not a vault.
- **Metadata + audit store** — `node:sqlite` (built-in, no native build).
- **Temp-key-file checkout** — writes a 0600 key + `ssh_config` for the system
  OpenSSH client. We do **not** implement SSH.
- **Rotation lifecycle** — manual flow (jobs + mark-complete) in `core`.
- **Local daemon API + MCP bridge** — Fastify + MCP TS SDK.

We deliberately **did not** build: a real vault, a bastion/PAM, an SSH stack, or
a crypto library. Those are solved by mature projects below.

## Where to plug mature projects later

| Capability | Project | Port to implement | Notes |
|-----------|---------|-------------------|-------|
| Production secret backend | **OpenBao** | `CredentialBackend` (`OpenBaoProvider`) | KV v2; leases/dynamic secrets; audit devices |
| Dev-friendly secret backend | **Infisical** | `CredentialBackend` (`InfisicalProvider`) | Projects/envs; nice UX; SDK available |
| SSH/DB/K8s connection gateway | **Warpgate** | `GatewayProvider` (`WarpgateGatewayProvider`) | Session recording; no creds to agent at all |
| Full PAM / bastion | **JumpServer** | `GatewayProvider` (`JumpServerGatewayProvider`) | Reference for enterprise PAM feature set |
| Desktop-local secret storage | **OS keychain** (Credential Manager / macOS Keychain / Secret Service) | `CredentialBackend` (`SystemKeychainProvider`) or a `KeyProvider` for the master key | Removes plaintext master key from disk |

## Why not fork a big project in phase 1
- Adapter-first keeps the product model (targets, reveal, checkout, rotation,
  audit) independent of any one backend, so we can A/B OpenBao vs Infisical vs
  keychain without rewrites.
- Forking OpenBao/JumpServer now would couple us to their data models and
  release cadence before the product shape is proven.
- A thin local MVP is demoable today and validates the two-mode thesis
  (reveal vs checkout) before taking on operational weight.

## License risk — TODO before any commercialization (legal must confirm)
- **OpenBao** — MPL-2.0. `TODO(legal)` confirm distribution/linking terms.
- **Infisical** — mixed (MIT core + commercial features). `TODO(legal)` verify.
- **Warpgate** — Apache-2.0 / possible ELv2 components. `TODO(legal)` verify.
- **JumpServer** — GPLv3. `TODO(legal)` GPL implications if bundled/distributed.
- **OpenSSH** — BSD-style. Invoked as an external binary, not linked.
- **keytar / node-keytar** — MIT (archived; evaluate maintained forks). `TODO(legal)`.

None of these are bundled in the MVP — only interface stubs + this documentation.
