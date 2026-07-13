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

## Scoped agent tokens (B3)

The root token above is **all-powerful**. To limit an individual agent's blast
radius, mint additional **scoped tokens** that layer on top of it — the root
token is unchanged and always full-power (back-compat).

A scoped token (`AgentToken`) binds a human-named agent to a scope:

- **capabilities** — any of `reveal` · `checkout` · `list` · `rotate` · `admin`
  (`admin` = manage tokens + create/update/delete targets & credentials).
- **environments** — whitelist of `dev|staging|prod`; empty = all.
- **target_tags** / **target_ids** — whitelist of targets; both empty = all.
- **expires_at** — optional ISO TTL.

Authorization is enforced **at the API boundary** (`apps/daemon/src/server.ts`),
not deep in business logic:

1. The `onRequest` hook resolves the bearer token. Root token → full pass. Else
   it looks the token up by **sha256 hash** (plaintext is never stored — only
   returned once at creation), rejecting unknown/revoked/expired tokens with
   `401`.
2. Each route declares a required capability (`ROUTE_CAP`). Unlisted routes
   default to `admin` — deny-by-default, safe because only opt-in scoped tokens
   are constrained. A capability miss returns
   `403 {code:"forbidden", message:"token not allowed to <cap> <env>"}`.
3. `reveal`/`checkout` additionally check the **target's** environment and tags
   against the token's whitelist. An env-restricted token must pass a `target_id`
   on reveal so the environment can actually be verified.

**Audit attribution** no longer trusts the self-reported `requested_by`: reveal
and checkout record the **token's bound agent name** as the audit `actor` (root =
`"root"`). `requested_by` is retained as caller-supplied context only.

Tokens are **device-local** (like `secret_ref`s and the master key) and are
**not** synced — the hash is local auth material. Manage them in the desktop app
(**Settings → Agent tokens**) or via `POST /agent-tokens`, `GET /agent-tokens`
(metadata only, never the hash), `POST /agent-tokens/:id/revoke`.

> Unlike the approval gate below, this **is** an enforcement boundary: a scoped
> token physically cannot exceed its capabilities/environments/targets, because
> the check runs before the handler and rejects the request. It does not yet
> solve independent approval (see below) — an `admin` scoped token can still
> self-approve — but a non-`admin` agent token cannot approve at all.

## Master key

- 32-byte key at `~/.agentpass/master.key` (0600), created on first run.
- **ponytail / upgrade path:** move the key into the OS keychain
  (`SystemKeychainProvider`) or a KMS-backed `KeyProvider`, or delegate secret
  storage to OpenBao/Infisical entirely. The port already exists.

## Reveal approval gate

When a credential's policy sets `approval_required`, `reveal_secret` is blocked:
it opens a pending `RevealRequest` and returns `403 approval_required` with the
request id. An operator approves it (UI Approvals page / `POST
/reveal-requests/:id/approve` / MCP `approve_reveal_request`), then the caller
retries `reveal` with `approval_id` (single-use). To avoid request spam, a
second blocked reveal for the same (credential, requester) reuses the existing
pending request instead of creating a new one.

> ⚠️ **This is a workflow speed-bump, NOT a security boundary in the MVP.** The
> approve endpoint is protected by the *same* single local token as `reveal`. An
> agent that can call `reveal_secret` therefore also holds the token needed to
> call `approve` and can self-approve. The gate only stops a caller that doesn't
> know the approve step; it does not stop a compromised/confused agent that has
> the token. Real enforcement needs an **independent approver credential** (a
> second token, or approval restricted to an authenticated human UI session) —
> tracked as a follow-up. Treat `approval_required` today as "make the reveal
> deliberate + auditable," not "gate the agent out."

## File permissions

Master key and temp checkout keys are locked to the current user via
`secureLocalFile`: POSIX `chmod 0600/0700`, and on Windows `icacls
/inheritance:r /grant:r <user>:F` (chmod alone is a no-op on Windows). Both are
best-effort and logged nowhere.

## Threat notes / non-goals (MVP)

- No multi-user auth yet. Scoped agent tokens (B3) give per-agent capability +
  environment + target authorization — a capability model, not user identities.
  `approval_required` remains a single-operator gate, not a role model.
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
