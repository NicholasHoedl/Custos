# ADR-047: UI cohesion — one page-header system, grouped nav, filled AI-lens idle states

## Status

Accepted — **implemented**. A live walkthrough of the packaged app surfaced four cohesion problems; this
ADR records the fixes: (1) a single compact-toolbar page header across all views; (2) grouped sidebar nav
(Capture / World / Ask); (3) starter-chip idle states for the three AI lenses; (4) the per-type
color/icon system (ADR-046) extended from the Web graph into the Codex list. Renderer + theme only — no
migration. Verified: typecheck + lint + full suite (264 tests) green.

**Date:** 2026-07-12
**Deciders:** Solo developer

## Context

Headers had drifted into ~4 treatments — giant `text-3xl` Fraunces titles on the reading panes
(Lore/Counsel/Converse/Annals/Settings), a compact `border-b` toolbar on Web/Chronicle, two sizes inside
Sessions, and a clashing double-header on Character. Removing the page subtitles a pass earlier left the
big titles stranded and bare. The three AI lenses were ~60% empty when idle (a title, an input, one
floating hint). The 9 nav items were an undifferentiated list. And Codex still showed monochrome type
badges while the new Web graph color+icon-coded every type.

## Decision

**One header component — a compact toolbar.** `chrome.tsx` `PaneHeader` becomes `{ icon?, title, action }`
— a full-width `border-b` bar (leading type icon + `text-lg` Fraunces title + right-side action slot);
`size`/`description` are dropped. A new `PaneBody` (`reading`/`form`/`wide`) is the centered scroll column
beneath it; the old `PaneShell` is deleted. Governing rule: **page chrome = compact toolbar; content
identity = large Fraunces** — so entity names, session titles, and the character dashboard keep their big
display type, only the nav-level header shrinks. Character's double-header collapses to one `PaneHeader`.

**Grouped nav.** `NAV_ITEMS` stays a flat array (the command palette maps it flat) but each item gains a
`group` (`capture`/`world`/`ask`/`settings`); the Sidebar renders `.inscribed` section headings before
each group. Capture = Chronicle · Sessions; World = Character · Codex · Web; Ask = Lore · Counsel ·
Converse; Settings trails under a divider.

**Filled idle states.** A shared `components/lens/LensIdle.tsx` renders example **starter chips** (from
`lib/lens-starters.ts`, one plain-string catalog per lens) that fill the input on click (no submit), plus
recent history as quick re-runs. Wired into all three lenses; the idle guard relaxes to `status ===
'idle'`.

**Codex type visuals.** The exhaustive `ENTITY_TYPE_COLOR`/`ENTITY_TYPE_ICON` maps (ADR-046,
`lib/entity-visuals.tsx`) now drive the Codex filter chips, entity-row badges, `EntityBadge` (replacing
its old binary PC-vs-others color + 3-letter abbreviation), the EntityDetail pill, and the command-palette
entity rows — so Codex and Web read as one system.

## Consequences

### Positive
- The app chrome is consistent view-to-view; the reading panes are no longer top-heavy/bare.
- The AI lenses give first-time users obvious entry points instead of dead space.
- The nav communicates the Capture → World → Ask loop; type is scannable everywhere by color + icon.

### Negative / Risks
- A broad, mechanical change across ~20 renderer files. Mitigated by the exhaustive `Record<…>`
  compile-guards, Prettier, and a green typecheck/lint/suite.
- The lens starter catalogs are plain example strings (not the slotted `RECALL_PROMPTS`), a deliberate
  simplification — the slot flow still lives in Lore's "Prompts" dropdown.
- Not re-exercised live in the packaged app yet (needs a rebuild + reinstall).

## Related Decisions
- Builds on **ADR-046** (per-type color/icon system) and **ADR-040** (Web view).
- Revisits the header/`PaneShell` conventions from the 2026-07-02 chrome consolidation and the nav order
  of ADR-044.

## References
- Chrome: `components/chrome.tsx` (`PaneHeader`/`PaneBody`). Lenses: `components/lens/LensIdle.tsx`,
  `lib/lens-starters.ts`. Nav: `lib/nav-items.tsx`, `components/layout/Sidebar.tsx`. Codex visuals:
  `components/entities/{EntityBrowser,EntityBadge,EntityDetail}.tsx`, `components/CommandPalette.tsx`.
