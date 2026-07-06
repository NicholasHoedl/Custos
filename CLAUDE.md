# Ledger — project guide for coding agents

Local-first desktop app for tracking a tabletop RPG campaign with a time-aware, AI-backed memory
(Capture · Recall · Suggest, plus Chronology / Backfill / Import / Recap). This file is the fast
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
  `.sql`, keep `_journal.json` + the snapshot. Currently **7 migrations (0000–0006)**.
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
- **AI-grounding seams:** `formatState` + `buildUserContent` / `buildSuggestUserContent` in
  `claude.service.ts` are where entity state (lifecycle → `[ended]` / `[presumed ended — unconfirmed]`),
  relationships, and note `confidence` (→ `· (rumored)` / `· (suspected)` in the citeable title) get
  injected. Change what the model is told *here*.
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
