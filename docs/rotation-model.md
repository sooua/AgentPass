# Rotation Model

Rotation lifecycle is a **core** capability, not an add-on. A revealed secret is
treated as potentially compromised, so reveals drive rotation.

## RotationPolicy fields
- `rotate_after_reveal` — flag rotation after any reveal (default true).
- `rotation_grace_period_minutes` — how long the old secret may still be used;
  sets `rotate_before` on the reveal result.
- `rotation_interval_days` — schedule-based due date (`next_rotation_due_at`).
- `max_reveals_before_rotation` — flag rotation once reveal count crosses N.
- `auto_rotate_enabled` — reserved for auto rotation providers (MVP: manual).
- `approval_required` — reserved for an approval workflow.

## After every `reveal_secret`
1. `last_revealed_at = now`
2. `reveal_count_since_rotation += 1`
3. If policy requires → credential `status = rotation_required`
4. Create `RotationJob(reason=after_reveal, status=pending)`
5. Audit `rotation_required`

## Manual rotation (MVP)
1. A job exists (`after_reveal`, `manual`, `scheduled`, or `compromised`).
2. Operator/agent rotates the secret out-of-band on the target.
3. Call `mark_rotation_complete` / `POST /rotation-jobs/:id/mark-success` with the
   new secret value. Core then:
   - stores the new secret via the credential backend,
   - sets `last_rotated_at = now`, `reveal_count_since_rotation = 0`,
     `status = active`, recomputes `next_rotation_due_at`,
   - marks still-active reveals as `rotated`,
   - audits `rotation_success`.
4. Failure path: `mark-failed` records the error and audits `rotation_failed`.

## Auto rotation (future)
`RotationProvider` (`PasswordRotationProvider`, `SshKeyRotationProvider`) is the
seam for generating + pushing a new secret to the target automatically. Stubs
throw today; wire them when `auto_rotate_enabled` should act. A scheduler would
scan `next_rotation_due_at` and enqueue jobs.
