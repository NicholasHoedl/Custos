# Ledger — Development Roadmap

**Version:** 0.1 (MVP Planning)
**Date:** 2026-06-25 · **Status updated:** 2026-07-02
**Status:** ✅ **Shipped — all phases (P0–P3) complete.** This is now the *historical* MVP plan,
kept in place because ADRs and SPEC reference its item codes (P0-01…P3-04). Current product scope
lives in **`SPEC.md` §10 (Delivered beyond the MVP)** and **`docs/adr/`** — development continued
past this plan with: current scene (ADR-015), many-to-many notes, the multi-tag Suggest overhaul
(ADR-016, superseding the 4-of-7 model written below), session recap (ADR-013), paste-and-extract
import (ADR-014), chronology / as-of reconstruction (ADR-017), and the backfill interview (ADR-018).
The Phase 4+ section below remains the deferred-ideas backlog.

---

## Overview

Four phases deliver the full MVP. Each phase ends at a testable checkpoint. No phase should be started before the previous phase's done-criteria are verified.

```
Phase 0 — Scaffold       ~1–2 weeks
Phase 1 — Capture        ~2–3 weeks
Phase 2 — Recall         ~2–3 weeks
Phase 3 — Suggest        ~1–2 weeks
Phase 4+ — Later         (deferred; listed for planning reference)
```

---

## Phase 0: Scaffold

**Goal:** A working Electron + React + TypeScript skeleton with the local database connected, the IPC bridge typed and verified, and the visual design system in place. Nothing user-facing beyond an app shell. All infrastructure decisions locked in.

### Key Tasks

**P0-01: Project initialization**
- Initialize project with `electron-vite` (TypeScript template)
- Configure `tsconfig.json`, `tsconfig.main.json`, `tsconfig.renderer.json`
- Set up ESLint (flat config) + Prettier
- Add `.gitignore` appropriate for Electron (exclude `node_modules`, `dist`, `out`, `resources/models`)
- Verify `npm run dev` opens an Electron window with a blank React page
- Expected output: `electron-vite dev` starts without errors; hot reload works

**P0-02: Tailwind + shadcn/ui setup**
- Install Tailwind CSS v4 (the `@tailwindcss/vite` plugin); configuration is **CSS-first** via an `@theme` block in globals.css — no `tailwind.config.ts`
- Run `shadcn init` with the project's component output directory (`src/renderer/components/ui`)
- Install initial shadcn primitives: Button, Card, Dialog, Input, Textarea, ScrollArea, Separator, Badge, Tooltip
- Create `src/renderer/styles/globals.css` with CSS custom properties for the confirmed color palette (cool cyan→slate→charcoal; dark-first — dominant = jet-black/slate, single sharp accent = vivid cyan `#32e5eb`; see ARCHITECTURE §1 "Color Palette & Design Language" for the full Tailwind palette and the anti-"beige ledger" guardrails), plus font-face declarations for Bricolage Grotesque, Fraunces, and JetBrains Mono
- Expose the semantic tokens to Tailwind via an `@theme inline` block in globals.css (Tailwind v4 CSS-first; no `tailwind.config.ts`)
- Verify fonts render correctly in the Electron window
- Expected output: A styled "Ledger" heading in Fraunces renders; a shadcn Button renders; no inline styles present

**P0-03: SQLite + Drizzle setup**
- Install `better-sqlite3` and its TypeScript types; install `drizzle-orm` and `drizzle-kit`
- Write `src/main/db/schema.ts` with all tables from the data model (Campaign, Session, Entity, Note, EntityLink, EventLog) — no vector tables yet
- Write the initial Drizzle migration; run it against a dev database at `app.getPath('userData')/ledger.db`
- Write a thin `src/main/db/index.ts` singleton that opens the connection and applies migrations on startup
- Expected output: App starts, database file is created, migration runs without error; `better-sqlite3` opens the file and a test query returns a result

**P0-04: IPC bridge**
- Write `src/shared/ipc-types.ts` with all typed channel definitions (placeholder implementations return empty arrays/null)
- Write `src/preload/index.ts` exposing `window.ledger` via `contextBridge`
- Verify `window.ledger` is accessible in the renderer and TypeScript knows its shape
- Expected output: Renderer can call `window.ledger.campaign.list()` and receive an empty array; TypeScript does not complain

**P0-05: App shell layout**
- Build `AppShell`, `Sidebar`, and `MainPanel` components using shadcn primitives and Tailwind only
- Sidebar: campaign selector (placeholder), navigation icons for Capture / Recall / Suggest / Settings
- Main panel: **single-window panel switching** (confirmed) — a router / tab switcher renders one feature view at a time; no persistent secondary AI drawer
- Expected output: Clicking sidebar nav items switches the main panel; layout looks intentional (not default browser styles)

**P0-06: Test infrastructure**
- Install Vitest; configure to run tests in the `tests/unit/` and `tests/integration/` directories
- Install Playwright; configure for Electron (using `electron` as the test driver)
- Write a trivial unit test (e.g. a pure function from `shared/constants.ts`) that passes
- Write a trivial Playwright smoke test that launches the Electron app and checks the window title
- Expected output: `vitest run` passes; `playwright test` opens the app and passes the smoke test

**P0-07: Global hotkey + single-instance scaffolding**
- Add `app.requestSingleInstanceLock()` in `src/main/index.ts`; on a second instance, focus the existing window
- Register a `globalShortcut` (configurable; default e.g. `Ctrl+Alt+L`) on `app.whenReady()` and release it on `will-quit`. For Phase 0 it can simply show/focus the main window (full quick-capture behavior lands in Phase 1)
- Decide the trigger behavior — focus main window vs. dedicated quick-capture popup window — and record it as ADR-010
- Expected output: pressing the global hotkey while another app is focused brings Ledger to the foreground; only one instance can run

### Done Criteria for Phase 0 — ✅ all met

- [x] `npm run dev` launches the Electron app without errors or console warnings
- [x] The visual design system (fonts, colors, shadcn) is applied and visible — and reads as distinctive, not generic shadcn components recolored (per ARCHITECTURE §1 design language)
- [x] SQLite database is created and migrated on startup
- [x] Typed IPC bridge is verified end-to-end (renderer call → main handler → typed response)
- [x] Unit test suite runs (`vitest run` passes)
- [x] Playwright smoke test passes
- [x] Global quick-add hotkey brings the app to focus from another app; single-instance lock works
- [x] ADRs 001–010 are written and committed

---

## Phase 1: Capture

**Goal:** A fully functional note-taking UI for live play. The developer can run Ledger at a D&D session and capture campaigns, sessions, NPCs, locations, quests, items, events, and quotes — all with fast entry and persistent local storage. No AI. No embeddings yet.

### Key Tasks

**P1-01: Campaign management**
- Implement `campaign.service.ts`: create, list, get, update
- Implement IPC handlers for campaign channels
- Build campaign selector in Sidebar (create new campaign, switch campaigns, edit campaign name/description)
- Store active campaign in `app-store.ts`
- Expected output: Developer can create "The Lost Mines" campaign, see it in the sidebar, switch to it

**P1-02: Session management**
- Implement `session.service.ts`: create, list, get, update
- Build session creation flow in Capture view (new session auto-numbers, date defaults to today, optional title)
- Display active session in `SessionHeader` component
- Store active session in `app-store.ts`
- Expected output: Developer creates "Session 1 — The Goblin Ambush", it appears in a session list, and becomes active

**P1-03: Entity CRUD — NPC and Location**
- Implement `entity.service.ts`: create, list, get, update for all entity types
- Build `EntityForm` component (name, type selector, description, traits textarea, goals textarea)
- Build `EntityList` and `EntityCard` for NPC and Location types
- Build `EntityDetail` panel
- Expected output: Developer can create NPC "Aldric Vane" with description and traits, see him in the NPC list, and click to view/edit

**P1-04: Entity CRUD — remaining types**
- Extend entity views to cover Faction, Quest/Plot Thread, Item, Player Character
- PC entity has special prominence in the sidebar (active PC selector — used later by Suggest)
- Expected output: All entity types can be created, listed, and edited; active PC is selectable in the sidebar

**P1-05: Note attachment**
- Implement `note.service.ts`: create, list, update for notes attached to entities
- Build note entry area in EntityDetail (a textarea + submit button; note appears in a timestamped list below)
- Notes are linked to the current active session automatically on creation
- Expected output: Developer opens "Aldric Vane", adds a note "Said the north road is dangerous — bandits in the last month", note appears timestamped, linked to Session 1

**P1-06: Entity linking**
- Implement entity link creation/deletion in `entity.service.ts`
- Add a "Link to..." UI in EntityDetail (autocomplete search for entities in the same campaign)
- Render linked entities as `EntityBadge` components in EntityDetail
- Expected output: Developer links NPC "Aldric Vane" to Location "Copper Kettle Inn" with relation "located_in"; the badge appears on both entity detail pages

**P1-07: Quick-add bar + global hotkey**
- Build `QuickAddBar` as a persistent element in the Capture view (always visible when a session is active)
- In-app shortcut: focus the quick-add bar with `Ctrl+K`
- **Global hotkey** (scaffolded in P0-07): pressing the system-level hotkey when Ledger is not focused triggers the chosen quick-capture path (focus main window with quick-add focused, or the dedicated quick-capture popup — per ADR-010), writes to the active campaign/session, and returns the user to their game
- Flow: type name, Tab to type selector, Tab to brief note field, Enter to save
- Saves as an Entity (if name implies one) or as an EventLog entry
- Expected output: Developer presses the global hotkey while another window is focused, captures "Aldric Vane" as an NPC in under 5 seconds, without manually switching to Ledger first

**P1-08: Event/quote log**
- Build `EventFeed` component showing all EventLog entries for the active session in chronological order
- Quick-add for events: select "Event/Quote" type in QuickAddBar, optionally tag an existing entity
- Expected output: Developer captures a quote, it appears in the event feed with timestamp; tagged entities are clickable

**P1-09: Local text search**
- Implement `search:text` IPC handler: full-text search over entity names, descriptions, and note content using SQLite LIKE or FTS5
- Build a search input in the Sidebar (Ctrl+F or a dedicated search box)
- Results show entity type, name, and a snippet
- Expected output: Typing "north road" returns Aldric's note

**P1-10: Phase 1 tests**
- Unit tests for all services (campaign, session, entity, note)
- Integration test: create campaign → session → entity → note → verify all in DB
- Playwright test: quick-add flow (keyboard shortcut → type → Enter → entity appears in list)
- Expected output: All tests pass; coverage meaningful on service layer

### Done Criteria for Phase 1 — ✅ all met

- [x] Developer can complete the "Capture" user flow from SPEC.md (Flow A and Flow B) end-to-end
- [x] All entity types (NPC, Location, Faction, Quest, Item, PC, Event) can be created, read, and updated
- [x] Notes are saved, timestamped, and linked to the active session
- [x] Entity links are created and displayed
- [x] Quick-add bar works with keyboard; entry time under 10 seconds for a new NPC with a one-line note
- [x] Local text search returns relevant results
- [x] App closes and reopens with all data intact
- [x] Service-layer unit tests pass; integration test passes; Playwright Capture test passes

---

## Phase 2: Recall

**Goal:** Semantic search over campaign notes. The developer can ask a natural-language question and receive a Claude-synthesized, cited answer. The retrieval step works offline; synthesis requires the API.

### Key Tasks

**P2-01: API key management**
- Implement `key.service.ts` using `electron.safeStorage`: encrypt/decrypt/exists
- Build `ApiKeyInput` component in Settings panel: password-style input, "Save" button, validation call
- Implement `apikey:set` and `apikey:validate` IPC handlers
- On validate: instantiate an `@anthropic-ai/sdk` client with the key and call `client.models.list()` or a minimal test call; return `{ valid: boolean }`
- Expected output: Developer enters API key in Settings, clicks Save, sees a "Key saved securely" confirmation; restarting the app retains the key (decrypts from safeStorage)

**P2-02: Transformers.js + embedding model integration (with explicit onboarding download)**
- Install `@xenova/transformers`
- Implement `embedding.service.ts`: lazy-load the `all-MiniLM-L6-v2` pipeline; expose `embed(text: string): Promise<Float32Array>`
- **Explicit first-run onboarding step** (developer decision — not a silent background download): a dedicated onboarding screen prompts the user to download the embedding model (~25 MB ONNX) with a visible progress bar, to `app.getPath('userData')/models/`. AI features (Recall / Suggest) stay disabled until the model is present and the API key is set
- Persist a "model ready" flag so onboarding shows only once (re-offer if the model files go missing)
- Write a unit test: `embed("Hello world")` returns a Float32Array of length 384
- Expected output: First run shows an onboarding download step that completes with progress; afterwards embedding calls are fast (< 100ms for short strings)

**P2-03: sqlite-vec integration and vector store**
- Load the `sqlite-vec` extension in `db/index.ts` using `Database.loadExtension()`
- Add `NoteEmbedding` and `EventEmbedding` tables to the Drizzle schema (migration)
- Implement `vector-store.service.ts`: `upsert(id, embedding)`, `search(queryEmbedding, campaignId, topK)` using `sqlite-vec`'s `vec_cosine_similarity` or `knn_each` virtual table
- Write an integration test: embed two strings, store both, query with a similar string, verify the more similar one ranks higher
- Expected output: Vector similarity search returns correct ordering for known test cases

**P2-04: Ingest pipeline — embed notes on save**
- In `note.service.ts`, after writing a note to SQLite, call `embeddingService.embed(note.content)` and `vectorStore.upsert(note.id, embedding)`
- Handle async carefully: embedding runs in the same main process; for the MVP it can be synchronous (awaited before returning to the IPC handler). Add a TODO comment if this causes perceptible lag
- Backfill: implement a one-time migration utility that embeds all existing notes that lack an embedding (run on app startup if any notes are unembedded)
- Expected output: After creating a note, a corresponding row exists in `NoteEmbedding`; backfill runs on startup without crashing

**P2-05: Claude integration — streaming recall**
- Install `@anthropic-ai/sdk`
- Implement `claude.service.ts`: build the `recall()` method
  - Assemble document blocks from retrieved chunks with `citations: { enabled: true }`
  - Apply prompt caching: mark the system prompt + campaign context prefix with `cache_control: { type: "ephemeral" }`
  - Call `client.messages.stream()`, iterate the stream, send tokens to the renderer via `'stream:chunk'` IPC events
  - On stream completion, extract `citations` from the final message and send via `'stream:done'`
- Implement `recall.service.ts`: orchestrate embed → search → offline check → Claude call
- Expected output: Recall query streams tokens to the renderer; final message includes citations

**P2-06: Recall UI**
- Build `RecallPanel` with `RecallQuery` (text input + submit button), `RecallAnswer` (streaming text display), and `CitationLink` components
- `useStream` hook: subscribes to `'stream:chunk'` and `'stream:done'` IPC events and accumulates the streaming response in React state
- Citations render as clickable badges below the answer; clicking a citation scrolls to or opens the source entity/note
- Offline degradation: if `recall.service.ts` returns `{ available: false }`, display the retrieved chunks in a "raw results" view instead of the synthesized answer
- Expected output: Developer types "What did Aldric say about the north road?", sees the answer stream in, sees a citation badge linking to Session 1 → Aldric Vane note

**P2-07: Phase 2 tests**
- Unit tests: `embedding.service.ts`, `vector-store.service.ts`, `recall.service.ts` (with mocked Claude client)
- Integration test: note created → embedded → stored → queried → correct chunk retrieved
- Playwright test: Recall panel query with a mocked Claude response (use `nock` or Electron test utilities to intercept the Anthropic API call)
- Expected output: All tests pass; mocked Recall test shows streamed answer and citation badges

### Done Criteria for Phase 2 — ✅ all met *(shipped with the brute-force JS vector store per ADR-012, not sqlite-vec as planned in P2-03)*

- [x] Developer can complete the "Recall" user flow from SPEC.md (Flow C) end-to-end
- [x] API key is saved securely and persists across restarts
- [x] Notes created in Phase 1 are automatically embedded on save
- [x] Natural-language query returns a streamed, cited answer referencing the correct source notes
- [x] Citations are clickable and link to the source entity
- [x] Offline: retrieval works; synthesis shows graceful degradation message
- [x] Unit tests for embedding, vector store, and recall (mocked Claude) pass
- [x] Integration RAG pipeline test passes
- [x] Playwright Recall test (mocked Claude) passes

---

## Phase 3: Suggest

**Goal:** In-character action recommendations during live play. The developer describes the current situation and receives **4 distinct attitude-based recommendations** — the model selects the 4 attitudes the active PC is most likely to adopt and writes a unique in-character action for each — via a Claude Opus 4.8 structured-output call (adaptive thinking), grounded in the PC's traits and campaign history.

> **As shipped:** the 4-of-7 fixed-attitude model below was later superseded by **ADR-016** — Counsel
> (formerly Suggest) now returns **6 options** (trimmed from 8 in ADR-026) from a multi-tag vocabulary
> (1 primary + ≤2 secondary tags), plus an open-ended "what's next" directions mode. The text below is
> the historical plan.

### Key Tasks

**P3-01: Suggest service**
- Implement `suggest.service.ts`: build the `suggest()` method (returns a structured `SuggestResult`, not a token stream — see ARCHITECTURE §6)
  - Pull active PC entity (traits, goals, description)
  - Pull active campaign description
  - Run RAG retrieval: embed the situation string, retrieve top-k chunks from the campaign's note history (filter for notes relevant to the PC and current context)
  - Build prompt: system role ("You are an advisor to [PC name], a [class/traits]…") + cached prefix (campaign + PC context) + volatile suffix (retrieved history + situation). Instruct the model to (1) pick the **4** attitudes from the taxonomy the PC is most likely to adopt here, and (2) write one unique in-character action per chosen attitude
  - Call Opus 4.8 with adaptive thinking (`thinking: { type: "adaptive" }` + `output_config: { effort: "high" }`) **and structured output** (`output_config.format` json_schema; `attitude` is an `enum` of the taxonomy). Use a single `client.messages.parse()` call — no streaming
  - **Validate in code:** exactly 4 recommendations, 4 distinct attitudes, each with a non-empty action; re-prompt or backfill if the model returns the wrong count or a duplicate (schema cannot enforce array length / uniqueness)
- Expected output: `suggest.service.ts` unit test with a mocked Claude returns a `SuggestResult` of 4 distinct `{attitude, action}` pairs grounded in the provided context

**P3-02: Suggest UI**
- Build `SuggestPanel` with:
  - Active PC display (name, traits — pulled from app-store active PC)
  - `SuggestInput`: free-text situation field + Submit button + optional thinking-effort toggle (`effort`: medium/high)
  - `SuggestOutput`: renders **4 distinct attitude cards**, one per returned recommendation — each shows the attitude label, the in-character action, and (if present) the short rationale; a "Thinking…" indicator shows while the structured call runs
- Cards should be visually differentiated per the design language (not generic recolored boxes)
- Offline degradation: clear "Suggest requires an internet connection" message when offline
- Expected output: Developer fills in a situation, clicks Submit, and sees 4 attitude cards appear together, each with a distinct in-character action

**P3-03: Active PC integration**
- PC selector in Sidebar (or Settings) sets the active PC in `app-store.ts`
- Active PC is passed to Suggest service automatically
- Suggest panel shows PC name and key traits as context reminders
- Expected output: Switching active PC changes which character's perspective the Suggest feature uses

**P3-04: Phase 3 tests**
- Unit test: `suggest.service.ts` with a mocked Claude — verify the prompt includes PC traits + retrieved history, and that the post-call validation enforces exactly 4 distinct attitudes (test the duplicate / wrong-count re-prompt path)
- Playwright test: Suggest panel with a mocked structured response renders 4 attitude cards
- Expected output: Tests pass; the 4-distinct-attitude contract is verified

### Done Criteria for Phase 3 — ✅ all met *(as 4-of-7 originally; later evolved to 6 multi-tag options, ADR-016/026)*

- [x] Developer can complete the "Suggest" user flow from SPEC.md (Flow D) end-to-end
- [x] Active PC context (traits, goals) is included in the Suggest prompt
- [x] Retrieved campaign history is included in the Suggest prompt
- [x] Suggest returns **exactly 4 distinct attitude-based recommendations**, each a unique in-character action, via Opus 4.8 structured output + adaptive thinking
- [x] Code validates the count and attitude-uniqueness (handles a malformed model response)
- [x] UI renders the 4 recommendations as distinct attitude cards
- [x] Offline: clear unavailability message shown
- [x] Unit and Playwright tests pass

---

## Phase 4 and Later (Deferred)

These are listed in approximate priority order for planning reference. None are in scope for the MVP.

**Phase 4: Polish and hardening**
- Full keyboard navigation and accessibility audit
- Model selection UI (Sonnet vs Opus for Recall)
- Better error messages and recovery (network failures, quota errors, model errors)
- App update mechanism (electron-updater)
- Onboarding polish (the MVP already includes the first-run API-key + model-download step in Phase 2; this is refinement — guided tour, re-run, richer progress UI)
- Performance profiling of embedding ingest on large note sets

**Phase 5: Recall enhancements**
- Agentic RAG: Claude calls a `search_notes` tool autonomously to iteratively refine retrieval (multi-step retrieval)
- Recall over EventLog entries (currently Phase 2 embeds notes only; events are a separate table)
- Recall result ranking improvements (hybrid BM25 + vector)
- "Show more" context expansion from a citation
- Configurable top-k retrieval count

**Phase 6: Suggest enhancements**
- Haiku 4.5 auto-tagging: when a note is saved, Haiku suggests tags automatically
- Auto-generated session summary after each session (Haiku or Sonnet)
- Suggest history: see past recommendations for a campaign
- Configurable thinking effort (medium/high/max) in Settings

**Phase 7: Data management**
- Campaign export (JSON or Markdown)
- Campaign import
- Entity bulk edit
- World-level entities shared across campaigns
- Image/map attachment to entities

**Phase 8: Advanced capture**
- Audio transcription integration (Whisper or OS transcription)
- PDF / rulebook ingest for lore reference (separate vector namespace)
- Session timeline view (visual chronology of events)

---

## Milestone Summary

| Milestone | Deliverable | Status |
|---|---|---|
| M0 | Working Electron + React shell, DB connected, IPC bridge typed, design system in place, tests running | ✅ Shipped |
| M1 | Full Capture workflow: all entity types, notes, links, quick-add, local search | ✅ Shipped |
| M2 | Full Recall workflow: local embeddings, vector search, Claude-synthesized cited answers, offline degradation | ✅ Shipped |
| M3 | Full Counsel workflow: attitude-based in-character recommendations (structured output), context-grounded | ✅ Shipped *(evolved to 6 multi-tag options, ADR-016/026)* |
| MVP Complete | All three pillars working, testable, and usable at the table | ✅ Shipped — see SPEC §10 for what shipped beyond it |

---

## ADR List

These are written as full Architecture Decision Records in [`docs/adr/`](docs/adr/README.md) — each records the decision, alternatives, and rationale. *(Historical note: the table below lists the ten ADRs planned for the MVP. The ADR set has since grown to 001–018+, and statuses have moved — e.g. ADR-009 is superseded by ADR-016, ADR-003 refined by ADR-012. The authoritative index is [`docs/adr/README.md`](docs/adr/README.md).)*

| ID | Title | When to write |
|---|---|---|
| ADR-001 | Embeddings runtime: Transformers.js vs. Python sidecar | Before Phase 0 |
| ADR-002 | Embedding model choice: all-MiniLM-L6-v2 | Before Phase 2 |
| ADR-003 | Vector store: sqlite-vec co-located in main SQLite DB (confirmed: native .dll packaging accepted) | Before Phase 0 |
| ADR-004 | Local datastore: SQLite + better-sqlite3 + Drizzle ORM | Before Phase 0 |
| ADR-005 | API key storage: Electron safeStorage (DPAPI on Windows) | Before Phase 2 |
| ADR-006 | Electron bundler: electron-vite | Before Phase 0 |
| ADR-007 | Client-side state management: Zustand vs. React Context | During Phase 0 |
| ADR-008 | Streaming IPC protocol design | During Phase 0 |
| ADR-009 | Suggest output model: multi-attitude structured output (4 of 7 attitudes) | Before Phase 3 |
| ADR-010 | Global quick-add hotkey behavior (focus main vs. quick-capture popup) | During Phase 0 |

---

## Open Questions for the Developer

**Resolved by the developer (2026-06-25):**
- **Color palette** → confirmed cool cyan→slate→charcoal palette; dark-first, single vivid-cyan accent; distinctive design (not a generic recolor). Full palette + guardrails in ARCHITECTURE §1.
- **Global quick-add hotkey** → **in scope for the MVP** (scaffolded in P0-07, implemented in P1-07); behavior choice tracked as ADR-010.
- **sqlite-vec packaging** → native `.dll` packaging is **accepted**; the pure-JS fallback is retained only as a contingency.
- **Model download UX** → **explicit first-run onboarding step** with a progress bar (P2-02), not a silent background download.
- **Entity scope** → entities are **always campaign-scoped** for the MVP; world-level entities deferred (Phase 7).
- **Suggest attitude set** → confirmed **7 attitudes**; Suggest selects **4 of 7**.
- **Window layout** → **single-window with panel switching** (sidebar nav swaps a single main view; no persistent AI drawer).

**Still open:**
1. **Chunking strategy:** one chunk per note (assumed) vs. sentence/fixed-size chunks. Revisit if notes get long. *(Still open as of 2026-07-02 — large Import/Backfill pastes get a soft warning only; chunking remains a queued follow-up, ADR-014.)*
2. ~~**Embedding performance:** confirm CPU-only `all-MiniLM-L6-v2` inference is acceptable on the developer's machine.~~ *(Resolved in practice — CPU inference is comfortably fast in live use.)*
