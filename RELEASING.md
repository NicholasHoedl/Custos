# Releasing Ledger

Ledger ships a Windows installer and updates itself via **electron-updater** reading the repo's public
GitHub **Releases** (ADR-042). Cutting a release is: bump the version, push a tag, and publish the draft
the CI job produces.

## Prerequisites (one-time)

- The GitHub repo **`NicholasHoedl/Ledger`** must exist and be pushed, and its **Releases must be public**
  (electron-updater fetches `latest.yml` with no auth — a private repo would need a different feed). The
  proprietary [`LICENSE`](LICENSE) still forbids reuse; the source simply being visible is fine.
- `electron-builder.yml` `publish.owner`/`publish.repo` must match the real repo exactly.

## Cut a release

1. **Bump the version** in `package.json` (`version`) — this is what the installer is named after and what
   electron-updater compares against. Commit it.
2. **Tag and push:**
   ```bash
   git tag v0.1.1
   git push origin main --tags
   ```
3. The **Release** workflow (`.github/workflows/release.yml`) fires on the `v*` tag: it builds on
   `windows-latest` and runs `electron-builder --publish always`, uploading `Ledger Setup 0.1.1.exe`,
   `latest.yml`, and the `.blockmap` to a **draft** GitHub Release for the tag.
4. **Publish the draft release** (GitHub → Releases → the new draft → *Publish*). Auto-update only sees a
   **published** release — a draft's assets aren't served. Add release notes here.

Installed copies check on launch (and via **Settings → Your data → Check for updates**), download in the
background, and install on quit.

## Local build (no publish)

```bash
npm run dist    # → dist/Ledger Setup <version>.exe  (+ latest.yml, because publish: is configured)
```

This produces the installer + feed locally without uploading — useful to sanity-check a build.

## Code signing (optional)

Builds are **unsigned** by default, so Windows SmartScreen warns about an "unknown publisher" until a
certificate is added or download reputation accrues. To sign, add two **repository secrets** — no code or
workflow change is needed:

- `CSC_LINK` — the code-signing certificate as a base64-encoded `.pfx` (or a URL to one).
- `CSC_KEY_PASSWORD` — the certificate password.

electron-builder picks these up automatically from the environment (the workflow already passes them
through). With them set, releases are signed; empty, they're unsigned.

## Version scheme

Plain semver (`vMAJOR.MINOR.PATCH`). electron-updater only offers an update when the release version is
**greater** than the installed one, so never reuse or lower a tag.
