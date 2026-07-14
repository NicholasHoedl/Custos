# ADR-050: Web graph enrichment — meaningful edges, time, an AI hub, and scale

## Status

Accepted — **implemented**. Extends [ADR-040](040-web-graph.md) (the Web relationship graph) and
[ADR-046](046-web-graph-per-type-color.md) (per-type node colour). Turns the Web view from a flat,
present-tense snapshot into an expressive, time-aware, interactive surface — reusing data the model already
holds. Renderer + shared types + main service + IPC + store + tests + docs; **no migration**. Verified:
typecheck + lint + full unit suite (268) + e2e (`web.spec` green; the 3 red specs are the known close-out /
recap under-load flake).

**Date:** 2026-07-13
**Deciders:** Solo developer

## Context

The Web view drew every entity as a fixed-size node and every *open* tie as an identical grey line, with
interaction limited to pan / zoom / drag / click-to-leave. It was visually striking but **underutilized**:
it showed *who connects to whom* and nothing else. Meanwhile the data model was far richer than the graph
exposed — `EntityLink` already carries `fromDisposition` / `toDisposition` / `confidence` / `description` /
`startSessionNumber` / `endSessionNumber` (ADR-021/033/017); the chronology has a reusable as-of predicate
(`isIntervalLiveAt`); and the three AI lenses sit one nav-group away. The graph dropped all of it in the
`buildCampaignGraph` projection. Four gaps: every edge looked the same; the graph was frozen at "now"; it was
a dead-end (click a node → leave); and it didn't scale (a large cast is a hairball with no filter/search/focus).

## Decision

Enrich along four axes, reusing existing data/utilities rather than adding new state or dependencies.

1. **Meaningful edges & node emphasis.** Widen `GraphEdge` to carry the tie's disposition/confidence/
   description/direction/interval (all already on `EntityLink`; the projection just stopped dropping them).
   The renderer colours edges by **disposition** (a keyword heuristic → warm/allied vs. cold/hostile),
   dashes them by **confidence** (rumoured/suspected), draws **arrowheads** on directed relations
   (`RELATIONS[k].symmetric === false`), and shows the full tie on hover (an invisible wide hit-line +
   `<title>`). Nodes **scale by degree** so hubs read as bigger.

2. **Time (the signature).** `buildCampaignGraph(ctx, campaignId, asOf?)` reconstructs the web AS OF any
   session: edges live at N (`isIntervalLiveAt`), plus those just-formed / just-severed at N (flagged, for a
   "what changed" pulse + a fading ghost); node lifecycle reconstructed via `resolveEntityState`. The **node
   set stays stable** across the slider (only edges + dimming change — the layout never scrambles). A session
   **slider + ▶ playback** in the header scrubs through the campaign's history. `asOf?` is threaded through
   the IPC chain (`ipc-types` → preload → `ipc/graph` → service → `useCampaignGraph`).

3. **An AI hub, not a dead-end.** A new **`openLens`** seam in `ui-store` (mirroring the existing
   `quickAddNonce`/`searchFocusNonce` pattern) queues a `pendingLens = { view, targetId?, query? }`; the
   destination lens view (kept mounted by MainPanel) consumes it on mount and clears it. A node's **right-click
   menu** launches **Converse** (an NPC), **Lore** (about the node), or opens it; **shift-clicking two nodes**
   asks Lore **"what's between them?"**.

4. **Scale.** Interactive **type-filter chips** (the legend became clickable) + a **hide-fallen** toggle;
   **search / jump-to-node** (centres the viewport on a match); **click-to-focus** (isolate a node + its
   1-hop neighbours); opt-in **clustering** (a gentle grouping force by location/faction parent, derived from
   the live edges); and **PNG export**.

**Explicitly deferred / trimmed** (per the plan's allowance to simplify the riskiest tail): a dedicated
**shortest-path** highlight (the pair-compare + focus already cover "explore the connection"), and
graph-side **merge / set-portrait** actions (reachable from EntityDetail/Codex). Clustering is **opt-in and
off by default**, so an imperfect grouping layout can't destabilise the default view. The slider re-fetches
per session (re-settling the layout slightly from cached positions) rather than a fully client-side temporal
model — acceptable for campaign-sized session counts.

## Consequences

- **No migration, no new dependency.** All new edge/time data already existed on `EntityLink` + the chronology
  service; the slider and context menu are hand-rolled (a native range input + a positioned overlay) rather
  than new shadcn/Radix primitives.
- **`GraphNode`/`GraphEdge` widened**; the sole constructor is `buildCampaignGraph`, so nothing else breaks.
  New unit tests cover the enriched projection + the as-of reconstruction.
- The **disposition→colour** mapping is a keyword heuristic over free text — imperfect by nature (it can miss
  an idiom), but it degrades to "neutral", never to a wrong assertion, and it's a data-viz aid not a fact.
- The graph is now a **launchpad** into the AI lenses, tightening the loop between "see a connection" and
  "ask about it" — the first cross-view `openLens` seam, reusable by any future surface.
- The Web view remains a **data-viz exception** to the single-accent rule (ADR-046), now widened to include
  edge sentiment colour alongside the per-type node colour.
