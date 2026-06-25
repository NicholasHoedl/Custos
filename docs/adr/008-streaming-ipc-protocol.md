# ADR-008: Streaming IPC protocol — custom typed channels

## Status

Accepted

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

Recall streams tokens from the main process (where Claude is called) to the renderer. We need
an IPC pattern for streaming partial results plus a final payload (citations), alongside the
ordinary request/response channels. (Suggest is request/response, not streaming — see ADR-009.)
All of this must work with `contextIsolation` and the contextBridge, without leaking Node into
the renderer.

## Decision Drivers

* **Typed** contracts across the process boundary
* Clean streaming of chunks + done/error
* Simple to reason about and to test
* Works with `nodeIntegration: false` / `contextIsolation: true`

## Considered Options

### Option 1: Custom typed IPC channels
- **Pros:** explicit and typed; request/response via `ipcMain.handle` / `invoke`; streaming via
  `stream:chunk` / `stream:done` / `stream:error` events tagged with a request id; one shared
  `ipc-types.ts` contract; easy to mock in tests.
- **Cons:** the renderer hook (`useStream`) must accumulate chunks by hand.

### Option 2: An `EventEmitter` / observable abstraction over IPC
- **Pros:** ergonomic stream API.
- **Cons:** more machinery; harder to trace across the process boundary; over-engineered for
  two streaming flows.

### Option 3: `MessagePort` / `MessageChannel`
- **Pros:** a direct channel.
- **Cons:** more complex setup under contextIsolation; unnecessary at this scale.

## Decision

Use **custom typed IPC channels** — request/response via `ipcMain.handle` / `invoke`; streaming
via `stream:chunk` / `stream:done` / `stream:error` events tagged with a request id, all typed
in a shared `src/shared/ipc-types.ts`; a `useStream` renderer hook accumulates chunks.

## Rationale

Two streaming flows (today just Recall) do not justify an abstraction layer. Explicit typed
channels are the easiest to reason about, test, and keep type-safe across the contextBridge.

## Consequences

### Positive
- Clear, typed, testable; minimal machinery.

### Negative
- A little boilerplate per channel; manual accumulation in the hook.

### Risks & Mitigations
- Channel sprawl as features grow → centralize definitions in `ipc-types.ts` and a single
  handler registry.

## Related Decisions

- ADR-005 — API key boundary enforced across this IPC layer
- ADR-009 — Suggest uses request/response (not streaming) over the same typed layer

## References

- `../../ARCHITECTURE.md` §6, §7
- `../../ROADMAP.md` P0-04, P2-05/06
