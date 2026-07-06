# ADR-023: Post-journal capture & UI refinements (removals + relocations)

## Status

Accepted

**Date:** 2026-07-06
**Deciders:** Solo developer

## Context

Shipping journal-driven capture (ADR-022) — plain-entry logging with AI extraction — made several older
surfaces redundant, misplaced, or below the quality bar. This ADR records the resulting cleanup as one
decision so the docs reflect the app as it now is. **None of these reverse a load-bearing engine
decision:** the changeset-v2 extraction engine (ADR-014/018), the "current scene" concept (ADR-015), and
the global quick-add hotkey (ADR-010) all stand — only their *UIs* moved, merged, or were retired.

## Decision Drivers

* One primary capture path, not several overlapping ones (Journal + Quick-add + Backfill + the in-Capture
  session-log panel were all versions of "get things into the campaign").
* Put a control where it is used; drop controls that don't pull their weight.
* Retain reusable engines and any logic that might return — delete only UI.
* Keep the surface honest: pull a feature that isn't at the quality bar (in-character Recall) rather than
  ship it half-working.

## Decision

**1. Capture entry: Quick-add → full Add-entity form.** The keyboard-first Quick-add bar (name → type →
optional first note) is **removed**. Entity creation now opens the **full entity profile form**
(`EntityForm` create mode: description, traits, goals, status, type-specific fields, custom attributes)
from an "Add entity" button atop the entity browser. The global quick-add hotkey / `Ctrl+K` (ADR-010) is
**retargeted** to open this form — the hotkey decision stands; only its target changed. The Journal is the
fast at-the-table path now, so a minimal, lossy quick bar was redundant.

**2. Recall in-character mode: retired from the UI (logic retained).** The in-character/factual toggle and
its persona-voiced answers were not at the quality bar. The **UI control is removed** and Recall answers
factually. The `recall.service` / `claude.service` in-character path, the persona system, `RecallMode`,
and the IPC all **remain**, so restoring it is a UI-only change.

**3. Scene picker: relocated sidebar → Suggest pane.** The "current scene" controls (ADR-015) moved out of
the always-present sidebar into the **Suggest** view, where they are most used. The scene state stays
global and still feeds **both** Recall and Suggest grounding — only the picker moved.

**4. Backfill interview: removed; capability folded into Import.** The roster-then-beats interview
(ADR-018) is **removed**. Its **changeset-v2 engine** — status/relationship extraction with session-stamped
apply — is retained and now powers the Journal and **Import**, which gains an optional **target-session
setter** (current session / a specific past session / undated). Import therefore absorbs Backfill's only
distinct capability — notes taken elsewhere or handed over by another player tie to the right session — so
nothing is lost.

**5. Journal replaces the in-Capture session-log panel.** The Journal is a **top-level view only**; the old
"session log" panel inside Capture is removed. Capture's panels are now **Notes / Recap / Import**, killing
a redundant second entry point to the same feed.

## Rationale

All five reduce surface area or move it closer to use without touching an engine. The only genuinely removed
*capability* is Backfill's UI, and its engine plus a session setter on Import cover that use case. The one
quality-driven removal (in-character Recall) is left **dormant, not deleted**, so it can return once it
clears the bar.

## Consequences

### Positive
- One primary capture path (Journal) + one deliberate full-detail path (Add entity); Import is the general
  "paste from anywhere, tie to a session" tool; the sidebar is lighter; the scene lives with the feature
  that uses it.
- No half-quality feature ships: in-character Recall is off until it's good.

### Negative
- Entity creation is no longer a ~10-second quick bar — it is the full form (the hotkey still opens it),
  and Quick-add's inline "first note" is gone (notes come from the Notes pane / Import / Journal).
- In-character Recall is unavailable until re-enabled.
- ADR-010 / ADR-015 / ADR-018 now describe UIs that moved or were removed — they stay as historical record;
  this ADR is the current state.

### Risks & Mitigations
- **Dark in-character Recall logic bit-rots** → it rides the same `claude.service` paths and is covered by
  the existing recall-prompt tests.
- **Import silently applies status/relationship changes** → they are rendered and per-item toggleable in the
  shared `ChangesetReview` before apply, exactly as the Journal does.

## Related Decisions

- ADR-022 — the Journal, whose arrival prompted this cleanup.
- ADR-010 — global quick-add hotkey; its target is now the Add-entity form (decision otherwise stands).
- ADR-015 — current scene; concept unchanged, picker relocated to the Suggest pane.
- ADR-018 — backfill interview; its UI is removed, its changeset-v2 engine retained in Import + the Journal.
- ADR-014 — the import extract→review→apply engine that Import and the Journal share.

## References

- Removed: `src/renderer/src/components/capture/QuickAddBar.tsx`, `src/renderer/src/components/views/BackfillView.tsx`
- `src/renderer/src/components/entities/EntityBrowser.tsx` (Add-entity button + `EntityForm`),
  `src/renderer/src/components/views/CaptureView.tsx` (Quick-add + session-log panel removed)
- `src/renderer/src/components/scene/SceneControls.tsx` (extracted from the sidebar),
  `src/renderer/src/components/views/SuggestView.tsx` (hosts the scene picker)
- `src/renderer/src/components/views/RecallView.tsx` (in-character UI removed),
  `src/renderer/src/hooks/use-recall.ts` (mode plumbing retained)
- `src/renderer/src/components/views/ImportView.tsx` (`withChanges` + target-session setter),
  `src/renderer/src/components/capture/ChangesetReview.tsx`
- `../../SPEC.md` §10, `../../ARCHITECTURE.md`
