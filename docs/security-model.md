# Security Model

## Design stance

agentpass **intentionally supports plaintext secret reveal**. This is a product
capability, not an oversight. We do not pretend the risk away — we make it
explicit, audited, and rotation-aware.

- `reveal_secret` is a **high-risk** operation. In `prod` it is logged as
  `critical`.
- After a reveal, rotation is **recommended by default** (`rotate_after_reveal`).
- **Checkout is the recommended path**: temporary, expiring access with no
  long-term secret handed to the agent.
- **Every** reveal and checkout is written to the append-only audit log.

## Secret handling rules (enforced in code)

- Secrets are AES-256-GCM encrypted at rest (`LocalEncryptedStoreProvider`).
- Metadata entities never carry plaintext — only an opaque `secret_ref`.
- Plaintext exists only transiently: during `putSecret`, `revealSecret`, and
  while materializing a checkout. It is never persisted in metadata.
- All logging goes through a **redaction-aware logger** (`redact()` in
  `packages/core/src/logger.ts`) that masks any key matching
  `secret|password|token|private_key|api_key|kubeconfig|secret_value`.
- Secrets are **not** placed in error messages or stack traces: the daemon error
  handler returns generic messages and logs only redacted context server-side.
- Business/audit logs never contain secret material. The **only** place plaintext
  legitimately surfaces is the direct `reveal_secret` response (and the MCP tool
  result that carries it back to the agent).

## Local API auth

- The daemon binds `127.0.0.1` by default.
- Every route except `GET /health` and static UI requires
  `Authorization: Bearer <token>`.
- The token is generated on first run and stored at `~/.agentpass/token` (0600).
  Override with `AGENTPASS_TOKEN`.

## Master key

- 32-byte key at `~/.agentpass/master.key` (0600), created on first run.
- **ponytail / upgrade path:** move the key into the OS keychain
  (`SystemKeychainProvider`) or a KMS-backed `KeyProvider`, or delegate secret
  storage to OpenBao/Infisical entirely. The port already exists.

## Threat notes / non-goals (MVP)

- No multi-user auth, RBAC, or approval workflow yet (`approval_required` is a
  policy flag reserved for later).
- Windows file permissions: `0600`/`0700` are best-effort; on Windows the ACL
  model differs. Treat `~/.agentpass` as a protected directory.
- No network egress except the local daemon. No telemetry.
- We never implement SSH ourselves — we prepare inputs for the system OpenSSH
  client. We never implement crypto primitives ourselves — Node `crypto` only.

## Rotation as a safety mechanism

Reveal count and policy drive rotation. A revealed secret is considered
potentially compromised; `markRotationSuccess` replaces the material, resets the
counter, reactivates the credential, and marks any still-active reveal as
`rotated`.
