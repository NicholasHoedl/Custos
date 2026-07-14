# Custos — Architecture Document

**Version:** 0.1 (MVP Planning)
**Date:** 2026-06-25 · **Last currency review:** 2026-07-12 (through ADR-045)
**Status:** Implemented — this is the original MVP architecture plan. Several subsystems have since
evolved; **where this document and the ADRs disagree, the ADRs win.** Authoritative deltas: the vector
store is **brute-force JS cosine, not `sqlite-vec`** (ADR-012); Suggest's "in the moment" mode is a
**multi-tag, 4-option narrative** model (title + plain-English explanation, no D&D mechanics — ADR-048,
superseding ADR-026), not 4-of-7 fixed attitudes; **notes are many-to-many** via `note_entity` (SPEC §10);
retrieval is **hybrid** (dense + fuzzy entity-name match, ADR-012); post-MVP features (current
scene, session recap, paste-and-extract import, PC persona) live in ADR-013–016 and SPEC §10; a
**chronology** model (session-stamped history + "as of session N" reconstruction) shipped in
ADR-017, with **event re-scope to world history** (ADR-019) and an **operational-hardening** layer — DB
backups, logging, crash recovery (ADR-020); then **journal-driven capture** (ADR-022) and **capture/UI
refinements** (ADR-023, which retired the backfill interview — its changeset engine folded into Import) —
on top. **A large post-MVP arc then followed (ADR-024–045)** — summarized here so a fresh reader knows the
plan below is far from the whole story: the grim "Ash & Ember" re-theme (024); the Converse question lens
(025/034) and Counsel v2 (026); scene-is-Counsel-only (027); changeset field-changes + dedup (028/031);
main-character single lens · Voice Examples · derive-from-backstory + a dedicated **Character page** (029/030);
per-direction **tie enrichment** (033); **two-tier extraction** with the Chronicle **close-out** ritual and
manual **Illuminate** (035), plus the Chronicle-header consolidation (036); **session integrity** + editable
chronicle entries (037); entity **merge** (038); entity **portraits** (039); the **"Web"** relationship graph
(040); an env-gated **fake-AI e2e seam** (041/043); the **electron-updater** distribution stack + proprietary
license (042); and a **forced first-run tutorial** (setup-only) with an always-available **Quickstart guide**
(044/045). See [`docs/adr/README.md`](docs/adr/README.md) for the authoritative current index (**ADR-001–045**).
The
data model and module sections below are reconciled to match; older narrative sections remain
MVP-era where the ADRs supersede them.

---

## 1. Tech Stack Recommendation

### Why this stack

The stack is chosen to minimize packaging complexity, leverage the developer's existing skills, and keep the dependency surface small while delivering all three pillars. Every choice is "boring and proven" unless a specific requirement forces otherwise.

| Layer | Choice | Rationale |
|---|---|---|
| Shell | Electron (latest stable) | Confirmed decision. Local-first, full OS access for safeStorage and file system. |
| Renderer framework | React 19 + TypeScript | Confirmed (React 19 chosen in Phase 0). Large ecosystem; shadcn/ui is React-native. |
| Styling | Tailwind CSS v4 + shadcn/ui | Confirmed decision. Utility-first, no CSS modules. shadcn primitives for all standard UI components. |
| Renderer bundler | Vite (with electron-vite wrapper) | Best DX for Electron + React + TypeScript in 2025/26. Fast HMR, good Electron integration. |
| Main process language | TypeScript (compiled via electron-vite) | Same language as renderer; no context switching; strong types for IPC contracts. |
| Local database | SQLite via `better-sqlite3` | Battle-tested, zero-install, excellent Node.js bindings, synchronous API simplifies main-process code, single file on disk. |
| ORM / query builder | Drizzle ORM | Lightweight, TypeScript-first, excellent SQLite support, generates typed queries, schema-as-code. Avoids the weight of Prisma or Sequelize. |
| Vector store | Brute-force JS cosine over BLOBs in SQLite (ADR-012; `sqlite-vec` deferred) | Same SQLite file, but **no native extension to package** — the single biggest packaging risk avoided. `sqlite-vec` can replace it behind the same `VectorStore` interface later. |
| Embeddings runtime | Transformers.js (`@xenova/transformers`) | Runs ONNX models in Node.js (main process) — no Python sidecar, no separate process, WASM/ONNX backend works on Windows CPU without CUDA. See ADR-002. |
| Embedding model | `Xenova/all-MiniLM-L6-v2` | 22M params, 384-dim vectors, excellent quality/speed ratio at this scale, runs entirely on CPU, ships as a cacheable ONNX file. See ADR-002. |
| Claude SDK | `@anthropic-ai/sdk` (Node/TypeScript) | Official SDK, streaming support, citation document blocks, prompt caching headers. Called exclusively from main process. |
| API key storage | Electron `safeStorage` | Built-in Electron API; encrypts with OS keychain (DPAPI on Windows). No third-party dependency. See ADR-005. |
| IPC | Electron contextBridge + typed IPC channels | Typed request/response contracts defined in a shared `ipc-types.ts`. |
| Testing | Vitest (unit/integration) + Playwright (E2E) | Vitest is Vite-native and fast; Playwright has first-class Electron support. |
| Dev tooling | ESLint + Prettier + TypeScript strict mode | Standard, no surprises. |

### Fonts (required by aesthetic rules)

Loaded via CSS `@font-face` or a bundled font package:
- **Body:** Bricolage Grotesque
- **Display:** Fraunces
- **Mono:** JetBrains Mono

### Color Palette & Design Language (required by aesthetic rules)

All color tokens live in `src/renderer/src/styles/globals.css` as CSS custom properties. **Tailwind v4 is CSS-first** — the `@tailwindcss/vite` plugin plus an `@theme inline` block consume those variables, so there is **no `tailwind.config.ts`**. Fonts are self-hosted via `@fontsource` (bundled woff2, offline-ready). As built in Phase 0, the renderer app lives under `src/renderer/src/` (electron-vite layout) with cross-process code in `src/shared/`. No inline styles; no CSS modules.

> **Palette superseded (ADR-024).** The original cyan/slate palette shipped in Phase 0; the renderer was
> later re-themed to the grim dark-fantasy **"Ash & Ember"** palette. The **source of truth for color is now
> [`docs/design/theme.md`](docs/design/theme.md)**; the current tokens are summarized below, and the
> historical cyan palette is kept (collapsed) at the end for provenance.

**Current palette — *Ash & Ember* (ADR-024; full reference in `docs/design/theme.md`):**

```
--char           #141210   warm charcoal near-black — background
--char-sidebar   #100D0B   sidebar
--char-raised    #1E1A16   raised surface — card / muted
--char-inset     #26201A   inset
--iron           #34302A   default hairline / border
--bone           #E8E2D6   bone-white — foreground text
--bone-dim       #C7BFB2   body copy
--ash            #8C8377   muted / warm ash grey
--ember          #D2732E   accent — primary, active rules, focus, Recall citations
--ember-deep     #7C3E1D   hover / active fills
--blood          #B23A2E   dried blood — death, enmity, destructive
--pewter         #9E9DA2   cool pewter — inscribed labels, wordmark
```

Named raw tokens → semantic role tokens (`--background` / `--foreground` / `--primary` / …) → Tailwind
utilities, dark-only; every component resolves through the roles, so a palette swap is a single-file token
change with no per-component edits. `--pewter` / `--blood` are exposed as `text-metal` / `text-blood` /
`decoration-blood`. **Because ember (accent) and blood (death) share a warm hue, death cues rely on
strike + skull + ghosting, not color** — see the death motif in `theme.md`.

**Design-language guardrails (the governing rule — unchanged across re-themes):** Past attempts to make a UI
"feel like a ledger" produced *generic shadcn components recolored beige*. Do **not** do that. The identity
is a committed **grim, warm-charcoal canvas with a single dying-ember accent** — not parchment, not
skeuomorphic paper, not beige. The "ledger" character comes from **typography, structure, and the death
motif** (Fraunces display at large sizes with weight extremes; Bricolage Grotesque body; JetBrains Mono for
IDs/timestamps; the `.inscribed` small-caps pewter labels; layered charcoal surfaces for depth; the
lifecycle/confidence model rendered as strike/skull/ghost), not from coloring standard components. Make
distinctive, intentional choices.

<details>
<summary>Original Phase-0 palette (superseded by ADR-024 — kept for provenance)</summary>

```js
{
  light_cyan: { DEFAULT: '#e0fbfc', 100: '#095456', 200: '#11a7ad', 300: '#32e5eb', 400: '#88f0f3', 500: '#e0fbfc', 600: '#e5fcfc', 700: '#ecfcfd', 800: '#f2fdfe', 900: '#f9fefe' },
  light_blue: { DEFAULT: '#c2dfe3', 100: '#1b363a', 200: '#356d74', 300: '#50a3ae', 400: '#8ac2c9', 500: '#c2dfe3', 600: '#cfe6e9', 700: '#dbecef', 800: '#e7f3f4', 900: '#f3f9fa' },
  cool_steel: { DEFAULT: '#9db4c0', 100: '#1b252a', 200: '#364a55', 300: '#516f7f', 400: '#7192a4', 500: '#9db4c0', 600: '#afc2cc', 700: '#c3d1d9', 800: '#d7e1e6', 900: '#ebf0f2' },
  blue_slate: { DEFAULT: '#5c6b73', 100: '#131617', 200: '#252b2e', 300: '#384146', 400: '#4a565d', 500: '#5c6b73', 600: '#798b94', 700: '#9ba8af', 800: '#bcc5c9', 900: '#dee2e4' },
  jet_black:  { DEFAULT: '#253237', 100: '#070a0b', 200: '#0f1416', 300: '#161e21', 400: '#1d282c', 500: '#253237', 600: '#465f69', 700: '#688c9b', 800: '#9bb3bc', 900: '#cdd9de' }
}
```
The original dark cyan/slate role mapping (jet_black canvas, vivid cyan `#32e5eb` accent) is preserved here
and in ROADMAP P0-02.
</details>

---

## 2. Why NOT a Python Sidecar (ADR-001 Preview)

A Python sidecar for embeddings (sentence-transformers) would play to the developer's Python strength but introduces:

- A second language runtime to bundle and manage in Electron
- Process lifecycle management (spawn, health-check, graceful shutdown, crash recovery)
- Significantly more complex packaging (PyInstaller or similar)
- A bloated distributable (Python + sentence-transformers + numpy is several hundred MB)
- IPC over stdio or a local HTTP socket — more failure surface

Transformers.js with ONNX runs the same model family in the Node.js main process with no additional runtime, a ~30 MB one-time model download, and trivial packaging. Quality for `all-MiniLM-L6-v2` is identical to the Python equivalent because they share the same ONNX model weights. The Python sidecar is listed as ADR-001 and deferred to a future phase only if CPU inference speed proves unacceptable.

---

## 3. High-Level Component Breakdown

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron Shell                           │
│                                                                 │
│  ┌──────────────────────────┐   ┌──────────────────────────┐   │
│  │      Main Process        │   │     Renderer Process      │   │
│  │  (Node.js / TypeScript)  │   │  (Chromium / React / TS)  │   │
│  │                          │   │                           │   │
│  │  ┌────────────────────┐  │   │  ┌─────────────────────┐ │   │
│  │  │   IPC Handler      │◄─┼───┼─►│   IPC Bridge        │ │   │
│  │  │  (ipcMain)         │  │   │  │  (contextBridge)    │ │   │
│  │  └────────┬───────────┘  │   │  └──────────┬──────────┘ │   │
│  │           │              │   │             │             │   │
│  │  ┌────────▼───────────┐  │   │  ┌──────────▼──────────┐ │   │
│  │  │   Service Layer     │  │   │  │   React App         │ │   │
│  │  │                     │  │   │  │                     │ │   │
│  │  │  NoteService        │  │   │  │  CaptureView        │ │   │
│  │  │  EntityService      │  │   │  │  RecallView         │ │   │
│  │  │  SessionService     │  │   │  │  SuggestView        │ │   │
│  │  │  EmbeddingService   │  │   │  │  SettingsView       │ │   │
│  │  │  RecallService      │  │   │  │  EntityViews        │ │   │
│  │  │  SuggestService     │  │   │  │                     │ │   │
│  │  │  KeyService         │  │   │  └─────────────────────┘ │   │
│  │  └────────┬────────────┘  │   └──────────────────────────┘   │
│  │           │               │                                   │
│  │  ┌────────▼───────────┐   │                                   │
│  │  │   Data Layer       │   │                                   │
│  │  │                    │   │                                   │
│  │  │  SQLite DB         │   │                                   │
│  │  │  (better-sqlite3   │   │                                   │
│  │  │   + JS vectors     │   │                                   │
│  │  │   + Drizzle ORM)   │   │                                   │
│  │  └────────────────────┘   │                                   │
│  │                           │                                   │
│  │  ┌────────────────────┐   │                                   │
│  │  │   AI Layer         │   │                                   │
│  │  │                    │   │                                   │
│  │  │  @anthropic-ai/sdk │   │                                   │
│  │  │  Transformers.js   │   │                                   │
│  │  │  (ONNX embeddings) │   │                                   │
│  │  └────────────────────┘   │                                   │
│  └──────────────────────────┘                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Window Layout (single-window)

Custos is a **single-window** app with **panel switching** (confirmed by the developer over a multi-panel layout). The window is a persistent left **Sidebar** (campaign selector + nav: Journal / Capture / Recall / Suggest / Converse / Settings / entity browser) plus a single **MainPanel** that renders exactly one feature view at a time; clicking a sidebar item swaps the active view. There is **no persistent secondary "AI drawer"** — Recall, Suggest, and Converse are their own full panels, not always-on side rails. View switching is client-side (a lightweight router / tab switcher in the renderer; the active view lives in renderer state — see ADR-007). The global quick-add hotkey (below) is the one path that surfaces capture without first switching panels.

### Security Boundary

The renderer process is an untrusted environment (it runs Chromium, which could be exposed to malicious content if external URLs are ever loaded). Therefore:

- The API key **never** crosses the contextBridge into the renderer — not in arguments, return values, or error messages
- The `@anthropic-ai/sdk` client is instantiated **only** in the main process
- `nodeIntegration: false` and `contextIsolation: true` are enforced in the BrowserWindow config (Electron defaults for new apps)
- All external network calls originate from the main process
- The renderer communicates only via typed IPC channels exposed through contextBridge

### Global Quick-Add Hotkey (accounted for from Phase 0)

The developer wants a **system-level global quick-add hotkey** that works even when Custos is not focused, so the window/main-process architecture accommodates it from the start rather than bolting it on later:

- `app.requestSingleInstanceLock()` in `src/main/index.ts` — a single instance owns the global shortcut; a second launch focuses the existing window.
- `globalShortcut.register()` (configurable; default e.g. `Ctrl+Alt+L`) registered on `app.whenReady()`, released on `will-quit`.
- On trigger, surface a fast capture path. Two viable designs (decide in Phase 0 — see ADR-010): (a) show/focus the main window with the quick-add bar focused, or (b) spawn a small, frameless, always-on-top **quick-capture popup** window that writes to the active campaign/session and dismisses. The popup keeps the user in their game without raising the full app.
- The in-app `Ctrl+K` quick-add (Phase 1) remains the focused-window shortcut; the global hotkey is the not-focused entry point.

---

## 4. Data Model

All entities are campaign-scoped (confirmed by the developer — world-level / shared entities are deferred to a later phase). The schema is managed by Drizzle ORM migrations.

### Entity Types

```
Campaign
  id           UUID PK
  name         TEXT NOT NULL
  description  TEXT
  mainCharacterId  TEXT FK → Entity.id (nullable, ON DELETE SET NULL) — the campaign's mandatory main character, created atomically with the campaign; the sole in-character lens (ADR-029/030; column main_character_id)
  createdAt    INTEGER (unix ms)
  updatedAt    INTEGER (unix ms)

Session
  id           UUID PK
  campaignId   UUID FK → Campaign.id
  number       INTEGER NOT NULL
  title        TEXT
  summary      TEXT
  date         TEXT (ISO date, "2026-06-25")
  createdAt    INTEGER (unix ms)

EntityType ENUM: 'npc' | 'location' | 'faction' | 'quest' | 'item' | 'pc' | 'event' | 'creature'
  (free-text TEXT — no CHECK; a new type needs no migration. 'creature' = a monster/beast/hazard, ADR-021)

Entity
  id           UUID PK
  campaignId   UUID FK → Campaign.id
  type         EntityType NOT NULL
  name         TEXT NOT NULL
  description  TEXT
  image        TEXT (nullable — optional portrait: a base64 JPEG data-URL thumbnail; NOT embedded; migration 0011, ADR-039)
  traits       TEXT (JSON array of strings — used heavily for PC in Suggest)
  goals        TEXT (JSON array of strings — for NPC / PC)
  flaws        TEXT (JSON array of strings — a vice/fear/weakness for PC/NPC/faction; feeds persona + Counsel, ADR-026)
  voice_examples TEXT (JSON array of strings — MAIN-CHARACTER-ONLY sample lines; grounds Counsel/Converse voice, ADR-029)
  attributes   TEXT (JSON object — the open bag of type-specific fields; edited add/cut/alter via changeset, ADR-028)
  status       TEXT ('active' | 'inactive' | 'dead' | 'resolved' | ...) — free-text
  lifecycle    TEXT ('active' | 'ended' | 'presumed_ended' | 'unknown') NOT NULL — coarse in-play flag (ADR-017, ADR-021)
  createdAt    INTEGER (unix ms)
  updatedAt    INTEGER (unix ms)

Note
  id           UUID PK
  campaignId   UUID FK → Campaign.id (NOT NULL — the note's home; a note is a first-class campaign child, ADR-021)
  sessionId    UUID FK → Session.id (nullable — "when"; the session the note belongs to)
  content      TEXT NOT NULL
  tags         TEXT (JSON array of strings)
  confidence   TEXT ('confirmed' | 'rumored' | 'suspected') NOT NULL default 'confirmed' — epistemic weight the AI hedges on (ADR-021)
  createdAt    INTEGER (unix ms)

NoteEntity   (note ↔ entity, MANY-TO-MANY — a note may tag ZERO, one, OR several entities; an untagged note is campaign lore, ADR-021)
  noteId       UUID FK → Note.id     ┐ composite PK
  entityId     UUID FK → Entity.id   ┘
  createdAt    INTEGER (unix ms)

EntityLink
  id           UUID PK
  fromEntityId UUID FK → Entity.id
  toEntityId   UUID FK → Entity.id
  relation     TEXT ('member_of' | 'located_in' | 'involved_in' | 'owns' | 'ally_of' | 'related_to' | ...)
  description  TEXT (nullable — the "why/when" of the edge; the RAG-context lever the model reads verbatim)
  fromDisposition TEXT (nullable — how `from` FEELS about `to`, a short free-text phrase) — ADR-033
  toDisposition   TEXT (nullable — how `to` feels about `from`; per-direction so asymmetry lives on one edge) — ADR-033
  confidence   TEXT ('confirmed' | 'rumored' | 'suspected') NOT NULL default 'confirmed' — the AI hedges on it (ADR-033)
  campaignId   UUID FK → Campaign.id
  startSessionNumber INTEGER (nullable — session # the link formed; NULL = pre-tracking; column start_session_number) — ADR-017
  endSessionNumber   INTEGER (nullable — NULL = live; set on "sever" to close the validity interval; column end_session_number) — ADR-017

  # A tie serves four jobs (ADR-033): AI grounding (formatRelationships → the prompt — the ONLY path the
  # edge graph reaches the model), hierarchy traversal (located_in/member_of CTEs), the in-character sense
  # of who-knows-whom (disposition + relation), and UI browsing. `relation` is the typed skeleton;
  # `description`/`fromDisposition`/`toDisposition` are the free-text specifics.

EventLog
  id           UUID PK
  sessionId    UUID FK → Session.id
  campaignId   UUID FK → Campaign.id
  content      TEXT NOT NULL
  entityId     UUID FK → Entity.id (nullable — optional tag)
  timestamp    INTEGER (unix ms)

StatusHistory   (append-only status/lifecycle trail — ADR-017; drives "as of session N")
  id                  UUID PK
  entityId            UUID FK → Entity.id
  lifecycle           TEXT ('active' | 'ended' | 'presumed_ended' | 'unknown')
  status              TEXT (nullable)
  sinceSessionNumber  INTEGER (nullable — NULL = pre-tracking baseline)
  recordedAt          INTEGER (unix ms)

PcPersona   (cached, user-editable in-character brief for a PC — ADR-030; the Recall/Counsel/Converse voice)
  entityId    UUID FK → Entity.id (PK); table pc_persona
  brief       TEXT
  edited      INTEGER (0/1 — the user hand-edited the brief)
  stale       INTEGER (0/1 — the PC's source fields changed since generation)
  sourceHash  TEXT (hash of the PC's fields; flips `stale` when it changes)
  model       TEXT
  createdAt / updatedAt  INTEGER (unix ms)
```

> Chronology note (ADR-017): session **numbers** are denormalized into `EntityLink.start/endSessionNumber`
> and `StatusHistory.sinceSessionNumber` so as-of reconstruction is a join-free integer comparison.
> A partial unique index keeps at most one *open* link per (from, to, relation).

### Vector Index (brute-force cosine — ADR-012)

Embeddings live as BLOBs in the same SQLite file. v1 searches them with **brute-force JS cosine**
(`sqlite-vec` was deferred — ADR-012). One row per note and per **entity** (name + description):

```
NoteEmbedding
  noteId       UUID FK → Note.id (PK)
  embedding    BLOB (float32 array, 384 dims for all-MiniLM-L6-v2)

EntityEmbedding
  entityId     UUID FK → Entity.id (PK)
  embedding    BLOB (float32 array, 384 dims)
```

At MVP data volume (hundreds to low thousands of vectors) a full cosine scan is sub-millisecond, so no
ANN index is needed; a `SqliteVecStore` can drop in behind the same `VectorStore` interface later
without a schema change (ADR-012). (The live schema also carries `model` / `dim` / `contentHash` /
`updatedAt` per embedding row; omitted here for brevity.)

### Key Relationships

```
Campaign ──< Session
Campaign ──< Entity
Note     >──< Entity   (many-to-many, via NoteEntity)
Entity   ──< EntityLink (from/to)
Session  ──< Note
Session  ──< EventLog
Note     ──1 NoteEmbedding
Entity   ──1 EntityEmbedding
```

---

## 5. RAG Pipeline

### Ingest Path (write time)

```
User creates/updates a Note or EventLog
        │
        ▼
NoteService.save(note) → writes to SQLite
        │
        ▼
EmbeddingService.embed(text: string) → Promise<Float32Array>
  └─ Transformers.js pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  └─ Returns 384-dim normalized embedding
        │
        ▼
VectorStore.upsert(noteId, embedding) → writes the embedding BLOB to the NoteEmbedding table
```

Embedding happens synchronously in the main process on note save. At MVP data volume this is fast enough to not require a queue. If it becomes noticeable, background it with a simple async queue.

### Retrieval Path (Recall query)

```
User submits query string
        │
        ▼
Renderer sends IPC: 'recall:query' { query, campaignId, topK: 8 }
        │
        ▼
Main process: RecallService.query(params)
        │
        ├─ EmbeddingService.embed(query) → queryEmbedding (local, no network)
        │
        ├─ VectorStore.search(queryEmbedding, campaignId, topK)
        │    └─ brute-force cosine similarity, filtered by campaignId (ADR-012); hybrid dense + fuzzy name match
        │    └─ Returns: [{ noteId, score, content, entityName, sessionNumber }]
        │
        ├─ [offline check] if no network → return retrieved chunks only
        │
        ├─ ClaudeService.recall(query, retrievedChunks) → AsyncIterable<string>
        │    └─ Builds request:
        │         system: "You are a D&D campaign assistant. Answer questions about the campaign..."
        │         messages: [{
        │           role: 'user',
        │           content: [
        │             ...retrievedChunks.map(c => ({
        │               type: 'document',
        │               source: { type: 'text', data: c.content },
        │               title: `${c.entityName} — Session ${c.sessionNumber}`,
        │               citations: { enabled: true }
        │             })),
        │             { type: 'text', text: query }
        │           ]
        │         }]
        │         model: 'claude-sonnet-4-6' (or opus-4-8 if configured)
        │         stream: true
        │
        └─ Streams tokens back to renderer via IPC streaming channel
```

### Prompt Caching Strategy (Recall + Suggest)

Claude's prompt caching requires a stable prefix of at least 2048 tokens (Sonnet 4.6) or 4096 tokens (Opus 4.8). For both Recall and Suggest:

- **Stable prefix (cached):** system prompt + campaign description + active PC's traits/goals block. Mark with `cache_control: { type: "ephemeral" }`. This prefix changes rarely within a session.
- **Volatile suffix (not cached):** retrieved note chunks + the user's actual query or situation description.

This means repeated Recall queries within a session pay only for the volatile suffix tokens. The campaign context and PC traits are free after the first call.

Anthropic's `ephemeral` cache defaults to a **5-minute** TTL; pass `cache_control: { type: "ephemeral", ttl: "1h" }` to extend it to 1 hour, which aligns well with a typical play session (and is re-warmed by each call within the window).

---

## 6. Claude Integration

### Model Mapping

| Feature | Default Model | Notes |
|---|---|---|
| Recall synthesis | `claude-sonnet-4-6` | Lower latency/cost; configurable to Opus |
| Suggest | `claude-opus-4-8` | Marquee reasoning feature; adaptive thinking + structured output (multi-tag 4-option narrative "in the moment" — ADR-048 — + open-ended "directions" — ADR-016) |
| Converse | `claude-opus-4-8` | Third AI lens; **reuses the Suggest model + effort setting** (per-query Quick/Deep — ADR-049); single-shot structured per turn with a **follow-up loop** (ADR-049), direct-fetch grounding (ADR-025) |
| Auto-tagging (future) | `claude-haiku-4-5` | Background task, latency-insensitive |

### ClaudeService Interface (main process only)

```typescript
// Conceptual interface — not implementation code
interface ClaudeService {
  recall(params: RecallParams): AsyncIterable<RecallChunk>   // streamed
  suggest(params: SuggestParams): Promise<SuggestResult>     // single structured response
  converse(params: ConverseParams): Promise<ConverseResult>  // single structured response (ADR-025)
  isAvailable(): Promise<boolean>  // network + key check
}

interface RecallParams {
  query: string
  retrievedChunks: RetrievedChunk[]
  campaignContext: CampaignContext
  model: 'claude-sonnet-4-6' | 'claude-opus-4-8'
}

interface SuggestParams {
  situation: string
  pc: PCContext
  retrievedHistory: RetrievedChunk[]
  campaignContext: CampaignContext
  count: number            // attitude-actions to return (default 4)
}

// The 7-attitude taxonomy the model chooses from (developer-defined).
type Attitude =
  | 'neutral'        // Neutral / Default — impartial, unemotional baseline
  | 'friendly'       // Friendly / Supportive — cooperation, trust, alliance
  | 'hostile'        // Hostile / Aggressive — opposition, distrust, conflict
  | 'moral'          // Moral / Ethical — strong sense of right and wrong
  | 'selfish'        // Selfish / Opportunistic — personal gain over others
  | 'compassionate'  // Compassionate / Altruistic — help others at personal cost
  | 'cynical'        // Cynical / Skeptical — distrust of others' intentions

interface AttitudeRecommendation {
  attitude: Attitude
  action: string        // a unique in-character action in the PC's voice
  rationale?: string    // short reason this attitude fits the PC here
}

interface SuggestResult {
  recommendations: AttitudeRecommendation[]  // exactly `count` (default 4), distinct attitudes
}
```

**Recall** uses the streaming API (`client.messages.stream()`), piping tokens to the renderer via a dedicated IPC streaming channel (`event.sender.send` from the main process). **Suggest is different** — it is a single, non-streamed structured-output call (`client.messages.parse()` / `output_config.format`) returning the full `SuggestResult` at once (see below).

### Suggest Output Model (multi-attitude)

> **⚠️ Superseded by ADR-016 (`docs/adr/016-suggest-multitag-overhaul.md`).** The 4-of-7 fixed-attitude
> model in this section — and the `Attitude` / `AttitudeRecommendation` / `count: 4` types above — was
> the MVP design. Current Suggest returns **4 narrative options** (title + plain-English explanation, no
> mechanics — ADR-048) tagged from a **62-tag** vocabulary (1 primary + ≤2 secondary tags, distinct
> primaries), plus an open-ended **"directions"** mode. The structured-output
> + code-side-validation *mechanism* described below still holds; the output *shape* does not.

Suggest does **not** return one recommendation. Given the situation, the active PC's traits/goals, and retrieved campaign history, Opus 4.8 (with adaptive thinking) must:

1. Determine which **4** of the attitudes (from the `Attitude` taxonomy above) the PC is **most likely** to adopt in this specific situation, and
2. Write a **unique in-character action for each** of those 4 attitudes (optionally with a one-line rationale).

Implementation notes:
- Use **structured outputs** (`output_config: { format: { type: 'json_schema', schema } }`) with `attitude` constrained to an `enum` of the taxonomy — guarantees valid, parseable output and clean rendering as one card per attitude.
- JSON-schema structured outputs **cannot** enforce array length or item uniqueness (`minItems` / `maxItems` / `uniqueItems` are unsupported). Enforce "exactly `count` (4), distinct attitudes" in the **prompt** and **validate in code** — re-prompt or trim/backfill if the model returns the wrong count or a duplicate attitude.
- Structured outputs are **incompatible with citations** — fine here; Suggest does not cite sources (citations belong to Recall).
- Adaptive thinking stays on (see *Adaptive Thinking (Suggest)* below); structured outputs work alongside it.
- The output is small and rendered as discrete cards, so Suggest is a single non-streaming `messages.parse()` call; a "Thinking…" indicator covers the latency.

### Adaptive Thinking (Suggest)

For Suggest with Opus 4.8, use adaptive thinking: `thinking: { type: "adaptive" }` together with `output_config: { effort: "high" }`. Opus 4.8 does **not** accept `thinking: { type: "enabled", budget_tokens: N }` — that returns a 400; a fixed thinking budget is replaced by adaptive thinking plus the `effort` parameter (`low` | `medium` | `high` | `max`). This improves reasoning quality for the "what would my character do?" question. Drop `effort` to `medium` if latency is too high at the table.

### Converse Output Model (ADR-025 → ADR-034 → ADR-049 follow-up loop + speed)

**Converse** helps a player prepare to *talk* to a character: given the active PC (the asker) and a chosen
**target** entity, it returns **questions only** — a spread of tagged, in-character `questions` the asker
could pose to draw the target out, each `{ question, tag, read }` over a 14-tag taxonomy. **ADR-034 dropped
the earlier `known`/`openSuspected`/`connections` briefing** — the questions are the whole product now. It
**mirrors Suggest's mechanism** — a single, non-streaming structured-output call (`structuredArrayCall` → a
validated array; no citations) reusing the same `suggestModel` / `suggestEffort` settings — so there is
**no new model and no settings change**.

Where it *differs* from Suggest: grounding is **direct fetch, not retrieval** (no embedding model). The
target's notes come from `getEntityContext(target, 1, asOf)` — now **as-of-clamped** (ADR-034 closed the
as-of leak); its connections and the asker↔target tie come from `listForEntity(…, asOf)`, as-of-correct via
`isIntervalLiveAt` (ADR-017). Status resolves through `resolveEntityState(target, asOf)`, and the asker's
voice through the PC persona. Since JSON Schema can't bound array length, the service **validates/coerces**
the result (distinct tags, floor 4 / cap 6, retry-once) and fails only when *everything* is empty. Full
rationale in **ADR-034** (which revises ADR-025's output).

---

## 7. IPC Architecture

All communication between renderer and main process goes through typed IPC channels defined in a shared `src/shared/ipc-types.ts`. The renderer calls `window.ledger.*` (the contextBridge API); the main process handles via `ipcMain.handle()`.

### Channel Inventory (MVP)

> **Illustrative MVP subset — the shipped surface is much larger.** `src/shared/ipc-types.ts` (the `IPC`
> map) is authoritative. Channels added since this snapshot include `update:check`/`update:install` +
> the `update:status` push (auto-update, ADR-042), `graph:campaign` (Web graph, ADR-040), `entity:pick-image`
> (portraits, ADR-039), `entity:merge` (ADR-038), `campaign:import`/`export`, `usage:summary`, the `app:*`
> shell channels (info/backup/folders), `event:update`/`delete`, `enrich:*`, `persona:*`, `recap:*`, and the
> per-lens `*:cancel` channels.

```typescript
// src/shared/ipc-types.ts (conceptual)

// Data channels (request/response)
'campaign:list'      → Campaign[]
'campaign:create'    → Campaign
'campaign:get'       → Campaign
'session:list'       → Session[]
'session:create'     → Session
'entity:list'        → Entity[]
'entity:create'      → Entity
'entity:update'      → Entity
'entity:get'         → Entity
'note:list'          → Note[]
'note:create'        → Note
'note:update'        → Note
'event:create'       → EventLog
'search:text'        → EntitySearchResult[]  // local text search

// AI channels
'recall:query'       → streamed tokens + final citations (streaming)
'suggest:query'      → SuggestResult (single structured response; multi-tag 4-option narrative + directions — ADR-048/016)
'converse:query'     → ConverseResult (single structured response: briefing + in-character questions — ADR-025)

// Settings channels
'settings:get'       → AppSettings
'settings:set'       → void
'apikey:set'         → void
'apikey:validate'    → { valid: boolean }

// Streaming protocol
// Main → Renderer: 'stream:chunk' { channelId, token }
// Main → Renderer: 'stream:done'  { channelId, citations? }
// Main → Renderer: 'stream:error' { channelId, message }
```

---

## 8. Folder / Module Structure

> **This is the original planned MVP layout; the shipped tree differs substantially. Treat the specific
> filenames in the tree below as illustrative — several no longer exist (the renderer moved to a view-based
> layout; e.g. `RecallPanel.tsx`/`SuggestPanel.tsx`/`QuickAddBar.tsx` are gone). Read `src/` directly and
> CLAUDE.md's "Layout (three process zones)" as the source of truth.**
> Notably: the renderer groups feature panes under `components/views/` — the **nine nav views** are
> `CharacterView`, `JournalView` [Chronicle], `SessionsView`, `CaptureView` [Codex — Inscribe + Annals panes],
> `WebView` [the relationship graph, ADR-040], `RecallView` [Lore], `SuggestView` [Counsel], `ConverseView`,
> and `SettingsView`. (`NotesView` is the **Annals** pane rendered inside Codex, not a top-level view;
> **Transcribe is no longer a view** — ADR-036 moved it into `components/capture/TranscribeDialog.tsx`,
> opened from the Chronicle header, which also hosts the relocated active-session switcher
> `components/sessions/SessionControl.tsx`), with a shared
> `components/chrome.tsx` and a top-level `components/ErrorBoundary.tsx`, plus `components/capture/`,
> `components/entities/`, and `components/layout/`. Main-process `services/` grew to include
> `chronology`, `scene`, `recap`, `persona`, `link` (also holds `buildCampaignGraph` for the Web view —
> there is no `graph.service`, only `ipc/graph.ts`), `embedding-index`, `session`, `merge` (ADR-038),
> `usage` (P0-4), `import-campaign` + `export` (P0-2), `updater` (ADR-042), `ai-fake` (the e2e seam,
> ADR-041/043), and `enrich` (the per-entity **Illuminate** tier-2 pass, ADR-035 — `ipc/enrich.ts`, channels
> `enrich:touched`/`enrich:entity`, reviewed via `components/sessions/EnrichDialog.tsx`)
> services; `db/` adds `backup.ts`. The **Journal** (the reworked
> `components/capture/EventFeed.tsx`, surfaced top-level as `JournalView`) is the primary capture
> surface — entries save as PLAIN log lines; the header's **"Close out session"** wizard
> (`capture/CloseOutDialog.tsx`, ADR-035) runs the extract→review→apply engine over the whole session's
> log through a shared `ChangesetReview` (tier-1 'capture': entities, notes, and status changes; ties +
> field edits come from the chained Illuminate step, ADR-028/035),
> stamped at the current session — and each campaign persists a **mandatory main character**
> (`campaign.main_character_id`, created with the campaign) — the **sole** in-character lens (ADR-029; the
> active-PC switcher is gone). Backstory, the PC persona, and a promoted `voice_examples` field are
> main-character-only, and a **Draft-from-backstory** wizard (`services/derive-profile.service.ts`,
> `hooks/use-derive-profile.ts`, `components/entities/DeriveReview.tsx`) proposes the profile FIELDS for
> approval — the persona is then rebuilt by the ONE canonical generator (`persona.service`) — and, in a
> second step, world entities/notes/ties extracted from the backstory via the changeset engine, applied
> UNDATED (an explicit `sessionId: null` = a pre-tracking baseline/interval). The main character is
> managed on a dedicated **Character page** (`views/CharacterView.tsx`, first in the nav; a bespoke
> `components/entities/CharacterDashboard.tsx` dashboard with popup list editing via `ListEditDialog.tsx`;
> the sidebar shows a read-only "Playing as X" and Codex redirects the MC there), ADR-030.
> The third AI lens **Converse** (ADR-025) adds `services/converse.service.ts`, `ipc/converse.ts`,
> `views/ConverseView.tsx`, `hooks/use-converse.ts`, and `shared/converse-types.ts`. Packaging assets live in `build/`
> (`icon.svg` → `icon.png`, ADR-024) with CI in `.github/workflows/`.

```
ledger/
├── .claude/                        # (do not touch)
├── .git/                           # (do not touch)
├── .gitattributes
├── SPEC.md
├── ARCHITECTURE.md
├── ROADMAP.md
│
├── package.json
├── tsconfig.json                   # references node + web
├── tsconfig.node.json              # main + preload + shared
├── tsconfig.web.json               # renderer
├── electron.vite.config.ts         # electron-vite build config
├── electron-builder.yml            # packaging (asarUnpack better-sqlite3; extraResources drizzle)
├── drizzle.config.ts               # Drizzle Kit config
├── components.json                 # shadcn/ui config — Tailwind v4 is CSS-first (no tailwind.config.ts)
│
├── src/
│   ├── shared/                     # code shared between main and renderer
│   │   ├── ipc-types.ts            # typed IPC channel contracts
│   │   ├── entity-types.ts         # EntityType enum, shared interfaces
│   │   └── constants.ts            # app-wide constants (model IDs, etc.)
│   │
│   ├── main/                       # Electron main process
│   │   ├── index.ts                # entry point, BrowserWindow setup
│   │   ├── ipc/
│   │   │   ├── handlers.ts         # registers all ipcMain.handle() calls
│   │   │   ├── campaign.ts         # campaign IPC handlers
│   │   │   ├── session.ts
│   │   │   ├── entity.ts
│   │   │   ├── note.ts
│   │   │   ├── recall.ts           # recall streaming handler
│   │   │   ├── suggest.ts          # suggest streaming handler
│   │   │   └── settings.ts
│   │   ├── services/
│   │   │   ├── campaign.service.ts
│   │   │   ├── session.service.ts
│   │   │   ├── entity.service.ts
│   │   │   ├── note.service.ts
│   │   │   ├── embedding.service.ts   # Transformers.js wrapper
│   │   │   ├── vector-store.service.ts # brute-force JS cosine (ADR-012)
│   │   │   ├── recall.service.ts      # retrieval orchestration
│   │   │   ├── suggest.service.ts     # suggest orchestration
│   │   │   ├── claude.service.ts      # @anthropic-ai/sdk wrapper
│   │   │   └── key.service.ts         # safeStorage wrapper
│   │   └── db/
│   │       ├── index.ts               # DB connection singleton
│   │       ├── schema.ts              # Drizzle schema definitions
│   │       └── migrations/            # (as-built: migrations live in `drizzle/` at the repo ROOT, not here)
│   │
│   ├── preload/
│   │   └── index.ts                   # contextBridge exposes window.ledger
│   │
│   └── renderer/                      # React app
│       ├── index.html
│       ├── main.tsx                   # React entry
│       ├── styles/
│       │   └── globals.css            # CSS variables (colors, fonts, base)
│       ├── lib/
│       │   ├── ipc.ts                 # typed wrapper around window.ledger
│       │   └── utils.ts               # shadcn/ui cn() helper + misc
│       ├── components/
│       │   ├── ui/                    # shadcn/ui generated components
│       │   ├── layout/
│       │   │   ├── AppShell.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   └── MainPanel.tsx
│       │   ├── capture/
│       │   │   ├── QuickAddBar.tsx
│       │   │   ├── SessionHeader.tsx
│       │   │   ├── EventFeed.tsx
│       │   │   └── EntityForm.tsx
│       │   ├── recall/
│       │   │   ├── RecallPanel.tsx
│       │   │   ├── RecallQuery.tsx
│       │   │   ├── RecallAnswer.tsx
│       │   │   └── CitationLink.tsx
│       │   ├── suggest/
│       │   │   ├── SuggestPanel.tsx
│       │   │   ├── SuggestInput.tsx
│       │   │   └── SuggestOutput.tsx
│       │   ├── entities/
│       │   │   ├── EntityList.tsx
│       │   │   ├── EntityCard.tsx
│       │   │   ├── EntityDetail.tsx
│       │   │   └── EntityBadge.tsx
│       │   └── settings/
│       │       ├── SettingsPanel.tsx
│       │       └── ApiKeyInput.tsx
│       ├── hooks/
│       │   ├── useStream.ts           # handles streaming IPC channel
│       │   ├── useCampaign.ts
│       │   ├── useSession.ts
│       │   └── useEntities.ts
│       └── store/                     # client-side state (Zustand or React context)
│           ├── app-store.ts           # active campaign, active session, active PC
│           └── ui-store.ts            # panel state, loading states
│
├── tests/
│   ├── unit/
│   │   ├── services/                  # tests for main-process services
│   │   │   ├── embedding.service.test.ts
│   │   │   ├── recall.service.test.ts
│   │   │   └── note.service.test.ts
│   │   └── shared/
│   │       └── entity-types.test.ts
│   ├── integration/
│   │   ├── db.test.ts                 # schema + migrations
│   │   └── rag-pipeline.test.ts       # embed → store → retrieve round-trip
│   └── e2e/
│       ├── capture.spec.ts            # Playwright: create session, quick-add
│       ├── recall.spec.ts             # Playwright: query with mock Claude
│       └── suggest.spec.ts            # Playwright: suggest with mock Claude
│
└── resources/
    ├── icon.png
    └── models/                        # ONNX model cache (gitignored)
        └── .gitkeep
```

---

## 9. Offline Strategy

| Feature | Offline behavior |
|---|---|
| Capture (all CRUD) | Fully available. SQLite is local. |
| Local text search | Fully available. |
| Recall: retrieval | Available. Embedding and vector search are local. |
| Recall: synthesis | Unavailable. Show retrieved note chunks in a "raw results" view with a clear "Claude unavailable — showing retrieved notes" message. |
| Suggest | Unavailable. Show a clear message: "Suggest requires an internet connection." |
| Settings | Fully available. |

Network check: the main process pings `api.anthropic.com` before each Claude call (or catches the connection error) and returns a typed `{ available: false, reason: 'offline' }` error to the renderer rather than throwing.

---

## 10. Security Considerations

1. **API key storage:** `electron.safeStorage.encryptString()` / `decryptString()` on Windows uses DPAPI (user-account-scoped). The encrypted bytes are persisted in `electron-store` or directly in `app.getPath('userData')`. The plaintext key is decrypted in main process memory only when a Claude call is made, and is never sent to the renderer.

2. **No external URL loading:** `BrowserWindow` is configured with `webSecurity: true` (default). Navigation to external URLs is intercepted and opened in the system browser, not within the Electron window.

3. **Content Security Policy:** A strict CSP is set in the renderer's HTML meta tag and via `session.webRequest.onHeadersReceived`. `script-src 'self'` (no `unsafe-inline`, no `unsafe-eval` except what Vite needs in dev).

4. **Preload isolation:** `nodeIntegration: false`, `contextIsolation: true`. The preload script exposes only the `window.ledger` interface; it does not expose `require` or any Node APIs.

5. **No renderer-to-internet calls:** The renderer makes no direct HTTP calls. All network traffic routes through the main process. The renderer cannot be used to exfiltrate the API key even if XSS were somehow introduced.

6. **Model files:** ONNX model files are downloaded from Hugging Face during an **explicit first-run onboarding step** (developer decision — not a silent background fetch; see ROADMAP Phase 2) and cached in `app.getPath('userData')/models/`. Model integrity should be verified against a known checksum (future improvement).

### Data safety & operability (ADR-020)

Beyond the security posture above, the operational path is hardened: rotating pre-migration DB
backups (`VACUUM INTO`, keep 5, in `userData/backups`); a persistent main-process log (`electron-log`
→ `userData/logs/main.log`) with logged WAL-checkpoint failures and captured uncaught exceptions; a
startup migration-failure recovery dialog; a React error boundary around the renderer; and
per-campaign session persistence. See ADR-020.

---

## 11. ADR Candidates

These decisions are formalized as full Architecture Decision Records in [`docs/adr/`](docs/adr/README.md). Summary:

> **This table is the original 10-ADR candidate list (pre-Phase-0).** The authoritative, current index
> is [`docs/adr/README.md`](docs/adr/README.md) — now **ADR-001–045**, with status changes (e.g.
> ADR-009 **superseded by ADR-016**; ADR-003 refined by ADR-012). Post-MVP ADRs: 013 (recap), 014
> (import), 015 (scene), 016 (Suggest v2), 017 (chronology), 018 (backfill), 019 (event re-scope),
> 020 (operational hardening), 021 (creature type · note confidence · campaign-lore notes),
> 022 (main character + journal-driven capture), 023 (post-journal capture/UI refinements),
> 024 (grim "Ash & Ember" re-theme), 025 (Converse — in-character question lens), 026 (Counsel v2),
> 027 (scene Counsel-only), 028 (changeset field changes), 029 (main character overhaul — mandatory
> single lens · Voice Examples · derive-from-backstory), 030 (Character page + unified persona), 031
> (changeset dedup hardening), 032 (UX consolidation — nav restructure · Lore/Draft/Keeper naming ·
> shared failure copy · note/tie editability), 033 (per-direction tie enrichment + confidence),
> 034 (Converse v2 — questions-only), 035 (two-tier extraction + close-out/Illuminate), 036 (Chronicle-header
> consolidation), 037 (session integrity + editable chronicle entries), 038 (entity merge), 039 (entity
> portraits — migration 0011), 040 (relationship "Web" graph), 041 (fake-AI e2e seam), 042 (distribution +
> auto-update + proprietary license), 043 (fake-AI seam for all lenses), 044 (forced first-run tutorial),
> 045 (tutorial trim + Quickstart guide).

| # | Decision | Status |
|---|---|---|
| ADR-001 | Embeddings runtime: Transformers.js (Node/ONNX) vs. Python sidecar | Recommended: Transformers.js. Rationale in Section 2. |
| ADR-002 | Embedding model: `all-MiniLM-L6-v2` via `@xenova/transformers` | Recommended. 384-dim, CPU-capable, proven quality. |
| ADR-003 | Vector store: `sqlite-vec` extension co-located in main SQLite DB | **Confirmed** by developer — native `.dll` packaging is acceptable. Zero additional process, trivially packaged. |
| ADR-004 | Local datastore: SQLite via `better-sqlite3` + Drizzle ORM | Recommended. Battle-tested, synchronous API, single file. |
| ADR-005 | API key storage: Electron `safeStorage` (DPAPI on Windows) | Recommended. No additional dependency, OS-level protection. |
| ADR-006 | Electron bundler: `electron-vite` | Recommended over `webpack`/`electron-forge` alone for DX. |
| ADR-007 | State management: Zustand (lightweight) vs. React Context | Evaluate in Phase 0; Zustand recommended for non-trivial shared state. |
| ADR-008 | Streaming IPC protocol: custom channel vs. `EventEmitter`-based | Custom typed channels recommended; simpler to reason about. |
| ADR-009 | Suggest output model: multi-attitude structured output (select 4 of 7 attitudes, one in-character action each) | **Confirmed** by developer. Use `output_config.format` with an `attitude` enum; validate count/uniqueness in code. |
| ADR-010 | Global quick-add hotkey behavior: focus main window vs. dedicated quick-capture popup | Decide in Phase 0. Popup leans toward least disruption at the table. |
