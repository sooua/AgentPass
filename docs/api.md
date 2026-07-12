# Daemon HTTP API

Base URL: `http://127.0.0.1:4747` · Auth: `Authorization: Bearer <token>`
(from `~/.agentpass/token`, printed at daemon startup). All bodies are JSON.

## Health
- `GET /health` → `{ "status": "ok", "service": "agentpass", "version": "0.1.0" }` (no auth)

## Targets
- `GET /targets` → `{ targets: Target[] }`
- `POST /targets` `{ name, type, host, port, username, tags?, environment?, credential_ids? }` → `201 Target`
- `GET /targets/:id` → `Target`
- `PATCH /targets/:id` (partial) → `Target`
- `DELETE /targets/:id` → `204`

## Credentials
- `GET /credentials` → `{ credentials: Credential[] }`
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

## Checkout (RECOMMENDED)
- `POST /targets/:id/checkout` `{ requested_by, purpose, ttl_seconds?, mode?, credential_id? }`
  → `{ checkout_id, mode, ssh_command, checkout_path, expires_at }`
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
- `GET /audit-logs?limit=200` → `{ logs: AuditLog[] }` (newest first, redacted)

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
