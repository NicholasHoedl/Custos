# Ledger — project guide for coding agents

Local-first desktop app for tracking a tabletop RPG campaign with a time-aware, AI-backed memory
(Character · Chronicle · Sessions · Codex · Lore · Counsel · Converse · Transcribe — see the label↔code-name
note below; chronology is time-aware throughout). This file is the fast
orientation for an agent with fresh context — it complements, and does not repeat, the human docs:

- [`README.md`](README.md) — stack, getting started, scripts, where your data lives.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — components, data model, RAG pipeline, IPC, folder map (§8).
- [`SPEC.md`](SPEC.md) — product spec; §10 lists everything shipped beyond the MVP.
- [`docs/adr/`](docs/adr/README.md) — the *why* behind every significant decision. Read **ADR-017**
  (chronology) and **ADR-021** (creature type · note confidence · campaign-lore notes) before you
  touch the entity or note model; **ADR-004** before you touch migrations.

## Layout (three process zones)
Electron · React 19 · TS · Tailwind 4 + shadcn/ui · Zustand · SQLite (better-sqlite3) + Drizzle ·
Transformers.js embeddings · Anthropic SDK (main-process only).
- `src/main` — IPC handlers (`ipc/`), services (`services/`), DB (`db/`). All privileged work.
- `src/renderer` — React UI (`views/`, `components/`, `hooks/`, `store/`). No Node/DB/network access;
  it talks to main only through the typed `window.ledger` bridge (`src/preload`).
- `src/shared` — types + pure helpers imported by BOTH processes (`entity-types`, `entity-profiles`,
  `relations`, `lifecycle`, `*-types`, `ipc-types`). Keep this side-effect-free and Electron-free.

## Commands
`npm run dev` (hot reload) · `npm test` (Vitest under Electron-as-Node) · `npm run typecheck` ·
`npm run lint` · `npm run build` · `npm run dist` (Windows installer) · `npm run db:generate`
(Drizzle migration from `schema.ts`). Run typecheck + lint + test before calling anything done.

## Invariants & gotchas (the non-obvious things)
- **Restart the whole app after `src/main`, `src/preload`, or `src/shared` edits.** `npm run dev` HMR
  only reloads the renderer; main/preload/shared changes (and any new migration) need a full stop/start.
- **Migrations are hand-authored SQL**, split by `--> statement-breakpoint`, run once on launch after a
  DB backup. Adding/altering a column ⇒ the SQLite *table-rebuild* pattern (`CREATE __new_x` → `INSERT
  SELECT` → `DROP` → `RENAME` → recreate indexes); see `drizzle/0004` and `0006`. `migrate()` is wrapped
  in `foreign_keys=OFF` (ADR-004, `src/main/db/index.ts`), so a `PRAGMA foreign_keys` inside a migration
  is a no-op within the txn. Flow: edit `schema.ts` → `npm run db:generate` → hand-fix the generated
  `.sql`, keep `_journal.json` + the snapshot. Currently **10 migrations (0000–0009)**.
- **`lifecycleHeuristic` (`src/shared/lifecycle.ts`) MUST mirror migration 0005's SQL `CASE`** — an
  invariant asserted by `chronology.service.test.ts`. Never change one without the other.
- **`entity.type` and `entity.lifecycle` are free-text TEXT** (no CHECK): a new entity type or lifecycle
  value needs NO migration. The `Record<EntityType, …>` maps (`entity-profiles`, labels) force an
  exhaustive per-type entry at compile time — that is the guardrail; lean on it.
- **Entity state is one control.** The entity form has a single **Status** combobox; `lifecycle` is
  derived, not user-picked — status presets carry an explicit lifecycle (`entity-profiles.StatusPreset`),
  free text runs through `lifecycleHeuristic`, and a "presumed" checkbox flips `ended ↔ presumed_ended`.
  There is no separate Lifecycle dropdown.
- **A note may tag zero entities** (campaign lore, ADR-021) via the manual NotesView — retrieval and the
  Recall "Sources" list handle null-entity chunks. But paste-and-extract **Import deliberately still
  requires ≥1 entity per note** (an untagged extracted note is noise); don't "relax" the extraction
  prompt to allow untagged notes.
- **Changeset field changes are existing-only + un-versioned** (ADR-028). Chronicle/Transcribe extraction
  (`withChanges`) proposes a fourth change kind — add/cut/alter to an *existing* entity's
  `traits`/`goals`/`flaws` or a per-type attribute — alongside status/relationship changes. Apply is a
  plain `updateEntity` inside the batch txn (NO status-history row; NOT chronology-versioned) that
  re-reads per change and recomputes the whole list/object (updateEntity REPLACES), so intra-batch edits
  to one field compound. `validateExtraction` drops `#index` (new) refs, off-profile fields
  (`profileFor`), and list cut/alter whose `oldValue` doesn't match a current item;
  `buildExtractionUserContent` surfaces current fields ONLY for text-mentioned entities and ONLY when
  `withChanges`. **No migration** (reuses existing columns). Relationship items are proposed for
  **STANDING ties** the text establishes (family/membership/ownership/residence — `CHANGES_INSTRUCTIONS`
  glosses the relation vocabulary, `related_to` = family), not just narrated form/sever; the backstory
  flow passes `backstorySubjectId` so ties anchor to the MC (ADR-030 v3). **Dedup (ADR-031):**
  `validateExtraction` drops verbatim-duplicate notes (normalized, vs existing notes + intra-batch) and
  flags near-dupes (`possibleDuplicate` → review seeds them OFF with a badge), drops `form` ties whose
  live edge already exists (`findOpenLink`) + direction-equivalent intra-batch dupes (`canonicalRelKey`),
  and drops status/scalar-field no-ops — re-running the same text yields a near-empty changeset.
  Extracted statuses SNAP to the type's curated presets (case-insensitive → canonical label + the
  preset's EXPLICIT lifecycle, the only path to `presumed_ended`; `STATUS_VOCAB` in the prompt is
  generated from `ENTITY_PROFILES`; free text stays allowed).
- **AI-grounding seams:** `formatState` + `buildUserContent` / `buildSuggestUserContent` /
  `buildConverseUserContent` in `claude.service.ts` are where entity state (lifecycle → `[ended]` /
  `[presumed ended — unconfirmed]`), relationships, and note `confidence` (→ `· (rumored)` / `· (suspected)`,
  via the shared `confidenceTag`) get injected. Change what the model is told *here*.
- **UI label ↔ code name (ADR-024/032):** the nav labels are Character · Chronicle · **Sessions** · Codex ·
  **Lore** · **Counsel** · Converse · **Transcribe** · Settings; the code names stay `recall` (Lore),
  `suggest` (Counsel), `journal` (Chronicle), `capture` (Codex), `import` (Transcribe). Sessions +
  Transcribe are TOP-LEVEL views (ADR-032 promoted them out of Codex, which is now Inscribe + Annals only);
  Previously…/recap lives in the Sessions view (`SessionsView` + `components/sessions/SessionRecap`). The
  assistant is **"the Keeper"** in-app; "Claude"/Anthropic only in Settings + onboarding. Shared failure
  copy lives in `lib/ai-copy.ts` `reasonCopy` (`classifyError` distinguishes `bad_key` from `no_key`); the
  Character page's derive tool is user-labeled **"Draft from backstory"**.
- **Three AI lenses, two shapes.** Recall (**Lore**) *streams* prose with citations; Suggest (**Counsel**)
  and Converse (ADR-025) are *single-shot structured* — `structuredObjectCall` → a discriminated-union result,
  no stream, no citations. Converse grounds by **direct fetch** (`getEntityContext` + `listForEntity(asOf)` +
  persona), NOT retrieval, so it needs no embedding model. Add a structured lens by mirroring Suggest, not Recall.
- **Counsel v2 (ADR-026):** each "in the moment" option carries a `pillar` / `mechanic` (5e check + ability,
  no failure outcome — the DM's call) / `teamwork` field (all validated in `suggest.service` `validateMoment`);
  an optional `goal` biases the spread. The **scene** (`SceneControls`) grounds **Counsel only** now
  (ADR-027) — Recall is scene-free. **`flaws`** is a promoted entity field (like `traits`/`goals` — schema/serialize/entity.service)
  that feeds the persona. **Entity embeddings now index `traits`/`goals`/`flaws` + salient attributes**
  (`embedding-index.ts` `entityText`); editing that function re-embeds ALL entities on next launch.
- **Main character = the mandatory single lens (ADR-029).** Each campaign has ONE `pc` main character
  (`campaign.main_character_id`), created WITH the campaign (`createCampaign({mainCharacterName})`, atomic).
  There is **no active-PC switcher** — the store's `activePcId` is locked to the MC (the `MainCharacterBadge`
  in the Sidebar is now a read-only "Playing as X" that keeps the lock + links to the Character page), so all
  in-character lenses speak as it. **Backstory + persona + `voice_examples` are main-character-only** — gated
  in EntityForm/EntityDetail by `entity.id === campaign.mainCharacterId` (the `ProfileField.mainCharacterOnly`
  flag hides backstory for other PCs). **Voice examples** (promoted column, **migration 0009**; NOT embedded)
  feed persona generation + a cached "Voice examples" block after the persona in `suggestSystemBlocks`
  (Counsel/Converse) + `buildSystem` (Recall) via `voiceExamplesBlock`. Grandfathered null-MC campaigns show
  "Set a main character". (Campaign wording reverted from the ADR-024 "Saga".)
- **Character page + ONE persona generator (ADR-030).** The main character is managed on a dedicated
  **Character page** (`views/CharacterView.tsx`, FIRST in the nav; a bespoke two-column
  `CharacterDashboard.tsx` — NOT an `EntityDetail` reuse — with silent blur-autosave text fields
  [attributes re-read fresh before writing since updateEntity REPLACES], promoted lists edited via a
  per-card `ListEditDialog` popup [read-only chips otherwise], and a backstory-coupled **two-step Suggest**:
  step 1 = profile fields, step 2 = world entities/notes/ties via `useImport({withChanges:true})` +
  `ChangesetReview`, applied UNDATED — an EXPLICIT `sessionId: null` now means PRE-TRACKING in
  `createEntity`/`createLink`/`updateEntity` (`undefined` keeps the latest-session fallback); plus a
  picker to set/re-designate it). Codex still lists the MC (★) but selecting it shows a redirect card to the
  Character page (`CaptureView`), so the persona/derive UI lives only there. **Persona is ONE canonical
  generator** (`PERSONA_SYSTEM` via `persona.service` `generatePersona`): the **derive-from-backstory** tool
  (`derive-profile.service` + `DeriveReview`) proposes ONLY the fields (description/traits/goals/flaws/voice)
  for per-field approval; on apply `DeriveReview` does `entity.update(fields)` then `persona.generate`
  (best-effort) — it no longer emits its own persona. `PersonaEditor` (generate/regenerate/edit) is the only
  persona surface; `updatePersona` clears `stale` + re-syncs the source hash so a saved brief sticks.
- **Live-DB safety:** SQLite runs in WAL. Never let a second process write `ledger.db` while the app is
  open — close it first. Real failures land in `%APPDATA%\Ledger\logs\main.log` (electron-log); Import
  maps a truncated model response → `too_long` and a rejected/invalid key (401) → `bad_key`.
- **Tests** run as `cross-env ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run` (the
  native better-sqlite3 binding needs the Electron ABI). If `npm test` / `cross-env` isn't resolvable in
  a raw shell, invoke `./node_modules/.bin/electron` directly with `ELECTRON_RUN_AS_NODE=1`.

## Git
Work lands on `main`. A remote (`origin`) is configured, but the GitHub repo may not exist yet, so
`git push` can fail with "Repository not found" — commit locally until the repo is created. Co-author
commits per your harness's convention.
