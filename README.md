# Custos

A local-first desktop app for tracking a tabletop RPG campaign — with a memory that understands
**time**. Capture the people, places, factions, quests, and events of your game; then ask questions
in plain language and get answers grounded in your own notes, in your character's voice, reconstructed
as of *any* session.

Everything lives on your machine. Retrieval runs offline; only the written answers call Claude.

## The main loop

Custos is built around one night-to-night loop (the same one its in-app Quickstart teaches):

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

## First run

The first time you open Custos, a short guided tour walks you through creating your campaign and its main
character. Capture works right away — but the AI features need your own **Anthropic API key** (get one at
[console.anthropic.com](https://console.anthropic.com/settings/keys)) and a one-time download of the local
search model (~230 MB):

- **Lore** and **Counsel** need both the key and the search model.
- **Converse** and the **Character** tools need only the key.
- **Continuity**'s automatic checks — and all your capture (Chronicle, Codex, Sessions) — work with neither.

Your key is stored **encrypted on your device** and is only ever used to call Anthropic directly — it never
passes through anyone else's servers. You can skip it during setup and add or change it anytime in
**Settings**.

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

## License

**Proprietary — © 2026 Nicholas Hoedl, all rights reserved.** The source is available for reference only;
it is not open-source. You may download and run official prebuilt releases for personal use, but you may
not reuse, modify, or redistribute the code without written permission. See [`LICENSE`](LICENSE).
