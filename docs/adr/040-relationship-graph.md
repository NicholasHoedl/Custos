# ADR-040: Relationship graph — a d3-force "Web" view

## Status

Accepted — **implemented** (ROADMAP P2-3). A new ninth nav view, **Web**, draws the campaign's live
relationships as a force-directed graph. First visualization dependency (`d3-force`). **No migration**
(reads existing entities + links). Verified: typecheck + lint + full suite (`buildCampaignGraph`
integration tests: open-edge filter, forward labels, dangling-edge drop; keyless e2e `web.spec.ts`).

**Date:** 2026-07-10
**Deciders:** Solo developer

## Context

Custos already knows every tie between entities (ADR-017's interval-based `entity_link`), but the only way
to see them was one entity at a time in the `RelationshipEditor`. The audit asked for a single visual map
of the campaign's web of relationships — who is allied, who owns what, who is where — as an at-a-glance
picture and a navigation surface.

## Decision

**A read-only force-directed graph in its own nav view.** Two forks were settled with the user: the
layout engine is **d3-force**, and it lives in a **new nav view** (rather than a panel bolted onto an
existing view).

**`d3-force` for layout, hand-written SVG for render.** `d3-force` (`forceSimulation` +
`forceManyBody`/`forceLink`/`forceCenter`/`forceCollide`) computes node positions; we render the result
as our own `<svg>` rather than pulling in a full graph-rendering library. This keeps the visual fully
inside the Ash & Ember theme (nodes/edges reference the CSS variables directly) and adds one small,
focused dependency instead of a heavy canvas framework. Pan (background drag), zoom (wheel, cursor-
anchored), and node drag (pins the node) are hand-rolled pointer handlers — d3-force is layout only, not
interaction.

**Its own view, `'web'`, ninth in the nav** (icon `Waypoints`), placed right after Codex so the two
entity-data surfaces sit together. Wiring is centralized: a `ViewKey` entry, a `NAV_ITEMS` entry (the
Sidebar and the Ctrl+K palette both read `NAV_ITEMS`, so the palette picks it up for free), and a
`MainPanel` `VIEWS` entry.

**A dedicated, minimal data seam.** `buildCampaignGraph(ctx, campaignId)` (`link.service.ts`) returns a
flat `{ nodes, edges }`:
- **Nodes** = every entity (`listEntities`), each carrying `id/name/type/image/lifecycle` — only what the
  render needs (portrait from ADR-039, lifecycle for the fallen-dimming).
- **Edges** = only **live** ties. `listLinksForCampaign` returns *all* intervals, so edges filter to open
  ones (`endSessionNumber === null`) — the Web is "as it stands now," not the full history. Each edge's
  `label` is the forward display string (`RELATIONS[relation].forward`).
- **Dangling edges are dropped** defensively (endpoint not in the node set). `deleteEntity` cascades, so
  this shouldn't happen, but a dangling ref must never crash the layout.

Structural, so there's no chronology/as-of parameter — the graph is the present live picture, mirroring
how `getHierarchy` treats containment as structural (ADR-033).

**Simulation lifecycle respects the always-mounted panel.** `MainPanel` keeps every view mounted
(toggling visibility), so the simulation is guarded on `activeView === 'web'`: it builds and reheats when
the view becomes active and `sim.stop()`s + cancels its rAF when hidden or unmounted. Node positions are
cached in a ref so a data change (re-tie, rename) doesn't scramble the layout, and the rebuild is keyed on
the graph *shape* (a signature string) rather than object identity, so unrelated re-renders don't restart
a settling sim.

**Design guardrail honored.** The ember accent stays reserved for the main character's node ring;
everyone else is muted iron. Types are distinguished by the node's initials/portrait and its `<title>`,
**not** by rainbow-tinting each type — consistent with the single-accent rule (ADR-024). Clicking a node
navigates to it (`setSelectedEntity` + `setActiveView('capture')`, MC → `'character'`) — the same
navigation the command palette uses.

## Consequences

### Positive
- The whole campaign's live relationships are visible and navigable at once — a genuinely new view of the
  data, and a fast jump-to-entity surface.
- One small dependency; the render is ours, so it themes perfectly and has no external styling to fight.
- Zero schema/migration cost — it's a pure read over existing tables.

### Negative / Risks
- Force layouts are non-deterministic and can look busy on a large, densely-tied campaign. Accepted for
  v1 — pan/zoom/drag let the user untangle; no clustering or filtering yet.
- The simulation is CPU work while the view is active; bounded by entity count (no cap) and stopped when
  hidden. Accepted at campaign scale.
- Portrait file-picking and node-drag aren't unit/e2e-tested (native dialog / moving targets) — the data
  seam and nav are, and the render is thin. Accepted.

## Related Decisions
- ADR-039 (portraits — clipped into the nodes). ADR-017 (link intervals — the "open interval = live edge"
  filter). ADR-033 (structural reads ignore as-of, mirrored here). ADR-024 (single-accent design
  guardrail). P2-4 command palette (shared `NAV_ITEMS`, shared node→entity navigation).

## References
- Types: `shared/graph-types.ts` (`GraphNode`/`GraphEdge`/`CampaignGraph`).
- Main: `services/link.service.ts` (`buildCampaignGraph`); IPC `graph:campaign` (`ipc/graph.ts`).
- Renderer: `components/views/WebView.tsx`; `hooks/use-ledger.ts` (`useCampaignGraph`); `lib/nav-items.tsx`,
  `store/ui-store.ts`, `components/layout/MainPanel.tsx`.
- Tests: `tests/unit/services/link.service.test.ts` (`buildCampaignGraph`), `tests/e2e/web.spec.ts`.
