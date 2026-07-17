# Custos

A local-first desktop app for tracking a tabletop RPG campaign — with a memory that understands
**time**. Capture the people, places, factions, quests, and events of your game; then ask questions
in plain language and get answers grounded in your own notes, in your character's voice, reconstructed
as of *any* session.

Everything lives on your machine. Retrieval runs offline; only the written answers call Claude.

## The main loop

Custos is built around one night-to-night loop:

1. **Chronicle** — jot down what happens at the table, one plain line at a time. This is the view you
   live in during a session.
2. **Extract** — turn a session's log into structured entities, notes, and status changes in a single AI
   pass, reviewed before anything is saved.
3. **Illuminate** — the Keeper re-reads everything known about each entity the session touched and fills
   in the relationships and profile details the notes support (again, review-gated).
4. **Ask** — **Lore** answers natural-language questions with citations from your own notes; **Counsel**
   offers narrative options for the moment; **Converse** gives you in-character questions to draw an NPC
   (or a fellow party member) out. Every answer is grounded in what you've captured, in your main
   character's voice, reconstructed as of *any* session.

## The rest of the app

- **Home** — the default landing view: your campaign at a glance — who you're playing, a "previously
  on…" recap of the last session, what needs doing before the next one, open threads (quests and
  rumors), a mini relationship map, and a box to ask the Keeper.
- **Codex** — the world library: add and browse every person, place, faction, quest, item, event, and
  creature through a full per-type profile form. An OS-global hotkey (`Ctrl+Alt+L`) opens the add-entity
  form from anywhere.
- **Character page** — every campaign has one main character; a dashboard manages their profile, persona,
  and voice examples, and a **Draft-from-backstory** tool derives the profile *and* proposes the people,
  places, notes, and ties your backstory implies — all review-gated.
- **Sessions** — browse each session with its summary and recap; alongside Extract and Illuminate,
  **Transcribe** pastes in outside notes and **Insert before** backfills an earlier session if you
  started tracking mid-campaign.
- **Web** — a live force-directed graph of the campaign's relationships you can filter, focus, and rewind
  session by session.
- **Continuity** — a read-only audit that flags contradictions in your records (a fallen character still
  acting, ally/enemy conflicts, status mismatches), with one-click fixes for the deterministic ones.
- A global **command palette** (`Ctrl+K` — jump to any view or find any entity), and **chronology**
  throughout: the world reconstructed "as of session N" with no future-knowledge leak.

## Stack

Electron · React 19 · TypeScript · Tailwind 4 + shadcn/ui · Zustand · SQLite (better-sqlite3) +
Drizzle ORM · local sentence embeddings + cross-encoder reranking via `@huggingface/transformers`
(`Alibaba-NLP/gte-base-en-v1.5`) · the Anthropic SDK (main-process only). Windows-first.

## Download & install

**This is how to run Custos — no terminal, no developer tools.** Grab the latest
`Custos Setup X.Y.Z.exe` from the [Releases](https://github.com/NicholasHoedl/Custos/releases) page and
**double-click it**. It installs like any Windows program — a per-user install (no administrator prompt)
that adds a **Start-menu and desktop shortcut** and opens the app when it finishes. After that you launch
Custos by clicking its shortcut, exactly like any other application.

The installer is **not yet code-signed**, so the first time you run it Windows SmartScreen may warn about
an "unknown publisher" — choose **More info → Run anyway** (a one-time click). Once installed, Custos
**updates itself**: it checks for new releases on launch and installs them in the background, and you can
also check manually from **Settings → Your data → Check for updates**.

## Building from source (developers only)

Everything below is for building or hacking on Custos itself — **players don't need any of this; just use
the installer above.** Requires Node 22 and (for the AI features) an Anthropic API key.

```bash
npm install        # postinstall rebuilds better-sqlite3 for the Electron ABI
npm run dev         # launch the app with hot reload
```

On first launch a short guided tutorial walks you through creating a campaign (each is created with its
**main character** — the hero you play), then adding your API key (you can skip it for now) and
downloading the local search model (~230 MB — a long-context embedder plus a reranker). The key is stored
encrypted via Electron safeStorage — it never leaves your machine except to call Anthropic. Codex capture
works without either; Lore and Counsel need both the key and the model; Converse and the Character tools
need only the key; Continuity's automatic consistency checks run with neither.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run build` | Typecheck + build the production bundle |
| `npm run dist` | Build the Windows installer into `dist/` (unsigned by default — see [`RELEASING.md`](RELEASING.md)) |
| `npm test` | Run the unit + integration suite (Vitest, under Electron-as-Node) |
| `npm run test:e2e` | Build + run the Playwright end-to-end tests |
| `npm run typecheck` | Type-check the main + renderer projects |
| `npm run lint` | ESLint |
| `npm run format` | Format the codebase with Prettier |
| `npm run db:generate` | Generate a new Drizzle migration from schema changes |
| `npm run rebuild` | Rebuild the native `better-sqlite3` binding for the current Electron ABI |
| `npm start` | Preview the built production bundle (`electron-vite preview`) |
| `npm run test:watch` | Run the Vitest suite in watch mode |

## Your data

Everything is stored under the app's user-data directory (`%APPDATA%\Custos` on Windows):

- `custos.db` — the campaign database (SQLite/WAL).
- `backups/` — a rotating snapshot of the DB taken before migrations on each launch (keeps the 5
  newest). To restore, replace `custos.db` with a backup while the app is closed.
- `logs/main.log` — the main-process log (rotates at 1 MiB).
- `models/` — the downloaded local search models (the embedder and the reranker).
- `anthropic.key.enc` — your encrypted API key.
- `usage.json` — AI token-usage + cost totals in monthly buckets (the Settings "AI usage" card).
- `window-state.json` — the persisted window position and size.

## Documentation

- [`SPEC.md`](SPEC.md) — product spec; §10 lists everything delivered beyond the MVP.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture and module layout.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — the current roadmap (the post-MVP "professionalization" arc, P0–P2).
- [`ROADMAP.md`](ROADMAP.md) — the original, now-historical MVP plan (kept because the ADRs and SPEC cite
  its item codes; superseded for forward planning by `docs/ROADMAP.md`).
- [`docs/adr/`](docs/adr/README.md) — Architecture Decision Records: the *why* behind the
  significant choices.
- [`docs/design/`](docs/design) — design docs for the larger features (e.g. Chronology).

## License

**Proprietary — © 2026 Nicholas Hoedl, all rights reserved.** The source is available for reference only;
it is not open-source. You may download and run official prebuilt releases for personal use, but you may
not reuse, modify, or redistribute the code without written permission. See [`LICENSE`](LICENSE).
