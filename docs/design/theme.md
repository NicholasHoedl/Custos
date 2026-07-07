# Theme — Grim Dark-Fantasy ("the Ledger")

**Status:** Implemented. The re-theme shipped across the renderer — palette, typography touches, the
glossary, the death motif, and a targeted Keeper voice. This doc is the as-built reference.
**Date:** 2026-07-06
**Owner:** Solo developer

## Direction

- **Degree:** *themed but clear* — evocative fantasy names that stay immediately obvious; theme the
  hero surfaces, not utilities.
- **Tone:** *grim / dark-fantasy* (Souls / Witcher / Darkest Dungeon register) — charcoal, ash, ember, dread.
- **Voice:** *targeted* — the Keeper register lands on high-visibility copy (empty/idle states, key
  toasts, the Fallen footer); functional micro-copy (field labels, error details, example queries)
  stays plain.
- **No taglines.** The wordmark stands alone — there is no subtitle under "Ledger" (an explicit
  directive; the old "Phase 1 · capture" footer was removed too).

## The spine

The app is named **Ledger** — a cold tally of debts, deeds, and the dead. The Ledger is a grim record
that remembers everything and outlives everyone in it. The AI is a single persona, **the Keeper**, who
consults the lore, gives counsel, and transcribes your scattered pages. One metaphor, names reinforcing.

## Glossary (as shipped)

Labels only — `type` / `lifecycle` / `confidence` remain stored values, so nothing here needed a
migration. The centralized `Record<Enum, label>` maps in `src/shared/entity-types.ts` are the single
rename point, compile-guarded by exhaustive typing.

| Surface | Shipped term | Notes |
|---|---|---|
| App identity | **Ledger** (kept) | wordmark only — no subtitle |
| The AI | **the Keeper** | one persona; surfaces in high-visibility copy |
| Journal | **Chronicle** | the running log (internal table stays `event_log`) |
| Capture (entity hub) | **Codex** | the reference collection |
| Recall | **Consult** | consult the Keeper |
| Suggest | **Counsel** | in-character ideas for the table |
| Settings | **Settings** (kept) | utilities are not themed |
| Add entity | **Inscribe** | inscribe an entry into the Codex |
| Notes | **Annals** | free-form records |
| Recap | **Previously…** | a "previously on…" of a session |
| Import | **Transcribe** | the Keeper copies your scattered pages |
| Campaign | **Saga** | renamed everywhere in user copy (incl. Settings' export) |
| Session | **Session** (kept) | — |
| Main character / PC | **Main character / Player Character** (kept) | "Champion" shipped, then reverted at the user's request |
| Scene | **Scene** (kept) | already a story term |
| Relationships | **Ties** | — |
| "as of session N" | **"as of Session N"** | `Chronology` stays internal (avoids a Chronicle clash) |
| Note confidence | **Known · Hearsay · Whispered** | confirmed / rumored / suspected |
| Lifecycle | **Active · Fallen · Presumed lost** | (stored) ended / presumed_ended |

### Entity types (labels only — no migration)

| Type | Shipped term |
|---|---|
| NPC | **NPC** (kept) |
| Location | **Location** (kept) |
| Faction | **Faction** (kept) |
| Quest | **Quest** (kept — clearer than "Contract") |
| Item | **Item** (kept) |
| Player Character | **Player Character** (kept) |
| Event (world history) | **Event** (kept) |
| Creature | **Creature** (kept) |

Naming picks are label-level and trivially flippable — one edit in the `Record<EntityType, …>` map.
**The four entity-type renames (Haunt / Champion / Legend / Monster) were shipped, then reverted to the
plain terms above at the user's request** (incl. the "Haunt" scene picker and the "Champion"
main-character copy). The rest of the glossary stands.

## Visual system

### Palette — *Ash & Ember*

Lives in the single theme file `src/renderer/src/styles/globals.css` (Tailwind v4 `@theme inline`,
dark-only). Named raw tokens → semantic role tokens (`--background` / `--foreground` / `--primary` / …)
→ Tailwind utilities; every component resolves through the roles, so switching palettes is a
single-file token swap with **no per-component color edits**. `--pewter` and `--blood` are exposed as
utilities via `--color-metal` / `--color-blood` (`text-metal`, `text-blood`, `decoration-blood`, …).

```
--char           #141210   warm charcoal near-black — background
--char-sidebar   #100D0B   sidebar
--char-raised    #1E1A16   raised surface — card / muted
--char-inset     #26201A   inset
--iron           #34302A   default hairline / border
--bone           #E8E2D6   bone-white — foreground text
--bone-dim       #C7BFB2   body copy
--ash            #8C8377   muted / warm ash grey
--ember          #D2732E   accent — primary, active rules, focus
--ember-deep     #7C3E1D   hover / active fills
--blood          #B23A2E   dried blood — death, enmity, destructive
--pewter         #9E9DA2   cool pewter — inscribed labels, wordmark
```

Previously **Crypt & Verdigris** (green-black + verdigris-teal + tarnished bronze); switched to the
warmer, torchlit Ash & Ember at the user's request. The accent (ember) and death (blood) share a warm
family, so the death cues lean on the strike + skull + ghosting to separate — not hue.

### Typography

- Display **Fraunces**; body **Bricolage Grotesque**; mono **JetBrains Mono** (all bundled + wired).
- The **`.inscribed`** utility (small-caps, letter-spaced, `--pewter`) marks section labels
  (Ties / Annals / Persona) so they read like tomb inscriptions. The LEDGER wordmark uses the same
  register (pewter, letter-spaced).

### Death as a motif (the distinctive move)

The existing lifecycle + note-confidence model *becomes* the visual language — impossible to mistake
for generic AI beige:
- **Fallen** = name struck through + a `--blood` skull (in both EntityDetail and the entity list);
  **Presumed lost** = ghosted + a faint skull. A single Keeper line closes a Fallen entity's page:
  *"Another name for the Ledger of the Fallen."*
- **Confidence** on Annals: Known = unmarked · Hearsay / Whispered = a dashed mark (`CircleDashed`) in
  pewter (`text-metal`).

### Vignette

A global, non-interactive candle-vignette (a radial-gradient overlay in `AppShell`) darkens the edges
without covering portalled dialogs.

### App icon

`build/icon.svg` (source) → `build/icon.png` 1024 (electron-builder packaging) + `resources/icon.png`
256 (`BrowserWindow.icon`, wired in `src/main/index.ts`). An iron-bound ledger: a pewter cover frame,
two ember entries, and a third struck through in blood — the Fallen motif. Rasterized with `sharp`.

## The Keeper's voice (as shipped — restrained)

Targeted, not pervasive. Where it lands:
- Empty / idle states, lightly — e.g. Consult idle: *"The Keeper's answer appears here, drawn from your
  annals."*; empty Chronicle: *"No chronicle entries yet."*
- Key toasts: *"Chronicle entry recorded"*, *"Main character set"* / *"cleared"*, *"Saga created"*.
- The Fallen footer (above).

Deliberately left plain: field placeholders, error details, example queries, and the changeset-review
surface. The florid candidate lines from the original brainstorm (e.g. "patient as the grave") were
dialed back for clarity.

## Implementation notes (as-built)

- ~95% was **UI copy + label maps** — no migration, low risk. Entity-type / lifecycle / confidence
  labels are all UI-only (`src/shared/entity-types.ts`); the exhaustive `Record` typing compile-guards
  the renames.
- **Internal names stay** (`event_log`, IPC channels, `ViewKey` / panel keys) — a copy/label re-theme
  only, mirroring the internal-vs-external split (ADR-019/023).
- **Utilities not themed:** Settings takes the *Saga* noun for consistency but no grim voice; form field
  labels (Name / Description) and error details stay plain.
- **Collision watch:** Chronicle (Journal) ≠ Chronology (as-of); Codex / Chronicle / Saga are three
  distinct book/story words with distinct roles — kept deliberate.
