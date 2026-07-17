# ADR-061: Home — a dashboard front door, and the new default landing view

## Status

Accepted — **implemented**. A new first nav item + default view (`'home'`, revising ADR-044's
Chronicle-first order); the tutorial's closing review card now floats over it and Finish lands there.
New: `views/HomeView.tsx`, `components/home/MiniWeb.tsx`, pure `lib/dashboard.ts` (+ unit tests),
`ContinuityRequest.checksOnly`, and the lens history lifted store-side. No migration.

**Date:** 2026-07-16
**Deciders:** Solo developer

## Context

Ten task-focused views, but nothing answered "where am I in my campaign, and what should I do next?" —
the app opened straight into the Chronicle. Home is the campaign's front door: re-immersion before a
game night, the loop's outstanding work, and jump-off points into every tool.

## Decision

1. **Widgets** (all computed from existing reads; the layout math lives in the PURE
   `lib/dashboard.ts`, unit-tested): identity hero (campaign name, MC portrait, session count,
   last-played) · "Previously…" (the existing `SessionRecap` mounted for the newest session; key-gated)
   · a needs-attention strip (unclosed-extract counts, setup nags, record health) · open threads
   (active quests + rumored/suspected notes) · memory-at-a-glance type chips · a static **MiniWeb**
   teaser (same d3-force recipe as the Web view, run to completion synchronously, ≤50 top-degree nodes,
   click → Web) · "From the archives…" (a dormant active entity or an old rumor, day-seeded pick) · an
   ask box that pre-seeds Lore via the existing `openLens` seam + recent questions across all lenses.
2. **`ContinuityRequest.checksOnly`** — the record-health tile runs ONLY the deterministic checks
   (free, instant, keyless); the AI pass reports `skipped/checks_only`. The dashboard probes on mount +
   entity changes.
3. **Lens history lifted into the ui-store** (`lensHistory` + `rememberLens`, entries gain `at`) — it
   was per-component `useState`, invisible to any other consumer. `useLensHistory(lens)` keeps its
   shape; the four lens views changed one line each; the dashboard merges the four streams newest-first.
4. **Default landing = Home** (`activeView` isn't persisted, so every launch opens there); the nav gains
   a heading-less `home` group above Capture; the tutorial's REVIEW step renders over the dashboard and
   `finish()` lands on it (user decision — no dedicated tour stop).

## Consequences

* **+** The app opens on re-immersion + a to-do list instead of an empty composer; every widget links
  into the tool that acts on it.
* **+** All data comes from existing IPC reads — no new queries, no AI calls on load (the ask box only
  pre-fills; the health probe is deterministic-only).
* **−** Four e2e specs assumed landing on Chronicle (capture/extract/recap/transcribe) — each now
  navigates first. New `home.spec.ts` covers landing, fill-in, and the Lore hand-off.
* **−** A handful of extra DB-read IPCs at boot (MainPanel mounts all views anyway; trivial at this
  scale).
* The archives spotlight rotates daily (seeded by day number) — deliberate, so it doesn't reshuffle on
  every render.
