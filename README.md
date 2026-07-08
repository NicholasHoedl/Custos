# Ledger

A local-first desktop app for tracking a tabletop RPG campaign — with a memory that understands
**time**. Capture the people, places, factions, quests, and events of your game; then ask questions
in plain language and get answers grounded in your own notes, in your character's voice, reconstructed
as of *any* session.

Everything lives on your machine. Retrieval runs offline; only the written answers call Claude.

## The three pillars

- **Codex** — entry of entities (a full per-type profile form), notes, and links, organized per
  campaign and session. A global hotkey / `Ctrl+K` opens the add-entity form from anywhere.
- **Lore** — ask a natural-language question; get a cited, streamed answer synthesized from the
  relevant notes (semantic search over local embeddings).
- **Counsel** — in-character ideas for the moment (six tagged options in your main character's voice) or
  open-ended directions for where to take the story next.

Built on top of these: the **Character page** (every campaign has one **main character** — the hero you
play and the voice the Keeper speaks in; a dashboard manages their profile, persona, and voice examples, and
a **Draft-from-backstory** tool derives the profile *and* proposes the people, places, notes, and ties your
backstory implies — all review-gated), **Converse** (pick a character to talk *with* — an NPC or a fellow
party member — and get a spread of tagged, in-character questions to draw them out, from safe openers to
pointed probes; name a thread to steer them), the **Chronicle** (jot plain lines of what happened; when
the night is over, **Close out session** runs the Keeper over the whole log — entities, notes, and
status changes, then straight into Illuminate — in one review wizard built for volume; the header also
hosts the session switcher and the paste-and-extract **Transcribe** dialog, which can tie an import to
any session or none), **Sessions** (browse each session with its summary, a "previously on…" recap, and
**Illuminate** — a review-gated pass where the Keeper re-reads everything known about each entity the
session touched and fills in the profile details and relationship ties the notes support), and
chronology throughout (the world reconstructed "as of session N" with no future-knowledge leak).

## Stack

Electron · React 19 · TypeScript · Tailwind 4 + shadcn/ui · Zustand · SQLite (better-sqlite3) +
Drizzle ORM · local sentence embeddings via Transformers.js (all-MiniLM-L6-v2) · the Anthropic SDK
(main-process only). Windows-first.

## Getting started

Requires Node 22 and (for the AI features) an Anthropic API key.

```bash
npm install        # postinstall rebuilds better-sqlite3 for the Electron ABI
npm run dev         # launch the app with hot reload
```

On first run, create a campaign (each is created with its **main character** — the hero you play), then
open **Settings** to add your API key (stored encrypted via Electron safeStorage — it never leaves your
machine except to call Anthropic) and download the ~30 MB local search model. Codex capture works without
either; Lore and Counsel need both; Converse and the Character page's AI tools need only the key.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run build` | Typecheck + build the production bundle |
| `npm run dist` | Build a signed Windows installer into `dist/` |
| `npm test` | Run the unit + integration suite (Vitest, under Electron-as-Node) |
| `npm run test:e2e` | Build + run the Playwright end-to-end tests |
| `npm run typecheck` | Type-check the main + renderer projects |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a new Drizzle migration from schema changes |

## Your data

Everything is stored under the app's user-data directory (`%APPDATA%\Ledger` on Windows):

- `ledger.db` — the campaign database (SQLite/WAL).
- `backups/` — a rotating snapshot of the DB taken before migrations on each launch (keeps the 5
  newest). To restore, replace `ledger.db` with a backup while the app is closed.
- `logs/main.log` — the main-process log (rotates at 1 MiB).
- `models/` — the downloaded embedding model.
- `anthropic.key.enc` — your encrypted API key.

## Documentation

- [`SPEC.md`](SPEC.md) — product spec; §10 lists everything delivered beyond the MVP.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture and module layout.
- [`ROADMAP.md`](ROADMAP.md) — the (shipped) MVP plan and the deferred backlog.
- [`docs/adr/`](docs/adr/README.md) — Architecture Decision Records: the *why* behind the
  significant choices.
- [`docs/design/`](docs/design) — design docs for the larger features (e.g. Chronology).

## License

MIT.
