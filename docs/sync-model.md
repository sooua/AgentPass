# Sync Model

Cross-device sync of targets, credentials (metadata **and** secrets) and rotation
policies. Because agentpass syncs **secrets**, the design differs from a typical
notes/prompt sync in one critical way: **end-to-end encryption is mandatory.**

## What syncs
- Targets, credentials (with plaintext secret for `local_encrypted` creds),
  rotation policies, tombstones (deletions).
- **Not** synced: audit logs, reveals, checkout sessions, reveal requests
  (device-local operational state), the master key, the local API token.

## Encryption (mandatory)
- The whole bundle is serialized, then AES-256-GCM encrypted with a scrypt-derived
  key from a **sync passphrase**. The remote (folder/Gist/WebDAV/S3) only ever
  stores an opaque `{ "agentpass_enc": 1, salt, iv, tag, data }` envelope — no
  plaintext, no metadata.
- Same passphrase on every device. No passphrase → sync refuses. Wrong passphrase
  → decrypt fails (GCM auth), sync errors, nothing is overwritten.
- The passphrase + provider creds live in `~/.agentpass/sync.json` (0600 + Windows
  ACL). Consistent with the master-key threat model: local disk is trusted, the
  cloud copy is not.

## Merge
Provider-agnostic engine, **item-level merge** (no whole-document conflict):
- Each entity merged by id; newer `updated_at` wins.
- Deletions propagate via **tombstones** (kept ≥90 days); a tombstone newer than
  an item removes it on every device.
- Merged state is pushed back so devices converge. Concurrent edits of *different*
  items both survive.
- A credential's secret rides inside the encrypted envelope; on the receiving
  device it's re-stored under a fresh local `secret_ref` (refs are device-local).

## Providers
`SyncProvider` moves opaque strings (`pull/push/listVersions/getVersion`):
- **local** — a folder (pair with Syncthing/Dropbox/iCloud). Safest: ciphertext
  never leaves your machines via a third party.
- **gist** — GitHub Gist (private), version history via gist commits. Needs a PAT.
- **webdav** — any WebDAV server (Nextcloud, 坚果云, …). History under `history/`.
- **s3** — AWS S3 / R2 / MinIO / B2 via SigV4 (path-style). History under `history/`.

## Daemon
- `GET /sync/state`, `POST /sync/passphrase`, `POST /sync/auto`,
  `POST /sync/connect/{local|gist|webdav|s3}`, `POST /sync/disconnect`,
  `POST /sync/run`, `GET /sync/versions`, `POST /sync/restore/:id`.
- Auto-sync (when enabled) runs on the 30s maintenance timer with skip-based
  backoff after failures. Sync is a **user** operation — not exposed over MCP.
