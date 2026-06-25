# ADR-005: API key storage — Electron safeStorage (DPAPI on Windows)

## Status

Accepted

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

The user supplies their own Anthropic API key. It must be stored locally, encrypted at rest,
**never exposed to the renderer**, and never logged. All Claude calls happen in the main
process.

## Decision Drivers

* Encryption at rest, scoped to the OS user account
* No plaintext key on disk
* No heavyweight third-party secret-store dependency
* Key stays in the **main process only** (never crosses the contextBridge)

## Considered Options

### Option 1: Electron `safeStorage` (DPAPI on Windows)
- **Pros:** built into Electron; encrypts via the OS user account (DPAPI on Windows); no extra
  dependency; minimal `encryptString` / `decryptString` API.
- **Cons:** ciphertext is decryptable by anything running as the same OS user (acceptable for a
  single-user local app).

### Option 2: `keytar` (OS keychain / Windows Credential Manager)
- **Pros:** stores in the OS credential vault.
- **Cons:** native dependency with packaging friction; spotty maintenance history; more than
  needed given `safeStorage`.

### Option 3: Plaintext in a config file / env var
- **Pros:** trivial.
- **Cons:** insecure at rest. Rejected.

## Decision

Store the key with **Electron `safeStorage`** (DPAPI-backed on Windows); persist the ciphertext
under `app.getPath('userData')`.

## Rationale

`safeStorage` provides OS-user-scoped encryption at rest with **zero extra dependencies** and a
tiny API — the right level of protection for a single-user local app. `keytar`'s packaging cost
is not justified; plaintext is unacceptable.

## Consequences

### Positive
- Encrypted at rest; no new dependency; the key is confined to the main process.

### Negative
- Protection is only as strong as the OS user account (same-user processes can decrypt — an
  accepted trade-off here).

### Risks & Mitigations
- `safeStorage.isEncryptionAvailable()` can be `false` on some Linux configurations → not a
  concern on the Windows target; if the app goes cross-platform later, guard and warn.

## Security boundary

The key never crosses the contextBridge into the renderer (not in arguments, return values, or
error messages); it is decrypted only in main-process memory at call time, and is never logged.

## Related Decisions

- ADR-008 — IPC boundary that keeps the key out of the renderer

## References

- `../../ARCHITECTURE.md` §10 (Security Considerations)
- `../../ROADMAP.md` P2-01
