# ADR-065 — Appearance preferences: interface scale, base temperature, reading font, grain

- **Status:** Accepted
- **Date:** 2026-07-18
- **Extends:** ADR-024 (Ash & Ember retheme), ADR-046 (Web-graph type hues)
- **Revisits:** ROADMAP R-1/R-2 (the removed `fontSize` / `theme` stubs)

## Context

Until now the only appearance control was the accent hue (`[data-accent]`, twelve options). Two pressures
made that too narrow:

1. **Custos is prose-heavy and read at a table.** Chronicle logs, Lore answers, recaps and notes are walls
   of text, often read on a laptop at arm's length across a game table. There was no way to make any of it
   bigger.
2. **The accent set grew cold.** Adding steel blue, verdigris and indigo put cold hues on a deliberately
   *warm* charcoal ground — a tension baked into the palette, with no way to resolve it.

A `fontSize` setting had existed before as a declared-but-never-read stub and was deliberately removed
(ROADMAP R-1). Re-adding one needed to be visibly different: actually wired, end to end.

## Decision

Add four preferences, each applied as a `[data-*]` attribute on `<html>` — the exact mechanism the accent
already uses — with all theming staying declarative in `globals.css`:

| Preference | Attribute | Values (default first) |
|---|---|---|
| Interface scale | `data-ui-scale` | `comfortable` · `compact` · `spacious` |
| Base temperature | `data-base` | `warm` · `cold` |
| Reading font | `data-reading-font` | `sans` · `serif` |
| Background texture | `data-texture` | `none` · `grain` |

**Every block overrides RAW tokens only, never semantic roles.** This is the load-bearing invariant: it
keeps the four orthogonal to the eleven accent blocks, so no combined `[data-accent][data-base]` selectors
are needed, and it is why `WebView`'s `getComputedStyle(...).getPropertyValue('--char')` PNG export follows
the base change for free.

`renderer/lib/appearance.ts` holds the label metadata, a `normalizeAppearance()` clamp, `applyAppearance()`
and `bootstrapAppearance()`. It delegates the accent to `applyAccent()` rather than writing `[data-accent]`
itself, so `accent.ts` remains that attribute's sole owner.

### Interface scale is a zoom, not a text size

Setting the root `font-size` scales far more than type: Tailwind v4's spacing scale is
`calc(var(--spacing) * N)`, so padding, gaps, widths, heights and radii all move with it. We chose to
embrace that and name it "Interface scale" rather than fight it.

This required converting the **86 hardcoded `text-[Npx]` utilities to rem** across 29 files. Without that,
the 288 standard `text-sm`/`text-xs` utilities would scale while arbitrary px stayed pinned — visibly
compressing, and in places inverting, the type hierarchy at Spacious. The conversion is pixel-identical at
the 16px default. `WebView`'s SVG `fontSize={…}` JSX props are attributes, not classes, so they are
untouched and correctly stay fixed to the canvas.

## Alternatives considered

- **`webFrame.setZoomFactor`** — the obvious one-liner, rejected. Browser zoom scales border widths too,
  giving 1.125px hairlines and blurry rules on DPR-1 displays. With the rem approach, Tailwind's px borders
  and its rem breakpoints both stay put (rem inside a media query resolves against the *initial* root size),
  so hairlines stay crisp and the layout never crosses a breakpoint just because the user zoomed.
- **A text-only scale** (overriding `--spacing` to a px value to decouple it) — verified to work, but type
  then outgrows fixed containers: portrait initials, button heights, sidebar label truncation. A long tail
  of overflow bugs for a less coherent result.
- **Hooking the reading font to `PaneBody size="reading"`** — rejected: that prop is a *width* concept, and
  its consumers include the Home dashboard and the Continuity/Converse card chrome, none of which is prose.
  The font is applied to the ~11 genuine prose elements instead.
- **An inline `<script>` in `index.html`** for the pre-paint bootstrap — impossible: the packaged CSP is
  `script-src 'self'` with no `'unsafe-inline'`.

## Consequences

- **The pre-paint bootstrap is partial, by design.** `bootstrapAppearance()` runs from `main.tsx` before
  `createRoot()`, which eliminates the *reflow* (React hasn't rendered, so nothing repositions). A brief
  background-hue flash on the still-empty root can remain. Accepted rather than `body { visibility: hidden }`,
  which fails open into a blank window if the bootstrap ever throws.
- **A new untrusted input.** The `localStorage` mirror joins `settings.json` (which the main process spreads
  unvalidated) as a source of arbitrary values. `normalizeAppearance()` is the single clamp guarding both.
- **`font-reading` must never meet `font-display`.** `twMerge('font-display','font-reading')` resolves to
  `font-reading`, so applying it to a Fraunces heading would silently destroy that heading at default
  settings. `import-rows.tsx:269` is deliberately excluded for exactly this reason — its row already sets
  `font-display italic`.
- **Warm graph hues under a cold base.** The `--type-*` heraldry stays warm and will read slightly muddy on
  the cold ground. Left as-is: ADR-046 already places the graph outside the single-accent register.
- **Two combinations to watch:** cold × parchment and cold × yellow are the warmest accents on the coldest
  ground, and are where the 24 accent/base pairings look worst.
- **The grain does not appear in the Web PNG export** — it is a DOM overlay, not part of the canvas.
- Three hand-synced points per preference now exist (shared union, CSS block, renderer metadata), as with
  the accent. `tests/unit/renderer/appearance.test.ts` guards the clamp and asserts a CSS block exists for
  every union member — a drift check the accent system never had.
