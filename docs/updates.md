# Online Updates

The desktop app self-updates via the **Tauri updater plugin**, distributing from
**GitHub Releases**. The UI is in Settings → Updates (check → install & restart).

## One-time setup (before the first release)

1. **Generate your own signing keypair** (do NOT ship the placeholder one):
   ```bash
   pnpm --filter @agentpass/desktop exec tauri signer generate -w agentpass.key
   ```
   - Keep `agentpass.key` (private) **secret** — never commit it.
   - Copy the printed **public key** into `apps/desktop/src-tauri/tauri.conf.json`
     → `plugins.updater.pubkey`.

2. **Set the endpoint** in the same config to your repo:
   ```
   "endpoints": ["https://github.com/<OWNER>/<REPO>/releases/latest/download/latest.json"]
   ```

3. **CI/build env** (so bundles get signed):
   ```
   TAURI_SIGNING_PRIVATE_KEY=<contents of agentpass.key>
   TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<its password, empty if generated with --ci>
   ```

## Cut a release
```bash
pnpm --filter @agentpass/desktop exec tauri build   # produces signed installers + .sig
```
`bundle.createUpdaterArtifacts: true` also emits a `latest.json` manifest. Upload
the installers, their `.sig` files, and `latest.json` to the GitHub Release
tagged for that version. The running app polls `releases/latest/.../latest.json`,
verifies the signature against `pubkey`, downloads, and relaunches.

`latest.json` shape:
```json
{
  "version": "0.2.0",
  "notes": "…",
  "pub_date": "2026-07-12T00:00:00Z",
  "platforms": {
    "windows-x86_64": { "signature": "<.sig contents>", "url": "https://github.com/.../agentpass_0.2.0_x64-setup.exe" }
  }
}
```

## Notes
- Updates are **desktop-only**; the web build shows "desktop app only".
- The placeholder pubkey currently committed is a throwaway — **replace it** with
  your own before publishing, or update checks will fail signature verification.
- The endpoint `OWNER/REPO` is a placeholder — set it to your repository.
