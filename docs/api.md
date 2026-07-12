# Daemon HTTP API

Base URL: `http://127.0.0.1:4747` · Auth: `Authorization: Bearer <token>`
(from `~/.agentpass/token`, printed at daemon startup). All bodies are JSON.

## Health
- `GET /health` → `{ status, service, version, stats:{ targets, credentials, credentials_rotation_required, active_checkouts, active_reveals, pending_rotation_jobs, pending_reveal_requests } }` (no auth)

## Targets
- `GET /targets?q=&environment=&type=&tag=&limit=&offset=` → `{ targets: Target[] }` (all filters optional)
- `POST /targets` `{ name, type, host, port, username, tags?, environment?, credential_ids? }` → `201 Target`
- `GET /targets/:id` → `Target`
- `PATCH /targets/:id` (partial) → `Target`
- `DELETE /targets/:id` → `204`

## Credentials
- `GET /credentials?q=&type=&status=&limit=&offset=` → `{ credentials: Credential[] }` (filters optional)
- `POST /credentials` `{ name, type, provider?, secret_value, metadata?, rotation_policy_id? }` → `201 Credential`
- `GET /credentials/:id` → `Credential`
- `PATCH /credentials/:id` `{ name?, secret_value?, metadata?, rotation_policy_id? }` → `Credential`
- `DELETE /credentials/:id` → `204`

## Reveal (HIGH RISK)
- `POST /credentials/:id/reveal` `{ requested_by, purpose, ttl_seconds?, target_id? }`
  → `{ reveal_id, credential_id, secret_value, expires_at, rotation_required, rotate_before, rotation_job_id }`
- `GET /reveals` → `{ reveals: SecretReveal[] }`
- `GET /reveals/:id` → `SecretReveal`
- `POST /reveals/:id/revoke` → `SecretReveal`

## Reveal approvals (when policy.approval_required)
- A `reveal` with no `approval_id` returns `403 { error:{ code:"approval_required", data:{ reveal_request_id } } }` and opens a pending request.
- `GET /reveal-requests` → `{ requests: RevealRequest[] }`
- `GET /reveal-requests/:id` → `RevealRequest`
- `POST /reveal-requests/:id/approve` `{ decided_by? }` → `RevealRequest`
- `POST /reveal-requests/:id/deny` `{ decided_by? }` → `RevealRequest`
- Then retry `reveal` with `{ ...args, approval_id: <request id> }` (single use).

## Checkout (RECOMMENDED)
- `POST /targets/:id/checkout` `{ requested_by, purpose, ttl_seconds?, mode?, credential_id? }`
  → `{ checkout_id, mode, ssh_command, checkout_path, expires_at }`
- Works for **ssh_private_key** creds (`ssh -F <cfg> <alias>`) and **password**
  creds (`sshpass -f <pwfile> ssh …`; the password is written to a 0600 file, never
  returned in the response — requires `sshpass` on the client).
- `GET /checkouts` → `{ checkouts: CheckoutSession[] }`
- `GET /checkouts/:id` → `CheckoutSession`
- `POST /checkouts/:id/revoke` → `CheckoutSession`

## Rotation policies
- `GET /rotation-policies` → `{ policies: RotationPolicy[] }`
- `POST /rotation-policies` `{ name, rotate_after_reveal?, rotation_grace_period_minutes?, rotation_interval_days?, max_reveals_before_rotation?, auto_rotate_enabled?, approval_required? }` → `201`
- `PATCH /rotation-policies/:id` → `RotationPolicy`

## Rotation jobs
- `GET /rotation-jobs` → `{ jobs: RotationJob[] }`
- `POST /credentials/:id/rotation-jobs` `{ reason?, target_id? }` → `201 RotationJob`
- `POST /rotation-jobs/:id/mark-success` `{ new_secret_value, new_secret_version? }` → `RotationJob`
- `POST /rotation-jobs/:id/mark-failed` `{ error_message }` → `RotationJob`

## Audit
- `GET /audit-logs?limit=&actor=&action=&risk_level=` → `{ logs: AuditLog[] }` (newest first, redacted)

## Maintenance (automatic, on a 30s timer + startup)
- expired checkouts/reveals swept; due `next_rotation_due_at` → scheduled rotation jobs;
  auto-rotation runs eligible jobs; terminal reveals/checkouts older than
  `AGENTPASS_RETENTION_DAYS` (default 30) pruned. `SIGINT`/`SIGTERM` → graceful shutdown.

## Errors
`{ "error": { "code": string, "message": string } }` with status 400/401/404/409/500/501.

## curl examples
```bash
TOKEN=$(cat ~/.agentpass/token)
H="Authorization: Bearer $TOKEN"

curl -s localhost:4747/health

curl -s -XPOST localhost:4747/targets -H "$H" -H 'content-type: application/json' \
  -d '{"name":"web-01","type":"ssh","host":"10.0.0.5","port":22,"username":"deploy","environment":"dev"}'

curl -s -XPOST localhost:4747/credentials -H "$H" -H 'content-type: application/json' \
  -d '{"name":"db-pw","type":"password","secret_value":"FAKE-pw"}'

curl -s -XPOST localhost:4747/credentials/<cred_id>/reveal -H "$H" -H 'content-type: application/json' \
  -d '{"requested_by":"claude-code","purpose":"debug","ttl_seconds":300}'
```
