# Ledger — Architecture Document

**Version:** 0.1 (MVP Planning)
**Date:** 2026-06-25
**Status:** Draft — awaiting developer approval

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
| Vector store | `sqlite-vec` extension for SQLite | Keeps the vector index in the same SQLite file as the relational data. No separate process, no additional service, trivially packaged. |
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

**Developer-provided palette (Tailwind format) — use verbatim:**

```js
{
  light_cyan: { DEFAULT: '#e0fbfc', 100: '#095456', 200: '#11a7ad', 300: '#32e5eb', 400: '#88f0f3', 500: '#e0fbfc', 600: '#e5fcfc', 700: '#ecfcfd', 800: '#f2fdfe', 900: '#f9fefe' },
  light_blue: { DEFAULT: '#c2dfe3', 100: '#1b363a', 200: '#356d74', 300: '#50a3ae', 400: '#8ac2c9', 500: '#c2dfe3', 600: '#cfe6e9', 700: '#dbecef', 800: '#e7f3f4', 900: '#f3f9fa' },
  cool_steel: { DEFAULT: '#9db4c0', 100: '#1b252a', 200: '#364a55', 300: '#516f7f', 400: '#7192a4', 500: '#9db4c0', 600: '#afc2cc', 700: '#c3d1d9', 800: '#d7e1e6', 900: '#ebf0f2' },
  blue_slate: { DEFAULT: '#5c6b73', 100: '#131617', 200: '#252b2e', 300: '#384146', 400: '#4a565d', 500: '#5c6b73', 600: '#798b94', 700: '#9ba8af', 800: '#bcc5c9', 900: '#dee2e4' },
  jet_black:  { DEFAULT: '#253237', 100: '#070a0b', 200: '#0f1416', 300: '#161e21', 400: '#1d282c', 500: '#253237', 600: '#465f69', 700: '#688c9b', 800: '#9bb3bc', 900: '#cdd9de' }
}
```

**Role mapping (dark-first):**
- **Dominant canvas / surfaces:** `jet_black` (#253237) and `blue_slate` (#5c6b73) — a cool charcoal-teal base. Layer surfaces using the `jet_black`/`blue_slate` scales for depth (not flat cards).
- **Primary text / borders:** `cool_steel` (#9db4c0) and the lighter `blue_slate` steps on dark; `light_cyan`/`light_blue` for high-emphasis text on dark.
- **Single sharp accent:** vivid cyan **`#32e5eb`** (`light_cyan-300`), with **`#11a7ad`** (`light_cyan-200`) as a deeper accent variant. Reserve the accent for interactive affordances, focus rings, active states, and Recall citations — used sparingly so it stays sharp.
- **Light tints:** `light_cyan` (#e0fbfc) / `light_blue` (#c2dfe3) for any light surfaces or inverse panels.

**Design-language guardrails (explicit developer feedback):** Past attempts to make a UI "feel like a ledger" produced *generic shadcn components recolored beige*. Do **not** do that. The identity here is a committed **dark, cool, charcoal-teal canvas with one vivid cyan accent** — not parchment, not skeuomorphic paper, not beige. The "ledger" character must come from **typography and structure** (Fraunces display at large sizes with weight extremes, Bricolage Grotesque body, JetBrains Mono for IDs/timestamps; strong hierarchy and size jumps; layered slate surfaces for depth), not from coloring standard components. Make distinctive, intentional choices.

---

## 2. Why NOT a Python Sidecar (ADR-001 Preview)

A Python sidecar for embeddings (sentence-transformers) would play to the developer's Python strength but introduces:

- A second language runtime to bundle and manage in Electron
- Process lifecycle management (spawn, health-check, graceful shutdown, crash recovery)
- Significantly more complex packaging (PyInstaller or similar)
- A bloated distributable (Python + sentence-transformers + numpy is several hundred MB)
- IPC over stdio or a local HTTP socket — more failure surface

Transformers.js with ONNX runs the same model family in the Node.js main process with no additional runtime, ~50MB for the model file, and trivial packaging. Quality for `all-MiniLM-L6-v2` is identical to the Python equivalent because they share the same ONNX model weights. The Python sidecar is listed as ADR-001 and deferred to a future phase only if CPU inference speed proves unacceptable.

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
│  │  │   + sqlite-vec     │   │                                   │
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

Ledger is a **single-window** app with **panel switching** (confirmed by the developer over a multi-panel layout). The window is a persistent left **Sidebar** (campaign selector + nav: Capture / Recall / Suggest / Settings / entity browser) plus a single **MainPanel** that renders exactly one feature view at a time; clicking a sidebar item swaps the active view. There is **no persistent secondary "AI drawer"** in the MVP — Recall and Suggest are their own full panels, not always-on side rails. View switching is client-side (a lightweight router / tab switcher in the renderer; the active view lives in renderer state — see ADR-007). The global quick-add hotkey (below) is the one path that surfaces capture without first switching panels.

### Security Boundary

The renderer process is an untrusted environment (it runs Chromium, which could be exposed to malicious content if external URLs are ever loaded). Therefore:

- The API key **never** crosses the contextBridge into the renderer — not in arguments, return values, or error messages
- The `@anthropic-ai/sdk` client is instantiated **only** in the main process
- `nodeIntegration: false` and `contextIsolation: true` are enforced in the BrowserWindow config (Electron defaults for new apps)
- All external network calls originate from the main process
- The renderer communicates only via typed IPC channels exposed through contextBridge

### Global Quick-Add Hotkey (accounted for from Phase 0)

The developer wants a **system-level global quick-add hotkey** that works even when Ledger is not focused, so the window/main-process architecture accommodates it from the start rather than bolting it on later:

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

EntityType ENUM: 'npc' | 'location' | 'faction' | 'quest' | 'item' | 'pc' | 'event'

Entity
  id           UUID PK
  campaignId   UUID FK → Campaign.id
  type         EntityType NOT NULL
  name         TEXT NOT NULL
  description  TEXT
  traits       TEXT (JSON array of strings — used heavily for PC in Suggest)
  goals        TEXT (JSON array of strings — for NPC / PC)
  status       TEXT ('active' | 'inactive' | 'dead' | 'resolved' | ...)
  createdAt    INTEGER (unix ms)
  updatedAt    INTEGER (unix ms)

Note
  id           UUID PK
  entityId     UUID FK → Entity.id
  sessionId    UUID FK → Session.id (session in which the note was created)
  content      TEXT NOT NULL
  tags         TEXT (JSON array of strings)
  createdAt    INTEGER (unix ms)

EntityLink
  id           UUID PK
  fromEntityId UUID FK → Entity.id
  toEntityId   UUID FK → Entity.id
  relation     TEXT ('member_of' | 'located_in' | 'involved_in' | 'owns' | 'allied_with' | ...)
  campaignId   UUID FK → Campaign.id

EventLog
  id           UUID PK
  sessionId    UUID FK → Session.id
  campaignId   UUID FK → Campaign.id
  content      TEXT NOT NULL
  entityId     UUID FK → Entity.id (nullable — optional tag)
  timestamp    INTEGER (unix ms)
```

### Vector Index (sqlite-vec)

Co-located in the same SQLite file via the `sqlite-vec` extension:

```
NoteEmbedding
  noteId       UUID FK → Note.id (PK)
  embedding    BLOB (float32 array, 384 dims for all-MiniLM-L6-v2)

EventEmbedding
  eventId      UUID FK → EventLog.id (PK)
  embedding    BLOB (float32 array, 384 dims)
```

The virtual table for ANN search is created by `sqlite-vec` on top of these columns. For the MVP data volume (hundreds to low thousands of notes), brute-force cosine over a `vec0` virtual table is fast enough. HNSW indexing can be added later if needed.

### Key Relationships

```
Campaign ──< Session
Campaign ──< Entity
Entity   ──< Note
Entity   ──< EntityLink (from/to)
Session  ──< Note
Session  ──< EventLog
Note     ──1 NoteEmbedding
EventLog ──1 EventEmbedding
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
VectorStore.upsert(noteId, embedding) → writes to NoteEmbedding table via sqlite-vec
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
        │    └─ sqlite-vec cosine similarity search filtered by campaignId
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
| Suggest | `claude-opus-4-8` | Marquee reasoning feature; adaptive thinking + structured output (4 attitude-based recommendations) |
| Auto-tagging (future) | `claude-haiku-4-5` | Background task, latency-insensitive |

### ClaudeService Interface (main process only)

```typescript
// Conceptual interface — not implementation code
interface ClaudeService {
  recall(params: RecallParams): AsyncIterable<RecallChunk>   // streamed
  suggest(params: SuggestParams): Promise<SuggestResult>     // single structured response
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

---

## 7. IPC Architecture

All communication between renderer and main process goes through typed IPC channels defined in a shared `src/shared/ipc-types.ts`. The renderer calls `window.ledger.*` (the contextBridge API); the main process handles via `ipcMain.handle()`.

### Channel Inventory (MVP)

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
'suggest:query'      → SuggestResult (single structured response: 4 attitude recommendations)

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
│   │   │   ├── vector-store.service.ts # sqlite-vec queries
│   │   │   ├── recall.service.ts      # retrieval orchestration
│   │   │   ├── suggest.service.ts     # suggest orchestration
│   │   │   ├── claude.service.ts      # @anthropic-ai/sdk wrapper
│   │   │   └── key.service.ts         # safeStorage wrapper
│   │   └── db/
│   │       ├── index.ts               # DB connection singleton
│   │       ├── schema.ts              # Drizzle schema definitions
│   │       └── migrations/            # Drizzle migration files
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

---

## 11. ADR Candidates

These decisions are formalized as full Architecture Decision Records in [`docs/adr/`](docs/adr/README.md). Summary:

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
