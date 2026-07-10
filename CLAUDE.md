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
  `.sql`, keep `_journal.json` + the snapshot. Currently **12 migrations (0000–0011)** — 0011 (entity
  portrait `image`, ADR-039) is the nullable-ADD case: a clean 1-line `ALTER`, NOT the table-rebuild.
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
- **Two-tier extraction (ADR-035): `ExtractionMode = 'capture' | 'full'`** replaced the old `withChanges`
  boolean. **'capture'** (the Chronicle **close-out wizard** + the Transcribe dialog) proposes entities +
  notes + **statusChanges ONLY** — the schema *omits* the tie/field arrays (closed schema; the model
  can't emit them) and the roster context carries no current fields. Status stays in tier 1 because it
  drives as-of chronology (ADR-017). **Chronicle entries save as PLAIN log lines — no per-entry AI**:
  extraction runs when the user clicks **"Close out session"** (`capture/CloseOutDialog.tsx`), a LOCKED
  wizard (Esc/overlay/X inert; exit only via Approve/Reject-with-confirm, or Close on hard failure) that
  joins the session's entries oldest-first, runs ONE tier-1 extraction, applies it stamped at the
  session, then **chains into Illuminate** (scan runs post-apply so it sees the fresh notes). Its review
  is the shared `ChangesetReview` with opt-in volume props (`bulk` tri-state per-section toggles +
  `density="compact"`); other callers pass neither and are unchanged. **'full'** (all five arrays) has exactly ONE caller: backstory step 2 (`DeriveReview`, with
  `backstorySubjectId` so standing ties anchor to the MC — ADR-030 v3). Ties + field changes otherwise
  come from **"Illuminate"** (code name `enrich`) — the manual per-session tier-2 pass on the Sessions
  view: checklist of the session's touched entities (from `listNotesForSession` entityIds; the close-out
  wizard default-UNCHECKS entities tier 1 just created) → ONE focused
  call per entity (`enrich.service` → `enrichChangeset`; grounding = full note history capped 30 +
  current profile + id-bearing live-tie lines + a SLIM roster of tie endpoints + note-mentioned entities
  capped 25) proposing ONLY relationship/field changes with
  **REAL-ID refs** (never `#index`; never new entities/notes/status/type) → renderer merges (cross-entity
  tie dedup via `inverseKey`, `use-enrich`) → shared `ChangesetReview` → ONE `import.apply` stamped at
  the enriched session (ties open intervals at N). Field changes stay existing-only + un-versioned
  (ADR-028): plain `updateEntity` in the batch txn, re-read per change so intra-batch edits compound;
  **`description` is now a legal field-change target writing the REAL column** (it used to misroute into
  `attributes` — fixed). Enrich post-filters: subject-only + field whitelist (`description|traits|goals|
  flaws` ∪ `profileKeys(type)`). The tie/field validators are FACTORED (`validateRelationshipChanges` /
  `validateFieldChanges` over `ChangeValidationCtx`) and shared by both paths — **Dedup (ADR-031)** rules
  ride along: verbatim-dupe notes dropped, near-dupes flagged (`possibleDuplicate` → seeded OFF), live
  `form` ties dropped (`findOpenLink`) + direction-equivalent intra-batch dupes (`canonicalRelKey`),
  status/scalar no-ops dropped — re-running the same text OR re-Illuminating a session yields a
  near-empty changeset. An EMPTY per-entity enrichment is `ok:true` (the sweep steady-state), unlike
  extract's `'empty'` failure. Extracted statuses SNAP to the type's curated presets (case-insensitive →
  canonical label + the preset's EXPLICIT lifecycle, the only path to `presumed_ended`; `STATUS_VOCAB` is
  generated from `ENTITY_PROFILES`; free text stays allowed). **No migration** (mode is TS-level).
- **AI-grounding seams:** `formatState` + `buildUserContent` / `buildSuggestUserContent` /
  `buildConverseUserContent` in `claude.service.ts` are where entity state (lifecycle → `[ended]` /
  `[presumed ended — unconfirmed]`), relationships, and note `confidence` (→ `· (rumored)` / `· (suspected)`,
  via the shared `confidenceTag`) get injected. Change what the model is told *here*. **Ties** are rendered
  by the single `formatRelationships` (fed by `listForEntity`) — one line per edge carrying the confidence
  tag, the description, AND the **directional disposition** (how each side FEELS — `from_disposition` /
  `to_disposition`, oriented near/far for the viewing entity; ADR-033). All five lenses inherit it; extraction
  populates disposition+confidence+description on `form` ties. `getEntityContext`'s neighbor seam mirrors the
  fields but is test-only; `getHierarchy` ignores them (structural).
- **UI label ↔ code name (ADR-024/032/036/040):** the nav labels are Character · Chronicle · **Sessions** ·
  Codex · **Web** · **Lore** · **Counsel** · Converse · Settings (9 views; **Web** is P2-3/ADR-040, `'web'`,
  right after Codex); the code names stay `recall` (Lore), `suggest`
  (Counsel), `journal` (Chronicle), `capture` (Codex), `import` (Transcribe), `enrich` (Illuminate).
  **Transcribe is NOT in the nav** (ADR-036): it's a dialog off the Chronicle header
  (`capture/TranscribeDialog.tsx`; `views/ImportView.tsx` is deleted, `'import'` left `ViewKey`). The
  Chronicle header hosts THREE controls: the **active-session selector** (`sessions/SessionControl.tsx`,
  extracted from the Sidebar; its auto-select-latest effect still runs app-wide because MainPanel keeps
  views mounted) · **Transcribe** · **"Close out session"** (`capture/CloseOutDialog.tsx`, the ADR-035
  ritual). **"Illuminate"** (`sessions/EnrichDialog.tsx`; row pieces shared via `sessions/enrich-rows.tsx`)
  is ALSO a standalone per-session button in the SessionsView detail header (the surgical re-run). Codex is Inscribe + Annals only; Annals shows a read-only "Filing
  under Session N" hint (it stamps `note.sessionId = activeSessionId`). Previously…/recap lives in the
  Sessions view. The assistant is **"the Keeper"** in-app; "Claude"/Anthropic only in Settings +
  onboarding. Shared failure copy lives in `lib/ai-copy.ts` `reasonCopy` (`classifyError` distinguishes
  `bad_key` from `no_key`); the Character page's derive tool is user-labeled **"Draft from backstory"**.
- **Three AI lenses, two shapes.** Recall (**Lore**) *streams* prose with citations; Suggest (**Counsel**)
  and Converse (ADR-025, reshaped by **ADR-034**) are *single-shot structured* — `structuredArrayCall` → a
  discriminated-union result, no stream, no citations. Converse now emits **questions ONLY** (no briefing): a
  spread of tagged, in-character questions to ask a character you talk WITH (`npc`/`pc` targets, never self;
  the optional `focus`/"thread" is the *about*). Each is `{ question, tag, read }` over the 14-tag
  `CONVERSE_TAGS` taxonomy; a static `CONVERSE_TAG_META` (aim + trust-cost) drives the renderer's funnel
  ordering + badges (the model emits only the tag). `validateConverse` mirrors Counsel's `validateMoment`
  (distinct tags, floor 4 / cap 6, retry-once). Converse grounds by **direct fetch** (`getEntityContext` +
  `listForEntity(asOf)` + persona), NOT retrieval, so it needs no embedding model — and `getEntityContext`/
  `listNotesForEntity` now take an **`asOf`** that clamps the target's notes to session ≤ N (null-session =
  pre-tracking baseline, always kept), closing an as-of leak. Add a structured lens by mirroring Suggest, not Recall.
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
  step 1 = profile fields, step 2 = world entities/notes/ties via `useImport({mode:'full'})` (the ONE
  remaining full-extraction caller, ADR-035) + `ChangesetReview`, applied UNDATED — an EXPLICIT
  `sessionId: null` now means PRE-TRACKING in
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
  maps a truncated model response → `too_long` and a rejected/invalid key (401) → `bad_key`. Renderer
  CRASHES also reach that log (ErrorBoundary + window handlers → `RENDERER_ERROR_CHANNEL` → `ipc/app.ts`).
- **App shell & cost accounting (docs/ROADMAP.md P0, as-built):** every claude.service call records
  usage centrally — `structuredCall` opts REQUIRE a `feature: AiFeature` tag (a new lens must pick one;
  `usage.service` prices it, persists monthly buckets to `userData/usage.json`, Settings shows the
  totals) and optional `onUsage` threads per-run cost onto ok-results (`cost?: AiRunCost`) for the muted
  cost lines. Campaign **import** now exists (`import-campaign.service`, one txn, ids preserved, rejects
  a still-existing campaign id, reindexes after) — the export is no longer a one-way street. Window
  bounds persist via `window-state.json`; "Back up now"/data-folder/version live in Settings "Your data".
- **Session integrity (docs/ROADMAP.md P1-2/4, ADR-037):** a session is "unclosed" when its newest
  `event_log.timestamp` > its newest `note.createdAt` (close-out stamps notes at the session) — DERIVED,
  no `lastClosedOut` column. `session.service.unclosedCounts` → `session:unclosed` IPC → `useUnclosedSessions`
  badges the **Close out session** button + Sessions rows; freshness rides the sessions version bump
  (entry add/edit/delete and `use-import.apply` all fire it). **Chronicle entries are editable** now
  (`event.service` gained `updateEvent`/`deleteEvent`; nothing FKs to `event_log`): EventFeed rows have
  hover/focus edit (inline textarea) + delete (`DeleteEventDialog`), allowed ALWAYS — editing post-close-out
  does NOT change already-extracted notes (they're independent records; a `title` hint says so). The
  **LoopExplainer** (localStorage `ledger.loopExplainerDismissed`) names the ritual once atop JournalView.
- **Lens polish + merge (docs/ROADMAP.md P1-1/5/6):** the three AI lenses share a `LensResultBar`
  (Copy · **Inscribe** → a campaign-lore note via `ledger.note.create` entityIds:[] · **Recent** popover
  of the last ~5) fed by `useLensHistory` + prose serializers in `lib/lens-prose.ts`; each view snapshots
  on done (MainPanel keeps views mounted, so history survives nav, not restart). **Cancel** for Counsel/
  Converse/Transcribe: request/response calls carry an OPTIONAL `requestId`; `ipc/cancelable.ts`
  `registerCancelable` stores an AbortController per id + a `*:cancel` channel (mirrors recall's map);
  hooks mint the id + a Stop button aborts (the numeric staleness token makes the aborted promise read as
  "stopped", not an error). Illuminate keeps its between-entity Stop (unchanged). **Entity merge**
  (ADR-038, re-point only): `merge.service.mergeEntities` moves the loser's notes/ties/chronology/event
  refs to the survivor in one txn — colliding `note_entity`/`entity_link` rows are LEFT for
  `deleteEntity`'s cascade (never an explicit pre-delete racing the open-interval unique index; dup ties
  detected via `findOpenLink` over a tx-scoped ctx); MC pointer carried before delete (PC survivor
  required); survivor fields untouched ⇒ no re-embed. UI: **Merge** action on EntityDetail →
  `MergeEntityDialog` (reuses `EntityPicker`).
- **Command palette + removals (docs/ROADMAP.md P2-4, R-1/2/3):** **Ctrl/Cmd+K** opens a global
  `CommandPalette` (`components/CommandPalette.tsx`, the first `CommandDialog` consumer) — Go-to any view
  (from the shared `lib/nav-items.tsx` `NAV_ITEMS`, now the single source for Sidebar + palette), find any
  entity by name (cmdk over `useEntities`; MC→Character, else Codex — same nav as `SearchBox`), or Add
  entity (folds in the old quick-add). **Ctrl+K was repurposed FROM quick-add** → the palette; quick-add
  stays reachable via the palette command + the OS-global **Ctrl+Alt+L**; **Ctrl+F** (sidebar search)
  unchanged. e2e: `tests/e2e/palette.spec.ts` (keyless — pure nav). The dead `fontSize`/`ThemeMode`
  `AppSettings` stubs were removed (never read; app is dark-only via globals.css + hardcoded
  `Toaster theme="dark"`); the `'import'` ViewKey was already gone (ADR-036).
- **Portraits + Web graph (docs/ROADMAP.md P2-2/P2-3, ADR-039/040):** every entity has an optional
  **portrait** — a base64 JPEG **thumbnail** in the nullable `entity.image` column (**migration 0011**,
  the arc's first; a 1-line `ALTER`). Set via `entity:pickImage` (`ipc/entity.ts` → Electron `nativeImage`
  resize→JPEG, NO new dep); rendered by the shared `entities/Portrait.tsx` (rounded square + initials
  fallback, fallen/presumed dim) in EntityDetail/Browser/EntityForm + a click-to-set header on
  `CharacterDashboard` (via `savePromoted({image})`). **NOT embedded** (`entityText` never reads it, so no
  re-embed) and it **rides export/import for free** (just text on `Entity`; `import-campaign` carries it in
  the field-by-field map). Passthrough mirrors `description` (serialize/create/`updateEntity` set-if-present).
  The **Web** view (`components/views/WebView.tsx`) draws the campaign's LIVE ties as a **d3-force** graph
  (first viz dep) over `buildCampaignGraph(ctx, campaignId)` (`link.service.ts`: nodes=`listEntities`,
  edges=`listLinksForCampaign` filtered to OPEN intervals with `RELATIONS[relation].forward` labels,
  dangling-endpoint edges dropped) → `graph:campaign` IPC → `useCampaignGraph` (refetches on
  `entitiesVersion`). Rendered as themed SVG (hand-rolled pan/zoom/node-drag; ember ring reserved for the
  MC, everyone else muted iron — the single-accent guardrail); the sim is **guarded on
  `activeView === 'web'`** (MainPanel keeps views mounted) — builds/reheats on activation, `stop()`s +
  cancels rAF when hidden, positions cached in a ref so a data change doesn't scramble. Click a node →
  `setSelectedEntity` + `setActiveView('capture')` (MC → `'character'`). No migration for the graph.
- **Tests** run as `cross-env ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run` (the
  native better-sqlite3 binding needs the Electron ABI). If `npm test` / `cross-env` isn't resolvable in
  a raw shell, invoke `./node_modules/.bin/electron` directly with `ELECTRON_RUN_AS_NODE=1`.

## Git
Work lands on `main`. A remote (`origin`) is configured, but the GitHub repo may not exist yet, so
`git push` can fail with "Repository not found" — commit locally until the repo is created. Co-author
commits per your harness's convention.
