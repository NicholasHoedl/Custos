# Custos — project guide for coding agents

Local-first desktop app for tracking a tabletop RPG campaign with a time-aware, AI-backed memory
(Chronicle · Sessions · Character · Codex · Web · Lore · Counsel · Converse — see the label↔code-name
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
  `.sql`, keep `_journal.json` + the snapshot. Currently **14 migrations (0000–0013)** — 0011 (entity
  portrait `image`, ADR-039) is the nullable-ADD case: a clean 1-line `ALTER`, NOT the table-rebuild; **0012
  (ADR-052) is a DATA-only migration** — `DELETE FROM note_embedding/entity_embedding` (no schema change;
  its snapshot is hand-re-chained from 0011), purging old 384-dim vectors after the embedder swap so backfill
  re-embeds at 768; **0013 (C1) adds nullable `event_log.updated_at`** (clean 1-line `ALTER` + a backfill
  `UPDATE … = timestamp`) — bumped on edit so an entry edited after its session was extracted re-flags it.
- **`lifecycleHeuristic` (`src/shared/lifecycle.ts`) MUST mirror migration 0005's SQL `CASE`** — an
  invariant asserted by `chronology.service.test.ts`. Never change one without the other.
- **`entity.type` and `entity.lifecycle` are free-text TEXT** (no CHECK): a new entity type or lifecycle
  value needs NO migration. The `Record<EntityType, …>` maps (`entity-profiles`, labels) force an
  exhaustive per-type entry at compile time — that is the guardrail; lean on it.
- **Entity state is one control.** The entity form has a single **Status** combobox; `lifecycle` is
  derived, not user-picked — status presets carry an explicit lifecycle (`entity-profiles.StatusPreset`),
  free text runs through `lifecycleHeuristic`, and a "presumed" checkbox flips `ended ↔ presumed_ended`.
  There is no separate Lifecycle dropdown. (Extraction, unlike the manual form, is **enum-only** — it can't
  use free text; see the two-tier extraction bullet + ADR-054.)
- **Lifecycle terminology is TYPE-AWARE (ADR-054).** "Fallen" reads wrong for a place/quest/item/faction/
  event, so the shared **`lifecycleLabel(type, lifecycle)`** (`@shared/entity-types`) maps the `ended` bucket
  per type via `ENDED_LABELS` — pc/npc **Fallen**, creature **Defeated**, location/item **Destroyed**, faction
  **Disbanded**, quest **Closed**, event **Concluded** — and falls back to the neutral `LIFECYCLE_LABELS`
  (never call `LIFECYCLE_LABELS[lifecycle]` directly in the UI — use the helper). The Skull/blood death mark
  is gated on **`isDeathType`** (pc/npc/creature); other types get a neutral `CircleSlash` + muted strike.
  Consumers: EntityDetail, CharacterDashboard, EntityBrowser, EntityHistory (takes a `type` prop), the
  extract-review `StatusChangeRow` (fed the entity's type via `ChangesetReview`'s `refType`); the Web view's
  blanket toggle is **"Hide gone"** (not "Hide fallen").
- **A note may tag zero entities** (campaign lore, ADR-021) via the manual NotesView — retrieval and the
  Recall "Sources" list handle null-entity chunks. But paste-and-extract **Import deliberately still
  requires ≥1 entity per note** (an untagged extracted note is noise); don't "relax" the extraction
  prompt to allow untagged notes.
- **Two-tier extraction (ADR-035): `ExtractionMode = 'capture' | 'full'`** replaced the old `withChanges`
  boolean. **'capture'** (the session **Extract** tool + the Transcribe dialog) proposes entities +
  notes + **statusChanges ONLY** — the schema *omits* the tie/field arrays (closed schema; the model
  can't emit them) and the roster context carries no current fields. **B2 (dedup):** the existing-entity
  roster the model sees is ranked by `rankExistingForExtraction` (`claude.service`) — full-name substring,
  then any name-TOKEN present in the paste ("Sildar" surfaces "Sildar Hallwinter"), then the rest — BEFORE the
  100-cap, so a partial reference in a >100-entity campaign still surfaces the real entity to LINK rather than
  duplicate; and the review's "similar existing" row becomes a loud destructive **link-instead** nudge when a
  proposed CREATE scores ≥0.7 against an existing entity (`import-rows.tsx` `strongMiss`; `seedEntity` still
  auto-links only at ≥0.9). Status stays in tier 1 because it
  drives as-of chronology (ADR-017). **Chronicle entries save as PLAIN log lines — no per-entry AI**:
  extraction runs from the **Extract** button on the Sessions page (`capture/ExtractDialog.tsx`, ADR-051),
  a PLAIN closeable dialog that joins the selected session's entries oldest-first, runs ONE tier-1
  extraction, and applies it stamped at that session. NO auto-chain into Illuminate — they're separate
  tools now. Its review is the shared `ChangesetReview` with opt-in volume props (`bulk` tri-state
  per-section toggles + `density="compact"`); other callers pass neither and are unchanged. **'full'** (all five arrays) has exactly ONE caller: backstory step 2 (`DeriveReview`, with
  `backstorySubjectId` so standing ties anchor to the MC — ADR-030 v3). Ties + field changes otherwise
  come from **"Illuminate"** (code name `enrich`) — the manual per-session tier-2 pass on the Sessions
  view: checklist of the session's touched entities (from `listNotesForSession` entityIds, all checked by
  default now that nothing auto-chains) → ONE focused
  call per entity (`enrich.service` → `enrichChangeset`; grounding = full note history capped 30 +
  current profile + id-bearing live-tie lines + a SLIM roster of tie endpoints + note-mentioned entities
  capped 25 — the roster is the pure `selectEnrichRoster`, whose mention-scan reads ALL notes not just the
  capped-30 prompt window (**B1**), so a tie to an entity named only in an OLD note stays proposable; the
  campaign's **main character is PINNED into every enrich roster** (guard #1, `selectEnrichRoster` `pinnedIds`)
  and the enrich user turn carries a **PC-perspective POV block** naming the MC (guard #2 — `enrichEntity`
  passes `mainCharacter`, rendered by `buildEnrichUserContent`), so a PC↔NPC "knows"/acquaintance tie forms
  even when the PC is only the implicit "we" of PC-narrated chronicle and is never named in the NPC's notes —
  both skipped when the subject IS the MC) proposing ONLY relationship/field changes with
  **REAL-ID refs** (never `#index`; never new entities/notes/status/type) → renderer merges (cross-entity
  tie dedup via `inverseKey`, `use-enrich`) → shared `ChangesetReview` → ONE `import.apply` stamped at
  the enriched session (ties open intervals at N). Field changes stay existing-only + un-versioned
  (ADR-028): plain `updateEntity` in the batch txn, re-read per change so intra-batch edits compound;
  **`description` writes the REAL column** (it used to misroute into `attributes` — fixed) for the full/
  backstory path, **but Illuminate is NOT allowed to change `description`** — the per-session sweep churned the
  stable prose summary with transient details, so it stays set by hand + the backstory tool only (the enrich
  prompt forbids it AND `enrichEntity`'s whitelist drops it). **A promoted list (traits/goals/flaws) is
  ADD/CUT ONLY for AI passes (ADR-055):** `validateFieldChanges` drops an `alter` when `isPromoted` (the single
  gate, shared by both the full/backstory path AND Illuminate), and BOTH field-change prompts
  (`FIELD_CHANGES_INSTRUCTIONS` + the enrich FIELD CHANGES paragraph) forbid rewording a trait/goal/flaw — a
  goal is a stable item, not a progress log, so how it advanced goes in a note/quest. `alter` stays valid for
  a type ATTRIBUTE (+ `description` on the full path) and the manual form is unaffected. Enrich post-filters:
  subject-only + field whitelist (`traits|goals|flaws` ∪ `profileKeys(type)`). The tie/field validators are FACTORED (`validateRelationshipChanges` /
  `validateFieldChanges` over `ChangeValidationCtx`) and shared by both paths — **Dedup (ADR-031)** rules
  ride along: verbatim-dupe notes dropped, near-dupes flagged (`possibleDuplicate` → seeded OFF), live
  `form` ties dropped (`findOpenLink`) + direction-equivalent intra-batch dupes (`canonicalRelKey`),
  status/scalar no-ops dropped — re-running the same text OR re-Illuminating a session yields a
  near-empty changeset. An EMPTY per-entity enrichment is `ok:true` (the sweep steady-state), unlike
  extract's `'empty'` failure — but **A1:** `EnrichDialog` now distinguishes a `'failed'` row (a REAL
  per-entity error: `api`/`invalid`/`too_long`) from empty. The done/review branches render a destructive
  failure banner + the failed rows (via the pure `summarizeFailures`, `lib/enrich-progress.ts`) + a "Try
  again", so a sweep NEVER reads as "nothing new" when entities actually errored (the masking that hid the
  Haiku 400). Global reasons (`no_key`/`bad_key`/`offline`) still abort to the error/review states. **Extraction status is ENUM-ONLY (ADR-054):**
  the `statusChange` schema carries `status` ONLY (the `lifecycle` field is gone) and the model is told to use exactly one of the
  type's listed statuses or omit it; `validateExtraction` SNAPS a proposed status (baseline + change) to the type's preset
  (case-insensitive → canonical label + the preset's EXPLICIT lifecycle) and **DROPS anything that isn't a preset** — no free text,
  no `lifecycleHeuristic` fallback, so the model can only make an entity `ended`/"fallen" by naming a preset that ends it (a
  statusless new entity defaults to `active`). `STATUS_VOCAB` is generated from `ENTITY_PROFILES`; the manual "presumed" toggle
  stays the only path to `presumed_ended`. **No migration** (mode is TS-level).
- **Local search / retrieval (ADR-052):** embeddings run **`Alibaba-NLP/gte-base-en-v1.5`** (768-dim,
  long-context — full notes, not MiniLM's ~256-token cut) on **`@huggingface/transformers` v3**
  (`embedding.service.ts`; backend = onnxruntime-node **cpu**, `dtype:'q8'`, `device` OMITTED — `wasm` is
  invalid in Node, and gte logs a benign `"Unknown model class 'new'"` that constructs from base). `EMBED_MODEL`/
  `EMBED_DIM` live in `embedding-constants.ts`; the ready-marker is **model-id-derived**, so changing the model
  flips `isModelReady()` false → the existing "Download model" cards (Settings/Lore/Counsel) re-fetch. A model
  swap MUST ship a **data-only migration that purges the embedding tables** (backfill is content-hash-only + won't
  overwrite unchanged rows) — see migration **0012**; `vector-store.search` also filters rows to the current
  `model` (mixed dims dot-product to garbage via `dot()`'s `Math.min`). All three lenses retrieve through
  **`hybridRetrieve` (`retrieval.service.ts`)**: dense (a WIDER pool when reranking) + model-free fuzzy name-match
  → dedupe → **cross-encoder rerank to top-N** via **`rerank.service`** (`mixedbread-ai/mxbai-rerank-xsmall-v1`,
  own marker, downloaded after the embedder, always-on when present, gated `isRerankerReady() && !fakeAiEnabled()`
  → inert under the fake seam). Graceful degradation preserved: dense skipped when the model's absent, fuzzy always
  runs. `applyRerankScores` is the pure, unit-tested ordering core. One-time upgrade cost: ~225 MB re-download +
  full re-embed (surfaced via the not-ready UI).
- **AI-grounding seams:** `formatState` + `buildUserContent` / `buildSuggestUserContent` /
  `buildConverseUserContent` in `claude.service.ts` are where entity state (lifecycle → `[ended]` /
  `[presumed ended — unconfirmed]`), relationships, and note `confidence` (→ `· (rumored)` / `· (suspected)`,
  via the shared `confidenceTag`) get injected. Change what the model is told *here*. **Ties** are rendered
  by the single `formatRelationships` (fed by `listForEntity`) — one line per edge carrying the confidence
  tag, the description, AND the **directional disposition** (how each side FEELS — `from_disposition` /
  `to_disposition`, oriented near/far for the viewing entity; ADR-033). All five lenses inherit it; extraction
  populates disposition+confidence+description on `form` ties. `getEntityContext`'s neighbor seam mirrors the
  fields but is test-only; `getHierarchy` ignores them (structural).
- **UI label ↔ code name (ADR-024/032/036/040/044/047/056/061):** the nav labels are **Home** · Chronicle ·
  Sessions · Character · Codex · **Web** · Lore · Counsel · Converse · **Continuity** · Settings (11 views,
  HOME-first per ADR-061 — the dashboard, `'home'`, the DEFAULT landing view, its heading-less nav group
  skipped by the Sidebar's marker logic; revises ADR-044's Chronicle-first — the rest stay GROUPED under
  **Capture / World / Ask** + Settings via `NavItem.group` + `.inscribed` headings, ADR-047;
  **Web** is P2-3/ADR-040, `'web'`, right after Codex; **Continuity** is ADR-056, `'continuity'`, last in the Ask group);
  the code names stay `recall` (Lore), `suggest`
  (Counsel), `journal` (Chronicle), `capture` (Codex), `import` (Transcribe), `enrich` (Illuminate), `continuity` (Continuity).
  **Every view's header is now the shared `PaneHeader` toolbar (leading icon + `text-lg` Fraunces title +
  right `action` slot) over a `PaneBody` (`chrome.tsx`; `PaneShell` was deleted) — page chrome stays compact,
  content identity (entity/session/character names) stays large Fraunces (ADR-047).** The three AI lenses fill
  their idle state via `components/lens/LensIdle.tsx` (starter chips from `lib/lens-starters.ts` that fill the
  input; + recent history), and each lens's `PaneHeader` carries a shared **`LensPromptInfo`**
  (`components/lens/LensPromptInfo.tsx`) info popover with a **Using it** how-to + a **Writing a good query**
  best-practices section — copy in `lib/guide-content.tsx` `LENS_PROMPT_TIPS` (`{name,does,using,query}`; it
  generalized the old inline `CounselInfo`, so all three popovers share one shape, and the `query` bullets are
  live weak-vs-strong A/B-validated per lens). **Chronicle's header carries a parallel `capture/ChronicleInfo.tsx`**
  (same `InfoPopover` primitive, in the action slot beside `SessionControl`) fed by `guide-content.tsx`
  `CHRONICLE_TIPS` (`{name,does,using,writing}`); its **`writing`** bullets are how to phrase entries for good
  tier-1 Extract + tier-2 Illuminate — real consistent names → entities, who-did-what → tie direction, plain
  status changes → chronology, flagged rumor/hunch → note confidence. Codex
  reuses the ADR-046 `ENTITY_TYPE_COLOR`/`ENTITY_TYPE_ICON` maps for its
  filter chips + list badges (as do `EntityBadge`, `EntityDetail`, the command palette).
  **Transcribe is NOT in the nav** (ADR-036): it's a dialog off the Chronicle header
  (`capture/TranscribeDialog.tsx`; `views/ImportView.tsx` is deleted, `'import'` left `ViewKey`). The
  Chronicle header hosts ONLY the **active-session selector** (`sessions/SessionControl.tsx`, extracted
  from the Sidebar; its auto-select-latest effect still runs app-wide because MainPanel keeps views
  mounted) — ADR-051 moved the AI tools OFF the header. The SessionsView detail header hosts the three
  per-session tools: **Extract** (`capture/ExtractDialog.tsx` — tier-1, formerly the close-out wizard's
  step 1), **Illuminate** (`sessions/EnrichDialog.tsx`; rows shared via `sessions/enrich-rows.tsx`), and
  **Transcribe** (`capture/TranscribeDialog.tsx`, now a `session`-prop targeting the selected session). Codex is **Add entity + Notes** only (the plain labels replaced
  the thematic "Inscribe"/"Annals" — user-clarity pass; `NotesView`'s header + the entity/Character note
  sections + the ChangesetReview section all say "Notes" now); Notes shows a read-only "Filing
  under Session N" hint (it stamps `note.sessionId = activeSessionId`). Previously…/recap lives in the
  Sessions view. The assistant is **"the Keeper"** in-app; "Claude"/Anthropic only in Settings +
  onboarding. Shared failure copy lives in `lib/ai-copy.ts` `reasonCopy` (`classifyError` distinguishes
  `bad_key` from `no_key`); the Character page's derive tool is user-labeled **"Draft from backstory"**.
- **Entity quick-write (slash mentions):** in the *writing + ask* textareas, typing `/npc` (or `/loc`, `/que`,
  `/fac`, `/item`, `/pc`, `/eve`, `/cre` — three-letter code OR full type name; a bare/unknown `/word`, spaces
  allowed, **FUZZY**-searches all types by name — cmdk's `defaultFilter` **injected** from `MentionTextarea` so
  `lib/mention.ts` stays pure, same matcher as the command palette [`rankEntities` takes an `opts.score`;
  substring default]) opens a filtered menu of that type; Enter/Tab/click drops the entity's **plain name** over the
  token (boxes are plain-text — extraction resolves names→entities later; no rich-mention model, no migration).
  Reusable **`entities/MentionTextarea.tsx`** is a drop-in for `<Textarea>` — swap
  `onChange={e=>setX(e.target.value)}` → `onValueChange={setX}`, keep every other prop — over the pure
  **`lib/mention.ts`** (`SLASH_TYPES` · `parseMentionToken` · `rankEntities`). The menu is a `PopoverAnchor`
  floating list driven from the textarea's OWN keys so focus never leaves it (`onOpenAutoFocus`/row
  `onMouseDown` `preventDefault`); it's `role="combobox"` ONLY while open (else it collides with real combobox
  role-queries), Ctrl/Cmd+Enter still submits the composer, and Escape `stopPropagation`s so it dismisses the
  menu, not a parent Dialog. A pick restores the caret past the inserted name via a `useLayoutEffect` +
  `pendingCaret` ref. Wired into the Chronicle composer + entry-edit, Notes composer + `NoteEditDialog`,
  entity Description, and the Lore/Counsel/Converse query boxes. NOT the Character `InlineText` (blur-autosave)
  or Transcribe/import rows — deferred, convert via the same `onValueChange` (+ an optional shared `entities`
  prop to avoid N fetches). e2e `tests/e2e/mention.spec.ts` (pure UI); parser unit `tests/unit/renderer/
  mention.test.ts`.
- **Continuity — the read-only campaign AUDIT (ADR-056, code name `continuity`, Ask group).** A new lens that
  flags inconsistencies in the accumulated memory. TWO sources, one report: (1) always-on **deterministic
  checks** — the pure, unit-tested **`@shared/continuity-checks.ts`** (`runDeterministicChecks` over plain
  records the service gathers; mirrors `graph-reduce`): status↔lifecycle mismatch (a preset's lifecycle ≠
  `entity.lifecycle`, via `profileFor`) + a live `ally_of` ∧ `enemy_of` pair — precise, instant, **no key**
  (a dead entity merely HOLDING a tie is deliberately NOT flagged — ties/notes persist past death; the "still
  ACTING" leak is the AI pass's job); (2) an **additive AI pass** — `claude.service.continuity()` → `structuredArrayCall<RawContinuityFinding>`
  (`feature:'continuity'`, `arrayKey:'findings'`), NO persona (system = `CONTINUITY_INSTRUCTIONS` only, like
  `buildEnrichSystem`), over a token-bounded whole-campaign gather (`formatState`/`formatRelationships`-style
  lines + notes newest-first + `confidenceTag`, capped under `MAX_EXTRACT_INPUT_TOKENS`), for the semantic
  contradictions. **GOTCHA:** the call passes `maxTokens: 32000` (not the 8192 default) — on adaptive-thinking
  models that budget is SHARED with thinking, and a whole-campaign audit at high effort thinks enough to eat
  8192 and truncate the JSON (a `too_long` failure); the other lenses keep 8192 (tiny output, focused grounding).
  **A `maxTokens > 21333` FORCES streaming:** the SDK throws an instant client-side `"Streaming is required…"`
  (→ a generic `api` failure) for a NON-streaming call whose budget could outlast its 10-min timeout
  (`(3600·max_tokens)/128000 > 600`), so `structuredCall` sends any call above `NONSTREAMING_MAX_TOKENS` via
  `messages.stream().finalMessage()` (same Message shape downstream); calls ≤ that stay on `messages.create`. `continuity.service.runContinuity` gathers → runs the checks → (key+online) runs the AI pass
  (fake seam `fakeContinuity`) → maps raw findings to real ids → merges + sorts by severity. **The result
  ALWAYS returns the deterministic findings**; the AI part reports its own `ai: {status: skipped|failed|ok}`
  (`ContinuityResult` has no hard ok/fail — the tool is useful with no key). Findings link the entities (jump
  to Codex) + carry an optional `suggestedFix`. **DETERMINISTIC findings also carry a structured one-click
  `fix`** (`ContinuityFixAction` = `set-lifecycle` | `sever-tie`; faction-conflict offers one per tie): the card
  renders a button per `fix.actions`, `use-continuity.applyFix` dispatches to the EXISTING `ledger.entity.update`
  / `ledger.link.sever` IPC (no AI, no key), `bumpEntities()`, then optimistically prunes the finding (no
  re-run → no AI re-cost). AI findings stay advisory (no `fix`); NOTHING edits notes. Button-driven view
  (`ContinuityView`, no query box) with a `speed` toggle; `LensPromptInfo` gained an optional `queryLabel`
  ("What it checks"). v1 audits the LIVE "now" picture (as-of audit reserved). No migration.
- **Three AI lenses, two shapes.** Recall (**Lore**) *streams* prose with citations; Suggest (**Counsel**)
  and Converse (ADR-025 → **ADR-034** → **ADR-049**) are *single-shot structured* — `structuredArrayCall` → a
  discriminated-union result, no stream, no citations. Converse now emits **questions ONLY** (no briefing): a
  spread of tagged, in-character questions to ask a character you talk WITH (`npc`/`pc` targets, never self;
  the optional `focus`/"thread" is the *about*). Each is `{ question, tag, read }` over the 14-tag
  `CONVERSE_TAGS` taxonomy; a static `CONVERSE_TAG_META` (aim + trust-cost) drives the renderer's funnel
  ordering + badges (the model emits only the tag). `validateConverse` mirrors Counsel's `validateMoment`
  (distinct tags, **exactly 4** — cap 4/floor 4, ADR-049 — retry-once). The card renders the `question`
  line in double quotes (it's spoken dialogue); the `read` is the muted strategic note. **Dialogue quality:**
  `CONVERSE_INSTRUCTIONS` keeps questions in-character but SHORT + spoken + flourish-free (a "SOUND LIKE A
  REAL PERSON" section mirroring Recall's RESTRAINT/RIGHT-SIZE, a **few-shot** of tight example questions,
  and a firm boundary that the `question` is ONLY what's said out loud — all strategy stays in the `read`);
  this is prompt tuning, NOT a plain-English pivot like Counsel (Converse stays in-voice). **Converse
  follow-up loop + speed (ADR-049):**
  `ConverseRequest.history?: { question, answer }[]` (the EXCHANGES so far — the question the player used +
  the target's answer, oldest-first; mirrors Recall) → the model returns FOLLOW-UP questions that build on
  the specific exchange (`buildConverseUserContent` renders each as `You asked "Q" — They said "A"`; the
  `CONVERSE_INSTRUCTIONS` FOLLOW UP rule says PROGRESS not restart — skip openers, react to how they
  answered, don't repeat last turn's tags; FUNNEL's "open with a low-cost question" is scoped to the OPENING
  round). To follow up you MUST **pick one of the four cards** (a "Follow up on this →" button on the latest
  spread sets `selectedQuestion`; the answer composer only appears after a pick), then paraphrase the answer.
  `use-converse` holds a `ConverseTurn[]` thread (each turn's `asked: {question,answer}|null`) + `followUp
  (question, answer)`; `ConverseView` renders the thread (a **"You asked / They said"** breadcrumb + the
  funnel spread per turn) in a **single wide column** (`PaneBody className="max-w-4xl"`, cards stacked). Per-query **speed** (`speed?: 'quick'|'deep'`, quick=Sonnet+medium, resolved
  once in `converse.service`). **Voice restored for Converse** (its questions are dialogue in the PC's voice)
  via `suggestSystemBlocks(ctx, instructions, includeVoice)` — `buildConverseSystem` passes `true`; Counsel/
  Directions stay voice-free (ADR-048). Converse grounds by **direct fetch** (`getEntityContext` +
  `listForEntity(asOf)` + persona + the target's `description`/traits/goals/flaws) — and `getEntityContext`/
  `listNotesForEntity` now take an **`asOf`** that clamps the target's notes to session ≤ N (null-session =
  pre-tracking baseline, always kept), closing an as-of leak. **Plus an OPTIONAL focus-scoped "world context"**
  (only when a thread/`focus` is set): `converse.service.gatherWorldContext` reuses Suggest's hybrid retrieval
  (`embed`+`store.search` dense **only when `isModelReady()`**, `fuzzyEntityChunks` always — model-graceful, so
  Converse still has NO `no_model` failure and runs before the model is downloaded), drops the target's own
  chunks + dedups + caps at 6, and `buildConverseUserContent` renders it as a plain-text "what the party knows
  about that thread" block. The store is now threaded into `registerConverseHandlers`/`converse()` (was
  Suggest-only). Add a structured lens by mirroring Suggest, not Recall.
- **Counsel "in the moment" (ADR-026 → reshaped by ADR-048):** the attitudes spread is now **FOUR**
  narrative options, each `MomentSuggestion = { primaryTag, secondaryTags, title, explanation }` — a bold
  action-verb **title** + a concise **plain-English explanation** (what + why) + category tags. **No D&D
  mechanics** (the `pillar`/`mechanic`/`teamwork` fields + `SUGGEST_PILLARS`/`PILLAR_LABELS`/`SuggestPillar`
  are GONE) and **no combat-turn tactics** — the rewritten `SUGGEST_INSTRUCTIONS` forbids dice/checks/rounds
  ("even in a fight, stay in the fiction"), mandates plain modern English (no in-character register), and
  **`suggestSystemBlocks` no longer appends the MC's voice examples** (they fight plain English; Recall still
  uses them). `validateMoment` enforces **exactly four** distinct-primary options with non-empty
  title+explanation; `MomentCard` is a FLAT card (tags → title → explanation, no expand), stacked in a
  single wide column — `SuggestView` is now `PaneBody size="reading"` + `max-w-4xl` with the composer on top
  and cards stacked, matching Converse (was a two-column controls|results split with a 2-up card grid). An
  optional `goal` biases the spread. The **scene** (`SceneControls`) grounds **Counsel only** (ADR-027) —
  Recall is scene-free. **`flaws`** is a promoted entity field (schema/serialize/entity.service) feeding the
  persona; **entity embeddings index `traits`/`goals`/`flaws` + salient attributes** (`embedding-index.ts`
  `entityText`; editing it re-embeds ALL entities on next launch). Per-query **speed** — `SuggestRequest.speed`
  `'quick'` (Sonnet 4.6 + medium, the DEFAULT) vs `'deep'` (Settings model/effort), resolved once in
  `suggest.service`. `SceneControls` defaults **collapsed** (persisted `localStorage ledger.sceneOpen`). A
  **Refine** row (nudge chips: Bolder / More cautious / De-escalate / Fresh angle) re-rolls the SAME moment
  via `SuggestRequest.refinement` + `previous` (prior spread serialized by tag+title, folded into the user
  turn by `buildSuggestUserContent`) — still single-shot, it REPLACES the spread. `use-suggest.ask(situation,
  mode, opts)` carries speed/refinement/previous; IPC/preload forward the request whole.
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
  **Character page** (`views/CharacterView.tsx`, third in the nav — was first per ADR-030, reordered
  Chronicle-first by ADR-044; a bespoke two-column
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
- **Live-DB safety:** SQLite runs in WAL. Never let a second process write `custos.db` while the app is
  open — close it first. Real failures land in `%APPDATA%\Custos\logs\main.log` (electron-log); Import
  maps a truncated model response → `too_long` and a rejected/invalid key (401) → `bad_key`. Renderer
  CRASHES also reach that log (ErrorBoundary + window handlers → `RENDERER_ERROR_CHANNEL` → `ipc/app.ts`).
- **App shell & cost accounting (docs/ROADMAP.md P0, as-built):** every claude.service call records
  usage centrally. **`structuredCall` gates `thinking:{type:'adaptive'}` + `output_config.effort` on model
  support** (`supportsAdaptiveThinking`/`buildStructuredParams` — Opus 4.6+/Sonnet 4.6+; **Haiku 4.5 rejects
  BOTH with a 400** ["adaptive thinking is not supported on this model"], so it gets a plain json_schema call
  — the ADR-051 Illuminate-on-Haiku bug that swallowed every enrich as "nothing new"; add a model to the set
  when Settings offers it). `structuredCall` opts REQUIRE a `feature: AiFeature` tag (a new lens must pick one;
  `usage.service` prices it, persists monthly buckets to `userData/usage.json`, Settings shows the
  totals) and optional `onUsage` threads per-run cost onto ok-results (`cost?: AiRunCost`) for the muted
  cost lines. Campaign **import** now exists (`import-campaign.service`, one txn, ids preserved, rejects
  a still-existing campaign id, reindexes after) — the export is no longer a one-way street. Window
  bounds persist via `window-state.json`; "Back up now"/data-folder/version live in Settings "Your data".
- **Session integrity (docs/ROADMAP.md P1-2/4, ADR-037; audit follow-ups C1/D1/D2/E1-3):** a session is
  "unclosed" when its newest `event_log.updatedAt` (**C1**: bumped on create AND edit — migration 0013;
  legacy null rows fall back to `timestamp`) > its newest `note.createdAt` (the Extract tool stamps notes at
  the session) — DERIVED, no `lastClosedOut` column. `session.service.unclosedCounts` → `session:unclosed` IPC
  → `useUnclosedSessions` badges the Sessions-page **Extract** button + Sessions rows ("N added or changed
  since last extract"); freshness rides the sessions version bump (entry add/edit/delete + `use-import.apply` —
  **C1** wired the previously-missing `saveEntry` edit bump). **Chronicle entries are editable**
  (`event.service` `updateEvent`/`deleteEvent`; nothing FKs to `event_log`): editing does NOT retroactively
  change already-extracted notes (independent records), but **C1** now re-flags the session so you can
  re-extract to sync (dedup-safe, so re-running is cheap). **D2:** `tests/integration/idempotency.test.ts`
  locks the "re-running yields a near-empty changeset" guarantee (apply → re-`extract`/`enrichEntity` → empty).
  **D1:** `extract` has a pre-flight `estimateTokens` guard (`@shared/tokens`; `> MAX_EXTRACT_INPUT_TOKENS` →
  clean `too_long` before the call) + an ExtractDialog long-session advisory. **E3:** `listEvents` orders
  `timestamp, rowid` so same-ms extraction order is deterministic. **E1/E2:** the Chronicle composer pins the
  target session at submit (a mid-flight switch → a "saved to the session you wrote it in" toast) and persists
  an unsent draft to `localStorage` keyed per session.
- **Insert session before = the ONE sanctioned renumber (ADR-062).** Session NUMBERS are the timeline
  axis, denormalized (no FK) into `status_history.since_session_number` + `entity_link.start/
  end_session_number` — so `session.service.insertSessionBefore` (the backfill tool: a new EMPTY session
  at the anchor's number; "Insert before" on the Sessions detail header) must shift the session numbers
  AND both stamp tables in ONE transaction. **The session shift uses a NEGATE two-phase**
  (`n → -(n+1)`, then `negatives → -n`) because SQLite checks the `(campaign_id, number)` UNIQUE index
  PER ROW during UPDATE — a naive `+1` UPDATE fails on any dense run (locked by test), and UPDATE's
  `ORDER BY` does NOT control write order. NULL stamps are never touched (`>= k` is false for NULL), so
  pre-tracking baselines stay pre-tracking and OPEN intervals stay open. Uniform shift ONLY — moving/
  reordering EXISTING sessions is deliberately unsupported (it can invert a tie's `[start, end)`
  interval and silently corrupt as-of history). `deleteSession` still never renumbers. The dialog bumps
  `sessionsVersion` + `entitiesVersion` (graph + EntityHistory read stored numbers; EntityHistory now
  drops its rows cache on `entitiesVersion`). Integration test:
  `tests/integration/insert-session-before.test.ts` (every as-of read at n+1 ≡ the pre-shift read at n). the three AI lenses share a `LensResultBar`
  (Copy · **Save note** → a campaign-lore note via `ledger.note.create` entityIds:[] · **Recent** popover
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
  `entitiesVersion`). Rendered as themed SVG (hand-rolled pan/zoom/node-drag; each entity type gets its own
  muted outline color + lucide icon (`ENTITY_TYPE_COLOR`/`ENTITY_TYPE_ICON` in `lib/entity-visuals.tsx` →
  `--type-*` tokens) with a corner legend, the MC keeping a brighter/thicker ember ring — the one data-viz
  surface off the single-accent rule, ADR-046 revising ADR-040); the sim is **guarded on
  `activeView === 'web'`** (MainPanel keeps views mounted) — builds/reheats on activation, `stop()`s +
  cancels rAF when hidden, positions cached in a ref so a data change doesn't scramble. No migration for the
  graph. **ENRICHED (ADR-050):** `buildCampaignGraph` now takes an optional **`asOf`** (threaded through the
  whole IPC chain) — with it the graph is the web AS OF that session: edges live at N via `isIntervalLiveAt`
  (+ `severed`/`justFormed` flags for the "what changed" pulse + ghost), node lifecycle via
  `resolveEntityState`, and the node SET stays the full cast so the layout doesn't scramble as the header
  **time slider + ▶ playback** scrubs. **`GraphEdge` widened** to carry disposition/confidence/description/
  `directed`/interval → the renderer colours edges by disposition (a warm/cold **keyword heuristic** in
  `WebView.tsx`), dashes by confidence, draws arrowheads on directed relations
  (`RELATIONS[k].symmetric === false`), and sizes nodes by **degree**. The view is now an **AI hub** via the
  new **`openLens`** ui-store seam (`pendingLens = {view,targetId?,query?}`, consumed on mount by
  `ConverseView`/`RecallView`, cleared via `consumePendingLens`): a node's **right-click menu** → Converse an
  NPC / ask Lore about it / Open; **shift-click two nodes** → Lore "what's between them?". Plus interactive
  **type-filter chips** (the legend is now clickable) + hide-fallen, **search/jump-to-node** (centres on a
  match), **click-to-focus** (isolate 1-hop neighbours; background-tap clears), opt-in **clustering** (a gentle
  grouping force by `located_in`/`member_of` parent, derived from the live edges), and **PNG export**. Plain
  node-open moved into the context menu (MC → `'character'`, else `setSelectedEntity` + `'capture'`).
  **Shortest-path + graph-side merge/set-portrait deferred; no new dep** (native range slider + hand-rolled
  overlay menu, not shadcn/Radix). **LEGIBILITY AT SCALE (ADR-053):** four decluttering controls, split by
  whether they reshape the layout. The pure **`lib/graph-reduce.ts`** (`parentOf`/`descendantsOf`/
  `collapsibleParents`/`reduceGraph`; unit-tested, mirrors `lib/mention.ts`) produces the node/edge set the
  sim BOTH simulates and renders, so **`effective = reduceGraph(graph, {collapsed, hideMinor, mainCharacterId})`**
  feeds `degree`/`visibleIds`/`neighborhood`/`nodeById`/the sim build + the rebuild `signature` — hence
  **#2 Hide-minor** (drop < 2-tie nodes, never the MC/super-node) and **#3 Collapse** (fold a `located_in`/
  `member_of` group TRANSITIVELY into the parent — the parent's own id IS the super-node id; descendants'
  external edges reroute + dedupe, internals drop; a clickable **count badge** + right-click **Collapse/Expand
  group** + **Expand all** chip; dashed halo when folded) actually TIGHTEN the layout. **#1 Label LOD** and
  **#4 Hide-rumored** are render-only (labels rationed by small-graph ≤30 / zoom `k≥1.4` / hub degree≥3 / MC /
  `hoveredId` / focus, edge labels only zoomed/hovered/focused; weak-edge skip needs raw `confidence` on
  `SimLink`). Type/hide-fallen/focus stay render-only (`visibleIds`) so they don't reshuffle. `parentOf`
  generalizes the old inline `clusterOf` to both authored directions (`PARENT_SIDE` over `HIERARCHY_RELATIONS`);
  grouping derives from the as-of `graph.edges` (NOT `getHierarchy`, which is structural) so collapse is
  as-of-correct under the slider. Header counter stays campaign totals + a conditional `· N hidden`. No
  migration; renderer-only.
- **Feedback = Report a bug + Request a feature (ADR-057/058/064): a "Feedback" SECTION on the SETTINGS
  page** (`data-tour="feedback"`; renamed from "Report a bug" by ADR-064 — it now hosts BOTH buttons).
  (ADR-060 moved it out of the sidebar and REMOVED the window-snap-before-open + the whole
  `bugreport:capture` IPC — from Settings the snap only ever captured Settings; screenshots are attached
  by hand) opening `components/BugReportDialog.tsx`: name (prefilled from `settings.userName`) + optional
  reply email + required description + screenshots (paste/drag/picker, cap 5) + an ALWAYS-INCLUDED
  diagnostics block attached SILENTLY — no in-dialog toggle or review panel (deliberate: reports without
  diagnostics don't triage; the tester still sees the full text in the revealed bundle's report.txt, and
  submit AWAITS the in-flight gather promise so a fast submit never drops the block)
  (`bugreport:diagnostics` — version/OS/current view/key·online·
  model readiness/campaign COUNTS-never-content/`main.log` tail). **Submit AUTO-SENDS once the intake
  worker is deployed (ADR-058)**: iff `BUG_REPORT_ENDPOINT` (`@shared/ipc-types`) is non-empty,
  `submitBugReport` POSTs `buildReportPayload` (JSON; shots as `{filename, content(base64)}`; optional
  `replyTo`; 15 s abort)
  with the `x-custos-report` `BUG_REPORT_TOKEN` header to the Cloudflare Worker
  (`infra/bugreport-worker/` → Resend → `BUG_REPORT_EMAIL`; deploy runbook in its README). This is the
  app's ONE deliberate non-Anthropic egress — user-initiated + labeled; the renderer gates copy/labels/the
  optional reply-email field on the same const (`AUTO_SEND`), so an undeployed build reads EXACTLY like the
  old flow. A DELIVERED report writes NOTHING to disk (`dir: null` — no local copy, by request); endpoint
  empty or POST failed/offline → the ADR-057 FALLBACK, which ALONE writes the bundle
  (`userData/bug-reports/<stamp>/report.txt` + `screenshot-N.*` — the draft needs files to drag in):
  prefilled `mailto:` draft + `shell.showItemInFolder` (mailto can't attach → two-step drag;
  `mailOpened:false` → copy-report + the address); `BugReportResult.sent` drives the done-panel. Pure helpers (`buildMailtoUrl` body-capped
  ~1.2 KB, `formatReportText`, `dataUrlToImage`, `buildReportPayload`) are unit-tested incl. auto-send +
  fallback via a stubbed fetch; `tests/e2e/bugreport.spec.ts` guards launcher → capture → dialog → the
  description-gated submit. No migration; no new deps (the worker is plain JS deployed via npx wrangler).
  **REQUEST A FEATURE (ADR-064)** is the section's second option: `components/FeatureRequestDialog.tsx` (the
  bug dialog MINUS screenshots/diagnostics, PLUS two textareas — **problem** + **proposed feature**; gate =
  both non-empty) → `ledger.featurerequest.submit` → `submitFeatureRequest` (same POST-first/mailto-fallback
  shape via the shared `postToWorker`; fallback writes `feature-requests/<stamp>/request.txt`, no
  attachments). It's a DIFFERENT EMAIL KIND on the SAME worker/token/inbox: the payload carries
  `kind:'feature'` and the **worker branches** — subject `[Custos] Feature request`, a Problem/
  Proposed-feature body, no attachments (an absent `kind` stays the bug path, backward-compatible).
  **GOTCHA: the worker must be REDEPLOYED (`npx wrangler deploy`) before shipping the feature button** — an
  old worker ignores `kind`/`problem`/`proposedFeature` and 400s (it still requires `description`). Tests:
  feature cases in `bugreport.service.test.ts` (inject `{endpoint:'',token:''}` / a fake CFG — never the live
  worker) + `tests/e2e/featurerequest.spec.ts` (both-fields gate). No migration; no new deps.
- **Home — the dashboard + DEFAULT landing view (ADR-061, `views/HomeView.tsx`):** identity hero
  (campaign + MC `Portrait` + last-played) · "Previously…" (the SAME `SessionRecap` mounted for the
  latest session, key-gated) · needs-attention (unclosed-extract counts, setup nags, **two before-session-1
  items (ADR-063): "Fill in your character"** — shown until the MC has a generated persona, via the local
  `useMcPersonaReady` hook [`ledger.persona.get`, refetch on `entitiesVersion`; `PersonaEditor.generate`
  now BUMPS `entitiesVersion` so it clears live] — **and "Start your first session"** — shown when the
  campaign has no sessions (`needsFirstSession(sessions)`, loading-guarded) · and a RECORD-HEALTH
  probe — **`ContinuityRequest.checksOnly`**: deterministic checks only, free/keyless, the AI pass
  reports `skipped/checks_only` and `AiStatusBanner` renders null for it) · open threads (active quests
  + rumored/suspected notes) · type-chip stats · **`components/home/MiniWeb.tsx`** (the Web view's
  d3-force recipe run to completion SYNCHRONOUSLY in a useMemo — `.stop()` + tick×150 — ≤50 top-degree
  nodes, click → `'web'`) · "From the archives…" (a dormant active entity or an old rumor, DAY-seeded
  pick, so it rotates daily not per-render) · an ask box that PRE-FILLS Lore via `openLens` (never
  auto-asks) + recent questions across all four lenses. Widget math is the PURE **`lib/dashboard.ts`**
  (unit-tested, `tests/unit/renderer/dashboard.test.ts`). **Lens history is STORE-side now**
  (`ui-store.lensHistory` + `rememberLens`; entries carry `at`; `useLensHistory(lens)` keeps its shape —
  the four lens views just pass their key) so Home reads what the lenses write. Tutorial: the REVIEW
  card floats over Home and `finish()` lands there. **Four e2e specs navigate to Chronicle first**
  (capture/extract/recap/transcribe — the default view is Home now); `home.spec.ts` covers landing →
  fill-in → the Lore hand-off. No migration.
- **Tests** run as `cross-env ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run` (the
  native better-sqlite3 binding needs the Electron ABI). If `npm test` / `cross-env` isn't resolvable in
  a raw shell, invoke `./node_modules/.bin/electron` directly with `ELECTRON_RUN_AS_NODE=1`.
- **e2e (Playwright)** run via `npm run test:e2e` = `electron-vite build && playwright test` — it
  **rebuilds `out/`** first, so a main/preload change must go through this script (raw `playwright test`
  uses the stale build). `tests/e2e/helpers.ts` `launchApp()` boots the built app against a throwaway
  `--user-data-dir` (fresh DB, keyless, no embedding model — indexing no-ops gracefully). **AI-driven
  flows are e2e-testable via the fake-AI seam (ADR-041):** `launchApp({ fakeAi: true })` sets
  `LEDGER_FAKE_AI`, and `src/main/services/ai-fake.ts` (`fakeAiEnabled` = env `&& !app.isPackaged`) makes
  `import.service.extract` / `enrich.service.enrichEntity` return canned proposals + `ai-util.isOnline`
  return true — the real IPC + validators + DB apply still run. The seam is inert in any normal/packaged
  run and under vitest (env unset → short-circuits before `app.isPackaged`). **The seam covers EVERY AI
  lens now (ADR-043):** `ai-fake.ts` also has `fakeSuggest`/`fakeDirections` (Counsel), `fakeConverse`,
  `fakeDerive` (Draft), `fakePersona`, and `FAKE_RECALL_TEXT`/`FAKE_RECAP_TEXT`, branched in the matching
  service after its guards (Transcribe reuses `fakeExtraction`). Two wrinkles: (1) Counsel/Converse/Recall
  call `generatePersona → complete()` first, so `persona.service` fakes that too; (2) Counsel/Recall gate
  on `isModelReady()` — `ipc/onboarding.ts` reports `modelReady || fakeAiEnabled()` (button enables) and the
  services skip `embed`/dense but KEEP the model-free `fuzzyEntityChunks` (real grounding). Streaming lenses
  (Recall/Recap) emit canned prose via the existing `onText`. Test helpers `createCampaign` /
  `plantKeyAndReload` (`helpers.ts`); specs per flow (`suggest`/`converse`/`recall`/`recap`/`transcribe`/
  `draft`/`extract` — the last replaces `close-out`, ADR-051). **e2e green** (18 tests across 13 spec files).
- **Distribution + auto-update (docs/ROADMAP.md P2-1, ADR-042):** `npm run dist` builds the NSIS installer
  (`Custos Setup X.Y.Z.exe`) via `electron-builder.yml`; the `publish: github` block makes it also emit
  `latest.yml` (the electron-updater feed). **Auto-update is PACKAGED-ONLY** — `services/updater.service.ts`
  (`initAutoUpdater`/`checkForUpdates`/`quitAndInstall`) guards on `!app.isPackaged`, so it no-ops in dev
  and e2e (the Settings control reports `disabled`); it's wired via `ipc/update.ts` `registerUpdateHandlers(send)`
  (called from `handlers.ts`), pushing `UpdateStatus` on `UPDATE_STATUS_CHANNEL` (mirrors
  `onModelDownloadProgress`) to the **Settings "Your data"** "Check for updates" / "Restart to update"
  controls. electron-updater is a CJS dep imported named (`import { autoUpdater } from 'electron-updater'`)
  — same interop as `import { app } from 'electron'`. **License is proprietary** (`package.json` `UNLICENSED`
  + `LICENSE`; source-available, not open-source). Builds are **unsigned** unless `CSC_LINK`+`CSC_KEY_PASSWORD`
  are set (electron-builder auto-signs; the release CI passes them through). Releases: push a `v*` tag →
  `.github/workflows/release.yml` runs `electron-builder --publish always` → a DRAFT GitHub Release (publish
  it to go live; **Releases must be PUBLIC** for token-free update). Full runbook in `RELEASING.md`.
- **Forced first-run tutorial = a PER-PAGE SPOTLIGHT WALKTHROUGH (ADR-059 machinery, ADR-060 flow):** ONE
  full-screen page (`onboarding/WelcomeCard.tsx` — `WELCOME_COPY` in guide-content is **PLACEHOLDER, Nick
  rewrites**; captures `userName` + writes `tutorialStep:'campaign'` awaited), then the REAL app under
  `onboarding/Spotlight.tsx`'s FOUR step kinds: **ACTION** (4-rect z-40 click-blocking scrim + an
  INTERACTIVE ring cutout over one real control via **`data-tour` attributes**; Radix portals are z-50 at
  body end so dialogs opened mid-step stay usable ABOVE the scrim), **INFO** (cutout visible-not-operable
  + Next), **PAGE** (`PageOverlay`: the page UNDIMMED behind a full-viewport view-only blocker, ONLY the
  sidebar dimmed, the coach CARD fixed OVER the navbar — left, centered; the settings stop passes a
  `scrollSelector` whose wheel events forward to the `.overflow-y-auto` container: scroll, don't touch),
  and **REVIEW** (`ReviewShell`: dimmed backdrop + a centered scrollable card). `TutorialOverlay.tsx`
  drives **19 stops**: campaign (ACTION — the real atomic `CreateCampaignDialog`, ADR-029) → Character
  page → Chronicle page → session (ACTION, `new-session`) → the composer (INFO, `chronicle-composer`,
  explain-only by request) → Sessions page → Extract → Illuminate → Transcribe → Generate recap (INFO
  each — `data-tour="tool-*"` on SessionsView's header buttons + SessionRecap's button; the newest session
  AUTO-SELECTS so they render) → Codex → Web → Lore → Counsel → Converse → Continuity (PAGE each;
  Continuity's copy segues into the key) → apikey (ACTION — VALIDATED key via the ui-store
  **`keySavedNonce`** SettingsView bumps per save; validate once per bump + an entry probe; **but the key is
  now OPTIONAL — a "Skip for now" button advances keyless (ADR-063), and Home's needs-attention key nag
  carries the reminder**) → Settings
  page (PAGE, scrollable; explains Settings + Report a bug's new home there) → review (REVIEW:
  `LOOP_STEPS` + `TOUR_GROUPS`/`TOOL_BLURBS` + the Quickstart pointer + **`REVIEW_COPY` — the SECOND
  placeholder Nick writes**; Finish). **ACTION steps advance by WATCHING state** (campaigns.length /
  activeSessionId / key valid) so they're idempotent — the resume story: each advance persists
  `AppSettings.tutorialStep` (cleared on finish with `tutorialCompleted:true`), and the gate is the pure
  `services/onboarding-gate.ts` `deriveTutorialDone` = `completed || skipped || (campaigns>0 &&
  tutorialStep===undefined)` — a mid-tour relaunch RESUMES (the tour creates a REAL campaign at step 1)
  while pre-tutorial data stays grandfathered; `OnboardingStatus.tutorialStep` rides the same status
  fetch AppShell gates on. Linear, no Back, no skip; AppShell still disables Ctrl+K/F while active. The
  **Quickstart guide** ("Guide", sidebar bottom) is unchanged; blurbs/groups/loop/key-steps +
  `WELCOME_COPY`/`SPOTLIGHT_COPY`/`REVIEW_COPY` all live in ONE `lib/guide-content.tsx` (TOUR_GROUPS ask
  keys include `continuity`). **e2e:** `launchApp` sets `LEDGER_SKIP_TUTORIAL` BY DEFAULT;
  `launchApp({ tutorial: true, fakeAi: true })` drives `tutorial.spec.ts` (a shared `driveToApiKey` helper
  + two tests: the key-entered happy path and the **Skip-for-now** keyless path, ADR-063 — the latter
  asserts Home then nags for the key + the character; `apikey:validate` returns valid under `fakeAiEnabled`
  but `keyReady`/`apikey:exists` stay honest). `AppSettings` fields: `userName?`,
  `tutorialCompleted?`, `tutorialStep?`. Multi-provider (OpenAI/Gemini) keys remain **deferred** — a
  separate AI-backend project (docs/ROADMAP.md).

## Git
Work lands on `main`. A remote (`origin`) is configured, but the GitHub repo may not exist yet, so
`git push` can fail with "Repository not found" — commit locally until the repo is created. Co-author
commits per your harness's convention.
