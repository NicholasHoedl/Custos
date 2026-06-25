# ADR-006: Build tooling — electron-vite

## Status

Accepted

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

We need a bundler/build setup for an Electron app with a React + TypeScript renderer and a
TypeScript main/preload, with fast dev iteration (HMR) and a straightforward path to
production builds.

## Decision Drivers

* First-class **Electron + Vite + TypeScript** integration
* Fast **HMR** and good developer experience for a solo dev
* Clean separation of **main / preload / renderer** builds
* Minimal configuration

## Considered Options

### Option 1: `electron-vite`
- **Pros:** purpose-built wrapper around Vite for Electron; handles the three build targets out
  of the box; fast HMR; TypeScript-friendly; minimal setup.
- **Cons:** an extra abstraction over Vite; smaller community than electron-forge.

### Option 2: `electron-forge` (+ Vite plugin)
- **Pros:** full app lifecycle (package / make / publish); large community.
- **Cons:** heavier; more configuration; packaging-focused, with a less smooth dev-server story
  than electron-vite.

### Option 3: Hand-rolled Vite + Electron
- **Pros:** maximum control.
- **Cons:** must wire up the main/preload/renderer builds and HMR yourself — reinvents what
  electron-vite provides.

## Decision

Use **`electron-vite`** for development and builds.

## Rationale

It gives the best Vite-based DX for Electron with the least configuration — ideal for a solo
dev — handling all three build targets and HMR by default. Production packaging
(`electron-builder`) can be layered on later for distribution without changing the dev setup.

## Consequences

### Positive
- Fast iteration, minimal config, clean target separation.

### Negative
- One more abstraction; production packaging still needs `electron-builder`/forge added later.

### Risks & Mitigations
- electron-vite limitations for an exotic need → drop down to a raw Vite config for that target.

## Related Decisions

- ADR-007 — renderer state, built within this renderer bundle
- ADR-008 — IPC wiring between the build targets

## References

- `../../ARCHITECTURE.md` §1
- `../../ROADMAP.md` P0-01
