# ADR-053: Web graph legibility at scale — label LOD, hide-minor, collapsible clusters, hide weak edges

## Status

Accepted — **implemented**. Extends [ADR-040](040-web-graph.md) (the Web relationship graph),
[ADR-046](046-web-graph-per-type-color.md) (per-type colour), and [ADR-050](050-web-graph-enrichment.md)
(edges/time/AI-hub/scale). Renderer-only: a new pure reducer + `WebView.tsx` wiring + unit + e2e + docs;
**no migration, no main/preload, no new dependency**. Verified: typecheck + lint + unit (321) + `web.spec`.

**Date:** 2026-07-15
**Deciders:** Solo developer

## Context

ADR-050 gave the Web view filters, search, focus, and opt-in clustering, but as a campaign grows the map
still degrades in three ways the existing controls don't fix: **node labels always render** and overlap into
mush (`"Daran EdermatHarbin Wester"`); the edge set becomes a **hairball**; and a **long tail** of one-off
NPCs crowds the entities that matter. Node size already encodes degree (`radiusFor`), which helps, but the
reader needs to *thin* what's drawn.

The load-bearing constraint: the d3-force sim is built over the **entire** `graph.nodes`/`graph.edges` set,
and the ADR-050 filters (type / hide-fallen / focus) are **render-only** (`visibleIds`) — deliberately, so
toggling a type never reshuffles the layout. That's right for a "lens", but a control meant to *declutter*
should also make the layout **tighten**; a render-only hide leaves the pruned node's charge/collide footprint
behind as an empty gap.

## Decision

Four controls, split by whether they should reshape the layout:

1. **Label level-of-detail (render-only).** Labels are rationed: shown on a small map (≤ 30 reduced nodes),
   once zoomed past `k ≥ 1.4`, for hubs (degree ≥ 3) / the MC / the hovered node / the focused neighbourhood;
   edge labels only when zoomed (`k ≥ 1.6`) / hovered / focused. The small-graph escape keeps young campaigns
   (and the 2-node e2e) fully labelled. New `hoveredId` state + pointer-enter/leave on the node glyph.

2. **Hide minor (reshapes).** A toggle drops nodes below `minDegree` (2) live ties — the isolated + single-tie
   tail — never the MC or a super-node.

3. **Collapsible clusters (reshapes).** A location (+ what's `located_in` it) or a faction (+ its `member_of`
   members) folds **transitively** into one super-node: the parent survives (its own id **is** the super-node
   id — no synthetic node), descendants' external edges reroute onto it, internal edges drop, parallels
   dedupe. A clickable **count badge** on any collapsible parent + a right-click **Collapse/Expand group** item
   + an **Expand all** chip. A collapsed super-node draws a dashed halo + the count.

4. **Hide weak edges (render-only).** A toggle hides `rumored`/`suspected` ties; node positions unchanged.

Controls that reshape (#2, #3) transform the **sim inputs**; render-only controls (#1, #4, and the ADR-050
filters) don't. This is realized by a pure `reduceGraph(graph, { collapsed, hideMinor, ... })`
(`src/renderer/src/lib/graph-reduce.ts`) that produces the node/edge set the sim **both simulates and
renders**, folded into the rebuild `signature`. `WebView.tsx` routes `degree` / `visibleIds` / `neighborhood`
/ `nodeById` / the sim build through the reduced graph; the header counter + empty-check stay on the raw graph
(campaign totals), with a conditional `· N hidden` suffix.

## Rationale

- **A pure reducer, unit-tested.** Transitive collapse with edge rerouting/dedupe and nested-collapse
  subsumption is the one genuinely fiddly piece; isolating it as a side-effect-free module (the way the repo
  isolates `lib/mention.ts`, `applyRerankScores`, `selectEnrichRoster`) makes it directly testable and keeps
  `WebView.tsx` thin. `parentOf` generalizes the old inline `clusterOf` to both authored directions
  (`located_in`/`member_of` **and** `contains`/`has_member`) via a `PARENT_SIDE` table over
  `HIERARCHY_RELATIONS`.
- **Group from the graph edges, not `getHierarchy`.** `buildCampaignGraph(asOf)` already as-of-filters the
  edges, so deriving clusters from them makes collapse **as-of correct for free** (a membership severed at
  session N un-groups its child under the time slider). `link.service.getHierarchy` is a structural CTE with
  no as-of awareness — wrong for a time-scrubbing view.
- **Reshape is acceptable for a deliberate declutter.** Hide-minor/collapse move nodes on toggle, but they're
  explicit user actions with a clear cause, and `posRef` keeps survivors stable, so the map settles rather
  than scrambles. Leaving gaps (render-only) would undercut the whole point.

## Consequences

### Positive
- No migration, no new dependency (native controls + the existing `ToggleChip` / overlay-menu / count-badge
  patterns). All four controls default OFF, so the base view is unchanged.
- The super-node's identity is the parent's own id, so every `graph.nodes` consumer works unchanged once
  routed through the reduced graph — no synthetic-id plumbing.
- `hideMinor`/`collapse` fold into the sim `signature`, so the layout re-settles (tightens) on toggle;
  render-only controls stay off the signature (no needless rebuild).

### Negative / trade-offs
- Rerouting collapses parallel external ties to one edge, so a super-node can under-count its true
  connectedness for the degree-based radius; the count badge + dashed halo carry "this is a group" instead.
- Collapse is **one grouping per node** (`parentOf` returns the first hierarchical parent) — a node both
  `located_in` a place and `member_of` a faction folds under whichever edge comes first.
- The header counter stays a **campaign total** (not view-filtered), with a `· N hidden` hint — honest about
  the campaign size while signalling the view is reduced.

### Risks & Mitigations
- Nested / cyclic hierarchies → BFS with a visited set (cycle-safe); nested collapses subsume into the highest
  surviving ancestor (unit-tested).
- Hiding everything (a graph of all-isolated nodes with hide-minor on) → the sim guard is on
  `effective.nodes.length === 0`, so it stops cleanly rather than erroring.

## Related Decisions

- [ADR-040](040-web-graph.md) / [ADR-050](050-web-graph-enrichment.md) — the Web view this extends.
- [ADR-021](021-creature-type-note-confidence-campaign-lore.md) / relations — hierarchical `located_in` /
  `member_of` pairs that drive collapse grouping.

## References

- `src/renderer/src/lib/graph-reduce.ts` — pure `parentOf` / `descendantsOf` / `collapsibleParents` /
  `reduceGraph`.
- `tests/unit/renderer/graph-reduce.test.ts` — the reducer's unit coverage.
- `src/renderer/src/components/views/WebView.tsx` — the wiring + label LOD + the collapse affordance.
- `tests/e2e/web.spec.ts` — chip presence + the hide-minor reduce path end-to-end.
