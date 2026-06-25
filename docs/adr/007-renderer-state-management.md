# ADR-007: Renderer state management — Zustand

## Status

Proposed (recommendation: Zustand; confirm during Phase 0)

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

The renderer needs shared client-side state: active campaign, active session, active PC, panel
/ UI state, and streaming/loading state. We need a state approach before building the app
shell (ROADMAP P0-05) and the feature views.

## Decision Drivers

* Low boilerplate
* Good TypeScript support
* Fine-grained re-renders (avoid re-rendering unrelated consumers)
* Easy to test
* Small footprint for a solo-dev codebase

## Considered Options

### Option 1: Zustand
- **Pros:** tiny; minimal boilerplate; hook-based; good TS; selective subscriptions avoid
  needless re-renders; easy to test; no provider tree.
- **Cons:** an extra dependency; less "official" than Context.

### Option 2: React Context (+ `useReducer`)
- **Pros:** built in; no dependency.
- **Cons:** coarse re-renders (every consumer re-renders on any change) unless split into many
  contexts; more boilerplate for non-trivial shared state.

### Option 3: Redux Toolkit
- **Pros:** powerful; great devtools; strong conventions.
- **Cons:** heavier than this app needs; more ceremony.

## Decision

(Proposed) Use **Zustand** for shared renderer state; keep purely local state in component
`useState`.

## Rationale

The shared state here is small but cross-cutting (active selections, streaming/loading) —
exactly where Context's coarse re-renders hurt and Redux is overkill. Zustand's selective
subscriptions and minimal boilerplate fit a solo-dev MVP. Marked **Proposed** to confirm once
the shell exists in Phase 0; revisit if plain Context turns out to be sufficient.

## Consequences

### Positive
- Minimal boilerplate; efficient re-renders; easy testing; no provider nesting.

### Negative
- One more dependency; store conventions to follow.

### Risks & Mitigations
- Overusing a global store for local concerns → keep stores small (`app-store`, `ui-store`) and
  prefer local component state where possible.

## Related Decisions

- ADR-006 — renderer build this runs in
- ADR-008 — IPC layer the store consumes data from

## References

- `../../ARCHITECTURE.md` §8 (`store/`)
- `../../ROADMAP.md` Phase 0 (ADR-007 — evaluate during Phase 0)
