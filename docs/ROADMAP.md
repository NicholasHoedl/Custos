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

- **P1-1 ☐ "Inscribe this answer" + copy + history.** Copy button on every AI output; save a
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
- **P1-5 ☐ Cancel for Counsel/Converse/Transcribe.** Services already take AbortSignal; only
  recall/recap wire a real controller. Generalize recall's cancel-channel pattern
  (`ipc/recall.ts:17`) to suggest/converse/import/enrich.
- **P1-6 ☐ Entity merge.** Pick survivor + loser → re-point notes (junction rows), links (both ends,
  drop self-loops + dedupe against survivor's live ties), status history, event log refs, personas
  (MC guard); delete loser; re-embed survivor. One transaction + integration test. UI: action in
  EntityDetail overflow.
- **P1-7 ☑ Verb-register pass.** "Extract"→"Transcribe" (button), Lore's "Ask"→ Keeper-voiced verb;
  audit empty-state copy against the register in one sweep (`lib/ai-copy.ts` where shared).

## P2 — scale, polish, distribution

- **P2-1 ☐ ⚑ Distribution stack**: code signing (needs a cert decision), electron-updater +
  publish config, a release job in CI (tag → build → artifact), LICENSE, `engines` field.
- **P2-2 ☐ Entity portraits** (nullable image column + userData images dir + picker/drop-zone;
  render in EntityDetail/Browser/Character).
- **P2-3 ☐ Relationship graph view** (read-only force layout over live ties; the data already exists).
- **P2-4 ☐ Global command palette** (cmdk is already a dependency; entities + views + actions).
- **P2-5 ☐ List virtualization + note pagination** once a campaign crosses ~1k notes (Codex/Annals
  first; measure before building).
- **P2-6 ☐ Close-out wizard e2e** (the most complex UI currently has none).

## R — removals (subtractions that finish the product)

- **R-1 ☐ `fontSize`**: dead setting (declared + defaulted, read nowhere) — remove from `AppSettings`
  + defaults, or wire it. Decision: remove.
- **R-2 ☐ `ThemeMode`**: single-variant union pretending to be a choice — collapse to a constant;
  dark IS the brand.
- **R-3 ☐ `'import'` ViewKey**: vestigial since Transcribe left the nav (ADR-036).

---

## Conventions for this arc
- Order within P0: P0-1 → P0-3 → P0-2 → P0-4 (cheap wins → shell → data loop → meter).
- Every item: typecheck + lint + full suite green before moving on; main/preload/shared edits need a
  full app restart to verify live (HMR only reloads the renderer).
- Commit per item or per coherent pair, only when asked.
