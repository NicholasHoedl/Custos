# ADR-046: Per-type color + icon on the Web graph (revises ADR-040's node styling)

## Status

Accepted — **implemented**. Each entity type now has its own muted outline color and a lucide type icon
on its node in the **Web** view, with a corner legend; the main character keeps a brighter, thicker ember
ring. Revises the "no rainbow-tinting, muted-iron-for-everyone" node styling from **ADR-040** (and
relaxes the single-accent guardrail of **ADR-024** for this one data-viz surface). Renderer + theme only
— no migration, no data/IPC change (`GraphNode.type` already existed). Verified: typecheck + lint + suite.

**Date:** 2026-07-12
**Deciders:** Solo developer

## Context

ADR-040 shipped the Web graph with every non-MC node in the same muted iron, deliberately avoiding
per-type color to honor the single-accent rule (ADR-024). In practice you can't tell an NPC from a
location from a quest without hovering each node for its `<title>`. The user asked for per-type outline
colors so type reads at a glance — which directly reverses ADR-040's node-styling call.

## Decision

**Give each `EntityType` its own muted outline color AND a type icon** — differentiating by color *and*
shape (chosen over color alone for legibility/accessibility). The main character stays distinct: a
brighter `--ember-bright` ring at a thicker stroke, so the protagonist still reads as special even though
the `pc` type is itself ember. A small always-on legend maps color + icon → type.

- Colors are 8 muted "torch-lit heraldry" tokens (`--type-*`) in `globals.css` — the theme source of
  truth — deliberately desaturated to sit beside the charcoal canvas, avoiding `--blood` (death) and
  keeping plain `--ember` / `--ember-bright` for the MC. `pc` reuses ember, `item` reuses pewter.
- `lib/entity-visuals.tsx` maps `Record<EntityType, …>` → color var + lucide icon; the exhaustive
  `Record` is the guardrail (a new entity type won't compile until it has both).

## Rationale

The Web view is a **data-visualization surface**, where categorical distinction is the whole point. The
single-accent rule (ADR-024) earns its keep on the app's chrome, not on a graph whose job is to separate
categories. Keeping the hues muted and reserving ember/ember-bright for the MC preserves the grim
register and the protagonist cue while making type legible; the per-type icons carry the distinction
where hues sit close, so the palette needn't shout.

## Consequences

### Positive
- Type is legible at a glance (color + icon + legend), not one-hover-at-a-time.
- No data/IPC/migration cost — `GraphNode.type` was already carried end to end (ADR-040).
- The exhaustive `Record<EntityType, …>` map fails the build if a future type lacks a color/icon.

### Negative
- Adds color to a surface that was intentionally monochrome — a deliberate, **scoped** exception to
  ADR-024, not a license to color the rest of the app.
- Eight hues on dark are a tuning problem; some greens sit close (mitigated by the per-type icons).

## Related Decisions
- **Revises ADR-040** (Web graph — node *styling* only; its layout/data/interaction decisions stand).
- Relaxes **ADR-024** (single-accent guardrail) for the Web data-viz surface only.
- ADR-039 (portraits still clip into the node; the type badge sits on the rim).

## References
- Renderer: `components/views/WebView.tsx` (`GraphNodeGlyph` ring + type badge, legend);
  `lib/entity-visuals.tsx` (`ENTITY_TYPE_COLOR` / `ENTITY_TYPE_ICON`).
- Theme: `src/renderer/src/styles/globals.css` (`--type-*` tokens); `docs/design/theme.md`.
