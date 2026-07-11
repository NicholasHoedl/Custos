# Ledger — professionalization roadmap

Source: the 2026-07-09 professional-grade audit (deployment readiness · missing features · clunky UI ·
coherence). This is the living plan for that work. Each item lists its intended shape and key files so
a fresh context can pick any one up. Status: ☐ open · ◐ in progress · ☑ done. Keep this file honest —
update statuses as items land, and move design changes INTO the item rather than letting the doc rot.

Priorities: **P0** = trust floor (do regardless of audience) · **P1** = product completeness ·
**P2** = scale/polish + distribution (⚑ = only matters once strangers install it) · **R** = removals.

---

## P0 — trust floor

### P0-1 ☑ Destructive-action consistency (note delete + hover affordances)
The only unguarded destructive action: NoteCard's hover-revealed X deletes with no confirm
(`NotesView.tsx`). Add an AlertDialog confirm matching the session/entity pattern. Make hover-only
action clusters (NoteCard edit/delete, `RelationshipEditor` icons) also reveal on keyboard focus
(`group-focus-within` alongside `group-hover`). Renderer-only.

### P0-2 ☑ Close the data loop (import + on-demand backup + folder affordances)
- **Import campaign** — the missing half of the existing export (`export.service.ts`,
  `shared/export-types.ts` `CAMPAIGN_EXPORT_VERSION`):
  - `import-campaign.service.ts`: validate version + structural sanity → reject if `campaign.id`
    already exists (re-import of a live campaign is the only realistic collision; UUIDs otherwise
    never collide) → insert ALL rows **preserving ids + timestamps** in ONE transaction, dependency
    order: campaign (mainCharacterId deferred null) → entities → set mainCharacterId → sessions →
    notes + note↔entity junction → links → statusHistory → eventLog → personae. Raw drizzle inserts
    (the `create*` service fns mint fresh ids — unusable here).
  - Embeddings are omitted from exports by design → fire the existing backfill/reindex after commit.
  - IPC `campaign:import`: open dialog → parse → service → `{ok, counts}` result object (returned,
    not thrown — mirror `campaignExport`). Renderer: entry in the Sidebar campaign menu next to
    Export; on success switch the active campaign to the import + toast counts.
  - Test: integration round-trip — seed → `buildCampaignExport` → delete campaign → import → export
    again → deep-equal (minus `exportedAt`); plus the collision rejection.
- **Back up now** — `backupDatabase()` is `VACUUM INTO` through the live connection (WAL-safe any
  time, `db/backup.ts`). Expose IPC `app:backupNow` (needs the raw better-sqlite3 handle from
  `db/index.ts`), return the snapshot path.
- **Open data folder / Open logs** — IPC wrapping `shell.openPath`; today these affordances exist
  only in the startup crash dialog.
- Settings gains a **"Your data"** section: DB location, Back up now, Open data folder, Open logs,
  Import campaign (also reachable from the Sidebar menu).

### P0-3 ☑ Finished-app shell (version + window state + renderer errors → main.log)
- **About/version**: IPC `app:info` → `app.getVersion()`; display "Ledger vX.Y.Z" in the Settings
  "Your data"/About section (today the version exists nowhere in the UI).
- **Window-state persistence**: main-only `window-state.ts` — persist bounds+maximized to
  `userData/window-state.json` (debounced on resize/move, flushed on close); restore on create with
  an on-screen validation against `screen.getAllDisplays()` (drop to defaults if the saved rect is
  off-screen). No renderer involvement.
- **Renderer errors to disk**: preload channel `log:rendererError` → electron-log with a `renderer`
  scope. Wire `ErrorBoundary.componentDidCatch` + window `error`/`unhandledrejection` listeners
  (dedupe repeats). Today renderer crashes log to a devtools console that doesn't exist when packaged.

### P0-4 ☑ AI cost meter
- **main `usage.service.ts`**: `PRICES` per model per MTok (sonnet-4-6 $3/$15 · opus-4-8 $5/$25 ·
  haiku-4-5 $1/$5; cache read 0.1× input, cache write 1.25×) → `costOf(model, usage)`;
  `record({feature, model, usage})` appends into monthly buckets persisted at `userData/usage.json`;
  IPC `usage:summary` (this month + lifetime, per-feature).
- **claude.service threading**: every call helper gains `feature: string` (recorded centrally) and
  optional `onUsage` callback so callers can attach per-run cost without changing return types
  (mock-safe — existing tests ignore extra opts). Streaming paths (recall/recap) record at
  `message_delta` and ride cost on the `done` IPC event.
- **Per-run display**: optional `cost` field on ok-results for Lore/Counsel/Converse/extract/enrich;
  renderer shows a muted "≈ $0.04 · 12.3k in / 1.5k out" line; the close-out wizard's summary and
  Illuminate sum their calls ("This close-out used ≈ $0.31").
- **Settings "AI usage" card**: this-month total, per-feature breakdown, lifetime.
- Tests: cost math + monthly bucketing + persistence (mock `app.getPath` like settings tests).

---

## P1 — product completeness

- **P1-1 ☑ "Inscribe this answer" + copy + history.** Copy button on every AI output; save a
  Lore/Counsel/Converse result to Annals as a campaign-lore note (null-entity notes exist — ADR-021);
  keep last ~5 results per lens in the hook (session-scoped, no persistence).
- **P1-2 ☑ Unclosed-session nudge.** Definition: session has chronicle entries newer than its last
  close-out apply (needs a lightweight `lastClosedOutAt` stamp on session — or derive from event
  timestamps vs note stamps; decide at build). Badge on the Close-out button + Sessions rows.
- **P1-3 ☑ The loop explainer.** One onboarding card/diagram naming the ritual: Chronicle → Close out
  → Codex → Illuminate → Lore/Counsel/Converse. Copy + one static diagram; fixes the biggest
  coherence gap. Also give Counsel/Converse empty states the Keeper's voice (audit §4.5).
- **P1-4 ☑ Chronicle entry edit/delete** (pre-close-out only, to keep the ritual honest — gate on the
  P1-2 stamp once it exists).
- **P1-5 ☑ Cancel for Counsel/Converse/Transcribe.** Services already take AbortSignal; only
  recall/recap wire a real controller. Generalize recall's cancel-channel pattern
  (`ipc/recall.ts:17`) to suggest/converse/import/enrich.
- **P1-6 ☑ Entity merge.** Pick survivor + loser → re-point notes (junction rows), links (both ends,
  drop self-loops + dedupe against survivor's live ties), status history, event log refs, personas
  (MC guard); delete loser; re-embed survivor. One transaction + integration test. UI: action in
  EntityDetail overflow.
- **P1-7 ☑ Verb-register pass.** "Extract"→"Transcribe" (button), Lore's "Ask"→ Keeper-voiced verb;
  audit empty-state copy against the register in one sweep (`lib/ai-copy.ts` where shared).

## P2 — scale, polish, distribution

- **P2-1 ☑ Distribution stack** (ADR-042). Proprietary `LICENSE` + `engines`/`repository`/`homepage`;
  **electron-updater** auto-update against public GitHub Releases (`publish:` in electron-builder.yml →
  `latest.yml`; packaged-only `updater.service.ts` → `UPDATE_STATUS_CHANNEL` → a "Check for updates"
  Settings surface); a tag-triggered **release CI job** (`release.yml`, `electron-builder --publish
  always`). **Unsigned but cert-ready** (`CSC_*` secrets auto-sign later). Activates once the repo is
  public + a tagged release is published; see `RELEASING.md`.
- **P2-2 ☑ Entity portraits** (ADR-039). Nullable `entity.image` column (migration 0011) holding a
  base64 JPEG **thumbnail** — chosen over a userData images dir so there's no file lifecycle and it rides
  export/import for free. `nativeImage` picker (no new dep); rendered via a shared `Portrait` in
  EntityDetail/Browser/Character + clipped into the Web nodes. Not embedded.
- **P2-3 ☑ Relationship graph view** (ADR-040). New 9th nav view **Web**: a d3-force layout (first viz
  dep) over `buildCampaignGraph` (live ties only), rendered as themed SVG with pan/zoom/node-drag and
  click-to-open. No migration.
- **P2-4 ☑ Global command palette** (cmdk is already a dependency; entities + views + actions).
- **P2-5 ☐ List virtualization + note pagination** once a campaign crosses ~1k notes (Codex/Annals
  first; measure before building).
- **P2-6 ☑ Close-out wizard e2e** (ADR-041). Added the first AI-mocking seam to the e2e harness — an
  env-gated `LEDGER_FAKE_AI` (+ `!app.isPackaged`) branch at the two close-out call sites returns canned
  proposals so the wizard runs offline/keyless while the real IPC + validators + DB apply still execute.
  `close-out.spec.ts`: the full both-tier happy path + the reject/lock-exit path.
- **P2-7 ☑ Fake-AI e2e coverage for ALL lenses** (ADR-043, follow-on to P2-6). Extended the seam from the
  close-out's two calls to every AI lens — Transcribe · Counsel · Converse · Recall · Recap · Draft — with
  one canned builder + branch per lens (plus a faked `generatePersona` and a `modelReady`-under-fake hook
  that keeps the model-free fuzzy retrieval real for Counsel/Recall). One spec per lens; the e2e suite grew
  **10 → 16** tests. Every AI surface now has an offline regression net.

## Post-audit features (beyond the original P0–P2 arc)

- **☑ Forced first-run tutorial** (ADR-044). A non-skippable guided modal wizard on first launch: name →
  campaign → main character → session → a real chronicle entry → a hard-required, **live-validated**
  Anthropic key → a **real** close-out → a tool tour → finish, leaving a usable campaign. Reorders the
  navbar to the teaching sequence (Chronicle first; revises ADR-030). Gated by a persisted
  `tutorialCompleted` flag; auto-skipped in e2e via `LEDGER_SKIP_TUTORIAL`. e2e: `tutorial.spec.ts` (17 specs).
- **☐ Multi-provider AI (OpenAI + Gemini)** — a large, deferred architecture project: abstract the
  Anthropic-only `claude.service` behind a provider interface (three SDKs; per-provider structured output,
  streaming, model catalogs, pricing, key storage + validation). Prompted by the tutorial's "support
  Gemini/OpenAI keys" ask; explicitly split out of ADR-044 to keep that change clean. Not started.

## R — removals (subtractions that finish the product)

- **R-1 ☑ `fontSize`**: dead setting (declared + defaulted, read nowhere) — remove from `AppSettings`
  + defaults, or wire it. Decision: remove.
- **R-2 ☑ `ThemeMode`**: single-variant union pretending to be a choice — collapse to a constant;
  dark IS the brand.
- **R-3 ☑ `'import'` ViewKey**: vestigial since Transcribe left the nav (ADR-036).

---

## Conventions for this arc
- Order within P0: P0-1 → P0-3 → P0-2 → P0-4 (cheap wins → shell → data loop → meter).
- Every item: typecheck + lint + full suite green before moving on; main/preload/shared edits need a
  full app restart to verify live (HMR only reloads the renderer).
- Commit per item or per coherent pair, only when asked.
