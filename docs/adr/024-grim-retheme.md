# ADR-024: Grim dark-fantasy re-theme ("Ash & Ember")

## Status

Accepted

**Date:** 2026-07-06
**Deciders:** Solo developer

## Context

The renderer shipped on the original Phase-0 palette — a cool cyan/slate "charcoal-teal canvas with one
vivid cyan accent" (ARCHITECTURE §1). It was clean but generic, and it never carried the *mood* of the
product: Ledger is a cold tally of "debts, deeds, and the dead," a grim record that outlives everyone in
it. A standing developer directive (recorded in agent memory) is that the UI must be **distinctive, never
generic AI beige** — a recurring failure mode. The visual identity had drifted from the product's spine.

This is a **copy + color** re-theme, not a data change: entity `type` / `lifecycle` / note `confidence`
are stored values, and the centralized `Record<Enum, label>` maps in `src/shared/entity-types.ts` are the
single rename point (compile-guarded by exhaustive typing). So the whole re-skin is achievable with **no
migration**.

## Decision Drivers

* **Distinctive, not generic.** The identity must come from committed palette + typography + motif, not
  from recoloring stock components (the explicit anti-beige guardrail).
* **Themed but clear.** Evocative fantasy names that stay instantly obvious; theme the hero surfaces, not
  utilities. A player at the table must never be slowed down by the theme.
* **Cheap to change / cheap to revert.** Palette as a single-file token swap; labels as one edit per map.
* **No data risk.** Labels only — no migration, no schema touch (mirrors the internal-vs-external split of
  ADR-019/023: `event_log`, IPC channels, and `ViewKey`s keep their internal names).

## Considered Options

### Option 1: Keep the cyan/slate palette
- **Pros:** zero work; already shipped.
- **Cons:** generic; disconnected from the product's grim premise; fails the anti-beige directive.

### Option 2: "Crypt & Verdigris" (green-black + verdigris-teal + tarnished bronze)
- **Pros:** grim, distinctive, tomb-like.
- **Cons:** the cool green read as damp/mildew rather than torchlit; less warmth for a "hearth-side record."

### Option 3: "Ash & Ember" (warm charcoal / bone / dying-ember accent / dried blood)
- **Pros:** torchlit warmth over charcoal; the ember accent doubles as candlelight; death (blood) sits in a
  warm family with the accent, so a coherent single-hue world.
- **Cons:** ember (accent) and blood (death/destructive) are close in hue — death cues can't rely on color
  alone.

## Decision

Ship a **grim dark-fantasy re-theme** on the **Ash & Ember** palette (Option 3):

1. **Palette** — a single-file token swap in `src/renderer/src/styles/globals.css` (Tailwind v4
   `@theme inline`, dark-only): warm charcoal near-black background, bone-white text, a dying-**ember**
   accent (`#D2732E`), dried-**blood** death/destructive (`#B23A2E`), cool **pewter** for inscriptions.
   Named raw tokens → semantic role tokens → utilities, so every component resolves through roles.
2. **Glossary** (labels only) — the AI is **the Keeper**; Recall → **Consult**, Suggest → **Counsel**,
   Capture → **Codex**, Journal → **Chronicle**, Import → **Transcribe**, Notes → **Annals**, Recap →
   **Previously…**, Campaign → **Saga**, Relationships → **Ties**; confidence → **Known / Hearsay /
   Whispered**; lifecycle → **Active / Fallen / Presumed lost**.
3. **Death as the motif** — the existing lifecycle + confidence model *becomes* the visual language:
   Fallen = struck-through name + a blood skull; Presumed lost = ghosted + faint skull; Hearsay/Whispered =
   a dashed pewter mark. Because ember ≈ blood in hue, death leans on **strike + skull + ghosting**, not color.
4. **Keeper voice, targeted** — grim register only on high-visibility copy (empty/idle states, key toasts,
   the Fallen footer); field labels, error details, and example queries stay plain.
5. **App icon + vignette** — an iron-bound ledger cover (pewter frame, two ember entries, a third struck in
   blood) recolored to the palette; a global candle-vignette overlay in `AppShell`.

**Entity-type renames were shipped, then reverted at the user's request.** Haunt / Champion / Legend /
Monster briefly replaced Location / Player Character / Event / Creature; they were rolled back to the plain
terms (a one-line edit per map). The rest of the glossary stands.

## Rationale

Ash & Ember delivers the grim identity the product always implied while keeping the app legible at the
table — the theme lands on hero surfaces and leaves utilities alone. Anchoring the visual language in the
**data we already model** (lifecycle + confidence → strike/skull/ghost/dash) makes the identity structural
and impossible to mistake for recolored stock components, satisfying the anti-beige guardrail without
skeuomorphic parchment. Everything is labels + tokens, so the cost — and the blast radius — is minimal, as
the entity-rename reversal demonstrated.

## Consequences

### Positive
- A committed, distinctive identity tied to the product's premise; the death motif is a genuinely novel move.
- Palette and labels are trivially adjustable (single-file token swap; one edit per label map) — proven by
  switching Crypt & Verdigris → Ash & Ember and by reverting the entity-type names.
- No migration, no schema/IPC change; internal names are untouched.

### Negative
- Ember (accent) and blood (death) are near in hue; anything new that signals death **must** use a
  non-color cue (strike / skull / ghost), or it will blend into the accent.
- ARCHITECTURE §1's original cyan/slate palette is now historical; the source of truth for color moved to
  `docs/design/theme.md`.

### Risks & Mitigations
- **Theme creep makes utilities cryptic** → the "themed but clear" rule; Settings and field labels stay plain.
- **Name collisions** (Chronicle vs. Chronology; Codex / Chronicle / Saga) → kept deliberate and documented
  in `theme.md`; `Chronology` stays an internal term to avoid clashing with the Chronicle (Journal) label.

## Related Decisions

- ADR-019 / ADR-023 — the internal-name-vs-external-label split this re-theme rides on (stored values keep
  their names; only UI copy changes).
- ADR-017 (chronology) / ADR-021 (note confidence) — the lifecycle + confidence models the death motif
  renders visually.

## References

- `docs/design/theme.md` — the as-built reference (full palette tokens, glossary table, motif, Keeper voice).
- `src/renderer/src/styles/globals.css` (palette), `src/shared/entity-types.ts` (label maps),
  `src/renderer/src/components/layout/AppShell.tsx` (vignette + wordmark),
  `build/icon.svg` → `build/icon.png` / `resources/icon.png`, `src/main/index.ts` (`BrowserWindow.icon`).
- Agent memory: "Frontend — avoid generic beige aesthetics."
