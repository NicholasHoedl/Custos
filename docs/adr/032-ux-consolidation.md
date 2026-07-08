# ADR-032: UX consolidation — navigation, naming, copy, and editability

## Status

Accepted — **implemented**. A consolidation pass after a full design audit (three evidence-backed sweeps:
information architecture, editing surfaces, AI-flow consistency). Verified: typecheck + lint + the full
suite (205 tests). No schema change.

**Date:** 2026-07-08
**Deciders:** Solo developer

## Context

Rapid incremental feature growth (main character, the Character dashboard, Converse, the two-step Draft
tool, standing-relationship extraction) left the app internally coherent but seam-heavy: navigation that
tracked feature *history* rather than *function*, copy written per-surface and never centralized, capability
asymmetries (things you could create but never edit; a field you could write but never see), two real bugs,
and dead code stranded by the MC/Codex-redirect evolution. The audit catalogued it with file:line evidence;
this ADR records the fixes.

## Decision

### 1. Navigation restructure
- **Sessions** becomes a top-level view (`views/SessionsView.tsx`) — a browsable list of sessions with
  their summaries, hosting the **Previously…** recap generation per session (`components/sessions/
  SessionRecap.tsx`, extracted from the old standalone RecapView) and each session's chronicle entries
  (read-only). This gives session summaries a home they never had.
- **Transcribe** is promoted to a top-level view (it was buried in Codex despite driving the *same*
  changeset engine as top-level Chronicle).
- **Codex** slims to **Inscribe + Annals** (`CapturePanel = 'add' | 'notes'`); its Previously…/Transcribe
  rail tabs are gone. The standalone `RecapView` is deleted; the sidebar's session dialogs are lifted to
  `components/sessions/SessionDialogs.tsx` and shared by the sidebar switcher and the Sessions view.
- Final nav: **Character · Chronicle · Sessions · Codex · Lore · Counsel · Converse · Transcribe · Settings.**

### 2. Naming
- **Consult → "Lore"** (resolves the Consult/Counsel near-homophones; Counsel keeps its name). Label-only,
  per the ADR-024 convention — internal code names (`recall`) are unchanged.
- The Character page's derive tool is renamed **"Draft from backstory"** (it was labeled "Suggest",
  colliding with the nav's Counsel — internally the `suggest` feature — and matching no nav label).
- **The assistant is "the Keeper" in-app**; "Claude"/"Anthropic" appear only in Settings + the onboarding
  API-key/model steps, where the real vendor is genuinely relevant. (It was previously "the Keeper",
  "Claude", and "the AI" interchangeably — sometimes in one view.)
- Settings model headings fixed to **Lore model** / **Counsel model** (were "Recall model" / "Suggest").

### 3. Copy centralization
- One shared **`lib/ai-copy.ts` `reasonCopy(reason)`** replaces seven hand-rolled failure→copy maps. As
  part of this, `classifyError` (`ai-util.ts`) now returns **`bad_key`** distinct from `no_key`, and the
  Lore/Counsel/Converse/Recap failure unions gained a `bad_key` case — a rejected key was previously
  diagnosed as a generic error on those four surfaces.
- A shared **`EmptyState`** (chrome) unifies the no-campaign states (three drifted shapes before), and a
  shared **`InfoPopover`** (chrome) carries the "what does this do + best practices" affordance — now on
  **Counsel** (the app's most complex input, which had none) as well as the Draft tool.
- Section eyebrows standardize on the house **`.inscribed`** class; dialog dismiss verbs, destructive
  confirms, and busy labels ("Saving…"/"Creating…"/"Adding…") were regularized.

### 4. Editability
- **Notes** are editable everywhere: a shared `NoteList` (`components/notes/`) with an inline edit/delete
  affordance replaces the delete-only lists on EntityDetail and the Character dashboard (`note.update` was
  already wired but reachable from only one surface).
- **Ties** gain `link.update` (service + IPC + preload) so a relationship's "why/context" description is
  editable in place, instead of delete-and-recreate.

### 5. Bug fixes
- The relationship-editor's global **'L' shortcut** is scoped to the visible pane (a `offsetParent` check)
  — MainPanel keeps every view mounted, so the window listener previously fired app-wide and could stack
  two link dialogs.
- **NPC flaws** now render in EntityDetail (they were write-only — enterable but never displayed).
- **Main-character search hits** route straight to the Character page instead of the Codex redirect detour.
- **Chronicle** offers an in-pane "Start session" when a campaign has none (it previously dead-ended on the
  default view).

### 6. Dead code
- Removed EntityForm/EntityDetail's unreachable main-character-only branches (voice input/display, the
  PersonaEditor gate, backstory-field gating) — Codex redirects the MC, so `isMainCharacter` was provably
  always false there. Deleted the unused `PlaceholderView`; fixed stale comments. The Recall in-character
  plumbing stays (retained by design, ADR-023).

## Consequences

### Positive
- Navigation matches function; sessions/summaries have a home; the two capture flows sit together.
- One voice for failure copy and the assistant; the richest surface (Counsel) finally explains itself.
- Symmetric editability for notes and ties; no more write-only fields.

### Negative / Risks
- The nav grows to **9 items** (accepted). The Sessions view + the RecapView→SessionRecap extraction are
  the largest moving parts; verified by the suite + manual walkthrough.
- Renames ripple through docs; the label↔code-name split (Lore=`recall`, Counsel=`suggest`) remains a
  reader's-map item, mitigated by keeping it label-only and documented in the glossary.

## Related Decisions

- ADR-024 (the label/code-name split convention this follows), ADR-027 (scene = Counsel-only, the stale
  SceneControls comment this corrects), ADR-030 (the Character page whose redirect makes the removed
  branches dead), ADR-023 (the retained in-character Recall plumbing).

## References

- New: `views/SessionsView.tsx`, `components/sessions/{SessionRecap,SessionDialogs}.tsx`,
  `components/notes/{NoteList,NoteEditDialog}.tsx`, `lib/ai-copy.ts`; `chrome.tsx` `EmptyState`/`InfoPopover`.
- Backend: `ai-util.ts` (`classifyError` → `bad_key`), `link.service.ts` (`updateLink`) + IPC/preload.
- Removed: `views/RecapView.tsx`, `views/PlaceholderView.tsx`, EntityForm/EntityDetail MC-only branches.
