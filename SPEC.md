# Ledger — Product Specification

**Version:** 0.1 (MVP Planning)
**Date:** 2026-06-25
**Status:** Draft — awaiting developer approval

---

## 1. Problem Statement

Dungeons & Dragons sessions generate a constant stream of narrative information — NPC names and motivations, location details, faction politics, quest hooks, offhand quotes that turn out to matter three sessions later. The current state of the art for most players and Dungeon Masters is a mix of scattered handwritten notes, half-filled Google Docs, and memory. Information is routinely lost, misremembered, or impossible to find quickly.

The core failure modes are:

- **Capture friction**: Note-taking tools are too slow to use live at the table. Players stop taking notes because the UI fights them.
- **Retrieval failure**: Even when notes exist, finding a specific detail from three sessions ago means reading through walls of text.
- **Context blindness**: When deciding how a character would act, players have no fast way to surface what the character knows, wants, and has experienced.

Ledger solves all three.

---

## 2. Target User

**Primary user:** The developer (a solo D&D player and/or Dungeon Master). This is a personal passion project; there is no external user research phase. All UX decisions should be validated against the developer's own session workflow.

**User profile:**
- Plays and/or runs D&D campaigns (one or more active campaigns at any time)
- Takes notes during live sessions (fast input is a hard requirement — the app is used at the table)
- Reviews and queries notes between sessions
- Uses Windows 11
- Has an Anthropic API key and is comfortable providing it in app settings
- Is the sole user of the machine and data — no multi-user or sharing requirements

---

## 3. The Three Pillars

### Pillar 1: Capture

Low-friction narrative note-taking during live play. The app must not slow down the session.

**What it means:**
- Fast entry of structured entities: NPCs, locations, factions, quests/plot threads, items, player characters (PCs), creatures (monsters/beasts), and timestamped session events/quotes
- A campaign-and-session context is always active ("I am taking notes for Campaign X, Session Y")
- Quick-add entry that does not require navigating deep menus or filling long forms
- Entities are linked to each other (an NPC belongs to a location, a quest involves a faction, etc.)
- Notes are freeform text attached to entities; the structure is the entity type, not the note format

**Key flows:**
- Open the app, resume the active session, start capturing
- Quick-add: type a name, pick a type, write a note — done in under 10 seconds
- Link an NPC to a location or faction without leaving the current screen

### Pillar 2: Recall

AI semantic search over the user's notes. Natural-language queries return synthesized, cited answers grounded in the actual notes.

**What it means:**
- The user types a question in plain English ("what did the innkeeper say about the north road three sessions ago?")
- The system embeds the query, retrieves the most relevant note chunks from the local vector store, then passes them to Claude with citations enabled
- Claude synthesizes a direct answer with inline citations pointing back to the source notes
- Recall works **offline for the retrieval step** (local embeddings + local vector store); the synthesis step requires the Anthropic API
- Results are streamed for responsive UX

**Key flow:**
1. User types a natural-language question in the Recall panel
2. App embeds the query locally (no network call)
3. App retrieves top-k relevant note chunks from the local vector index
4. App calls Claude (Sonnet 4.6 default; Opus 4.8 optional) via main process, passing retrieved chunks as document blocks with `citations: {enabled: true}`
5. Streamed answer appears in the UI with clickable citations linking back to the source entity/note
6. If offline: retrieval still works; synthesis step is blocked with a clear message ("Synthesis requires network — showing retrieved notes instead")

### Pillar 3: Suggest

> **As shipped (ADR-016, tuned to 6 in ADR-026-era; see §10):** Suggest returns **6 tagged options** from a ~62-tag vocabulary
> (one primary disposition + ≤2 secondary tags), plus an open-ended "what's next" **directions** mode.
> The 4-of-7-attitudes design described below is the original MVP model, kept here as the historical
> record.

In-character action options during live play. Rather than a single suggestion, Ledger surfaces a **spread of plausible in-character responses** so the player can choose. Given the active PC's traits, goals, and the campaign's current situation, Claude determines which **4 attitudes** the PC is *most likely* to adopt and writes a **unique in-character action for each**.

**What it means:**
- Tied to the currently active player character and campaign context
- Grounded in the campaign's history (via RAG retrieval — relevant history is pulled, not the whole campaign)
- The model picks **4 of the attitudes** below (the ones most likely for *this* PC in *this* moment) and returns one distinct in-character action per chosen attitude
- Uses Claude Opus 4.8 with adaptive thinking (effort `high`, or `medium` if latency is unacceptable at the table) and **structured output**, so the 4 results render as discrete cards
- Stays in character — the model frames each option as something the PC would actually do, not as a narrator

**Attitude taxonomy** (7 attitudes; the model selects the 4 most likely for this PC in this moment):

| Attitude | Meaning |
|---|---|
| Neutral / Default | Impartial, unemotional baseline; no clear alignment ("I don't know what to say") |
| Friendly / Supportive | Cooperation, trust, alignment with allies ("Let's work together to solve this") |
| Hostile / Aggressive | Opposition, distrust, willingness to fight ("I'll take care of this myself — no help from you") |
| Moral / Ethical | Strong sense of right and wrong, often a moral dilemma ("I won't let you hurt anyone") |
| Selfish / Opportunistic | Personal gain over others' well-being ("I'll take the prize for myself") |
| Compassionate / Altruistic | Helping others even at personal cost ("I'll help them no matter what") |
| Cynical / Skeptical | Distrust of others' intentions ("I don't believe you have good intentions") |

**Key flow:**
1. User opens the Suggest panel with the active PC selected
2. User describes the current situation in a short free-text field ("We just found out the mayor is corrupt and the party is split on what to do")
3. App retrieves relevant history (past interactions, PC goals, faction relationships) via RAG
4. App builds a prompt: system role + cached campaign/character context prefix + retrieved history + current situation, instructing the model to choose the 4 most-likely attitudes and give one in-character action each
5. Claude Opus 4.8 returns 4 `{attitude, action}` recommendations (structured output)
6. The 4 options render as distinct attitude cards; the player picks what fits the table
7. If offline: feature is unavailable; clear message shown

---

## 4. MVP Scope

The MVP delivers all three pillars at their simplest viable form. It is a single-user local desktop app with no sync, no collaboration, and no mobile companion.

### In scope for MVP

**Capture**
- Campaign management: create, name, describe, and switch between campaigns
- Session management: create sessions (numbered, dated, with a title/summary field) within a campaign
- Entity CRUD for: NPCs, Locations, Factions, Quests/Plot Threads, Items, Player Characters (PCs), Creatures (monsters/beasts/hazards — see ADR-021), and Events (world-scale history — see ADR-019)
- Freeform notes attached to any entity, timestamped, linked to the session in which they were created
- Timestamped event/quote log per session (quick one-liner capture with optional entity tag)
- Basic entity linking (NPC → Location, NPC → Faction, Quest → NPC, etc.)
- Keyboard-first quick-add flow (global hotkey or persistent quick-add bar)
- Search/filter within entity lists (local text search, no AI)

**Recall**
- Local embedding pipeline: notes chunked and embedded on write (or on demand), stored in local vector index
- Natural-language query interface in a dedicated Recall panel
- Retrieve top-k chunks → synthesize with Claude → stream cited answer
- Citations link back to the source entity and note
- Graceful offline degradation (show retrieved chunks if Claude unavailable)

**Suggest**
- Suggest panel tied to active PC and campaign
- Free-text situation input
- RAG retrieval of relevant context
- Claude Opus 4.8 (adaptive thinking + structured output) returns **4 attitude-based recommendations** — the model picks the 4 attitudes the PC is most likely to adopt and writes a unique in-character action for each *(shipped as **6 multi-tag options** + a **directions** mode — ADR-016/026; see §10)*
- Results render as 4 distinct attitude cards
- Graceful offline degradation (clear unavailable message)

**Onboarding (first run)**
- Explicit first-run onboarding step: enter the Anthropic API key and download the local embedding model (~30 MB) with visible progress, before AI features (Lore / Counsel) are enabled

**Settings**
- API key entry and secure storage (Electron safeStorage)
- Model selection for Recall synthesis (Sonnet 4.6 / Opus 4.8)
- Basic app preferences (theme, font size)

**Infrastructure**
- Single-window Electron shell with React + TypeScript + Tailwind + shadcn/ui
- Local SQLite database for all note/entity data
- Local vector index (SQLite-backed, see Architecture)
- All Claude calls routed through Electron main process (renderer never sees the API key)
- IPC bridge with typed contracts between renderer and main

### Out of scope for MVP

These are explicitly deferred. Do not design the MVP around them. *(Some items below have since
shipped as post-MVP additions — see §10.)*

- Multi-user or sync (no cloud backend, no accounts, no auth)
- Mobile companion app
- Dice rolling or initiative tracker (separate concerns)
- PDF / rulebook ingestion or RAG over external documents
- Agentic RAG (Claude calling a search tool autonomously — MVP is retrieve-then-synthesize, single LLM call)
- Audio transcription of sessions
- Image/map attachment to entities
- Campaign export / import / sharing
- Plugin system or extensibility hooks
- Analytics, telemetry, or crash reporting
- Automated session summarization
- Calendar or session scheduling
- Character sheet management (Ledger tracks narrative, not stats)

---

## 5. Success Criteria

The MVP is successful when the developer can:

1. Open the app at the start of a D&D session and capture NPC names, quotes, and location details in under 10 seconds per entry without losing the thread of play
2. After a session, ask "what did [NPC] say about [topic] in session [N]?" and receive a coherent, cited answer that correctly references the source note
3. During a difficult roleplay moment, open the Suggest panel, describe the situation in a sentence, and receive **4 plausible, distinct in-character options** — one per the attitudes the PC is most likely to adopt — within an acceptable latency window (target: results within a few seconds on a normal home internet connection; the adaptive-thinking pass is the main cost)
4. Close and reopen the app with all data intact (local-first persistence confirmed)
5. Use the app with the API key stored securely and never visible in logs, renderer console, or network traffic from the renderer process

---

## 6. Key User Flows

### Flow A: Starting a Session

1. Launch Ledger
2. Select active campaign from sidebar (or create new campaign)
3. Create new session (auto-incrementing number, today's date, optional title)
4. Session is now active — quick-add bar is live

### Flow B: Capturing During Play

1. NPC is introduced: press quick-add hotkey, type name "Aldric Vane", select type "NPC", add note "Innkeeper of the Copper Kettle; suspicious of strangers; knows about the north road ambush" — press Enter
2. Quote is dropped: press quick-add hotkey, select type "Event/Quote", type the quote, optionally tag the NPC — press Enter
3. Quest hook appears: quick-add, type quest name, type "Quest", brief note — press Enter
4. All entries are timestamped and linked to the current session automatically

### Flow C: Recall Query Between Sessions

1. Open Recall panel
2. Type "What did Aldric say about the north road?"
3. App embeds query locally, retrieves top-k chunks
4. Claude synthesizes: "In Session 3, Aldric Vane told the party that bandits had been ambushing caravans on the north road for the past month [Note: Session 3 > NPC: Aldric Vane]."
5. User clicks citation to jump to the source note

### Flow D: Suggest During Play

1. Difficult roleplay moment: the party has discovered the mayor is corrupt
2. Open Suggest panel — active PC (e.g. "Seraphina, a paladin of justice with a lawful-good alignment and a personal vendetta against corrupt officials") is shown
3. User types situation: "We just confirmed the mayor is taking bribes from the thieves' guild. The party wants to expose him publicly but Seraphina's order forbids acting without evidence presented to proper authorities."
4. App retrieves: Seraphina's traits/goals, past interactions with the mayor, relevant faction relationships
5. Claude Opus 4.8 returns the 4 attitudes most likely for Seraphina here, each as its own card — e.g. **Moral/Ethical** ("Insist the party gather admissible evidence and present it to the high magistrate before acting"), **Compassionate/Altruistic** ("Protect the townsfolk the corruption is hurting — warn them quietly first"), **Hostile/Aggressive** ("Confront the mayor directly and demand he answer for it"), **Cynical/Skeptical** ("Assume the guild has leverage; find out who else is compromised before trusting anyone")
6. The player reads the 4 options and picks the one that fits the table

---

## 7. Non-Goals (Explicit)

- **Not a character sheet tool.** HP, spell slots, inventory stats — out of scope.
- **Not a VTT (virtual tabletop).** No maps, tokens, dice, or initiative.
- **Not a multi-user tool.** No sharing, collaboration, or cloud sync.
- **Not a general AI assistant.** Claude powers the app's *specific* AI features — Recall, Suggest, Converse, the Journal/Import extraction, and Recap — not an open, free-form chat interface.
- **Not a campaign creator.** Ledger tracks what has happened, not what could happen (no random tables, no generators).
- **Not a web app.** Electron desktop only; no browser hosting.

---

## 8. Assumptions (Stated Explicitly)

1. The developer is always the sole user of a given Ledger installation.
2. A typical campaign will have 20–100 sessions and a few hundred to a few thousand individual notes/entities — not millions of records. This informs the choice to use SQLite and a simple vector store rather than a production-scale database.
3. The developer has a stable Anthropic API key and accepts that Recall synthesis and Suggest require internet connectivity.
4. The developer is willing to run a local embedding model on their Windows 11 machine; CPU-only inference is acceptable given the modest data volume.
5. "Live at the table" means same-room physical play (not online VTT). The app is on a laptop or desktop next to the DM screen.
6. Latency expectation for Suggest: first token within 3 seconds is a target, not a hard SLA. Streaming mitigates perceived latency.
7. The developer wants to approve the tech stack before coding begins — this spec is a proposal, not a mandate.

---

## 9. Open Questions

**Resolved by the developer (2026-06-25):**
- **Quick-add hotkey** → a system-level **global** hotkey is in scope for the MVP; the window architecture accounts for it from Phase 0 (see ARCHITECTURE §3).
- **Entity scope** → entities are **always campaign-scoped** for the MVP; world-level / shared entities are deferred.
- **Color palette**, **vector-store packaging** (native `.dll` accepted), and **model-download UX** (explicit onboarding step) → resolved; see ARCHITECTURE and ROADMAP.
- **Suggest attitude set** → confirmed **7 attitudes** (the "8" was a miscount); Suggest selects **4 of 7**.
- **Window layout** → **single-window with panel switching** (sidebar nav swaps a single main content view; one feature at a time; no persistent AI drawer for the MVP).

**Still open:**
1. **Chunking strategy for notes:** one chunk per note (assumed for MVP) vs. sentence-boundary or fixed-size chunks. Revisit if notes get long.
2. **Embedding performance:** confirm CPU-only `all-MiniLM-L6-v2` inference is acceptable on the developer's machine before committing.

---

## 10. Delivered beyond the MVP

The three MVP pillars shipped, and development continued past v0.1. This section records what now
exists beyond the original scope so the spec reflects reality; design rationale for each new
subsystem lives in the linked ADR (older additions are captured in git history).

**Suggest evolved** past the original 4-attitude model (ADR-016):
- **"What's next" (directions) mode** — open-ended, in-character story-progression ideas grounded
  in the campaign's open quests + the party, alongside the original in-the-moment mode.
- **In-the-moment overhaul** — the 7 fixed attitudes were replaced by a ~62-tag vocabulary
  (disposition tags + the PC's own race/class); each option carries 1 primary + up to 2 secondary
  tags, and the mode now returns **6** options with distinct primary tags.

**Counsel v2** (ADR-026) — the "in the moment" lens now speaks the *game*, not just the fiction: each of the
six options carries a **pillar** (combat/social/exploration), a **mechanic** (the 5e check + ability + what
it's opposed by — no DCs, and no failure outcome since the DM adjudicates failure), and an optional
**teamwork** play naming a present ally; the prompt requires
pillar spread, a **flaw-driven** option, capability-awareness, and scene-stakes calibration, and an optional
**goal** input biases the spread. Backed by a new first-class **`flaws`** entity field (migration 0008) that
feeds the persona, and by **surfacing** previously-invisible data to the AI — entity embeddings now index
`traits`/`goals`/`flaws` + combat/social-salient attributes (a creature's weakness/tactics, a faction's
alignment), so structured data reaches Recall/Suggest, not just the free-text description.

**Converse** (ADR-025; **reshaped questions-only in ADR-034**) — a **third AI lens** beside Recall and
Suggest (surfaced in the UI as Lore · Counsel · Converse; Recall→Lore per ADR-032). You pick a character
to talk **with** (an NPC or fellow PC — never yourself); one structured call returns a **spread of 4–6
tagged, in-character questions** to draw them out — each `{ question, tag, read }` over a 14-tag
taxonomy (open-probe → secret-seeking), funnel-ordered in the UI from trust-building openers to
high-cost probes via static per-tag aim/cost metadata. An optional **thread** steers what to dig into.
It mirrors Suggest's single-shot structured pipeline but grounds by **direct fetch** (the target's
notes — now as-of-clamped — + ties + the asker's persona), so it needs no embedding model and reuses the
Suggest model setting — **no migration, no new settings**. Discovered-only: gaps and rumored/suspected
notes *become* the questions; it never answers them or simulates the target's replies.

**Current scene** (ADR-015; picker relocated to the Suggest pane in ADR-023; **Counsel-only + Time-of-Day dropped in ADR-027**) — a "present moment" (location, party present, the
NPCs/factions being faced, the embarked quest, and a scene *mode*: combat / social / exploration /
stealth / downtime / travel). It is pinned into grounding and steers **Suggest (Counsel) only** — Lore (Recall) is a scene-free out-of-character notes narrator.

**Notes are many-to-many** — a note can be tagged to one OR many entities (via a `note_entity`
join table), authored and managed from a Notes pane inside Capture.

**Session Recap** (ADR-013; **surfaced as "Previously…" in the top-level Sessions view, ADR-032**) —
streams a neutral "Previously on…" of a chosen session, grounded in that session's chronicle entries +
notes, and saves it to the session summary. This supersedes the "automated session summarization" non-goal
listed in §4.

**Paste-and-Extract Import** (ADR-014; extended in ADR-018/023; **now a Transcribe dialog on the
Chronicle header, ADR-036**) — turns pasted text —
session notes, a chat log, another player's write-up — into reviewed, deduped **entities, notes, and
status changes** (tier-1 'capture' extraction, ADR-035), applied in one transaction and **tied to a
session you choose** (the current one, a specific past session, or undated). (Distinct from the
still-deferred campaign *file* export/import in §4 — this is text ingestion, not save-file portability.)

**Two-tier extraction, "Close out session" & "Illuminate"** (ADR-035/036) — the AI note-taker was split
to stop one overloaded call doing five jobs, and extraction became a deliberate ritual. **Chronicle
entries save as plain log lines** (no per-entry AI). **Closing out a session** opens one locked wizard
(exit only by approving or rejecting; hard failures always offer Close) that runs **tier 1** — a single
'capture' extraction over the whole session's log, proposing entities + notes + status changes — then
chains into **tier 2, Illuminate**: ONE focused call per touched entity (full note history + current
profile + live ties) proposing the **relationship ties and profile edits** (traits/goals/flaws/
description/attributes — ADR-028's field changes, now incl. the real description column) the notes
support. The wizard's review is built for volume: bulk tri-state per-section toggles + a compact
density pass. Illuminate also remains a standalone per-session action on the Sessions view (the
surgical re-run); both paths are checklist-gated, applied stamped at the session, and safe to re-run
(the ADR-031 dedup rules make a second pass near-empty). Backstory step 2 keeps the full five-array
extraction (its undated MC-anchored ties have no session for a later pass). The **active-session
selector also moved from the sidebar into the Chronicle header** (its true footprint is capture-only),
and Annals shows a "Filing under Session N" hint.

**Chronology** (ADR-017) — the AI reasons with time. Entity status + relationships are versioned as
an append-only, session-stamped history (lifecycle flag, status trail, relationship validity
intervals); Recall & Suggest can reconstruct the world **"as of session N"** with a hard
no-future-leak clamp, and an inline "Changed over time" disclosure shows each entity's trail.

**Backfill interview** (ADR-018) — **removed in ADR-023.** The roster-then-beats guided flow is gone; the
changeset-v2 engine it introduced (status/relationship extraction with session-stamped apply) lives on in
**Import** (above, now with a target-session setter) and the **Journal**.

**Event entities re-scoped** (ADR-019) — the `event` entity type is now **world-scale history** (a
city destroyed, a ruler assassinated), distinct from the party's session log; the extraction prompts
enforce the boundary so ordinary beats stay notes.

**Creature type, note confidence & campaign lore** (ADR-021) — four modeling additions from
dogfooding a real set of messy player notes: a first-class **`creature`** entity type (tactics /
abilities / weakness, not a social persona); a **`presumed_ended`** lifecycle for a believed-but-
unconfirmed death or loss (the AI hedges instead of asserting it); per-note **confidence**
(`confirmed` / `rumored` / `suspected`) injected into the RAG document title so the model hedges
rumors and the party's own hypotheses; and **entity-less campaign lore** — a note is now a first-class
campaign child (`note.campaignId`) that MAY tag **0..N** entities, so a world-fact owned by no single
entity has a home (surfaced in Recall as a non-clickable "Campaign lore" source).

**Main character & journal-driven capture** (ADR-022) — each campaign persists a **main character**
(`campaign.main_character_id`), a chosen PC that is the durable default lens: opening a campaign seeds
the active PC, so Recall & Suggest run in that character's voice without re-picking (set/cleared via a ★
toggle by the character selector). "Session beats" are re-themed as the **Journal** — a top-level,
default view and the primary at-the-table capture surface: you jot a plain sentence of what happened,
the raw line is kept as your log, and (with an API key) Claude proposes the entities, notes, status
changes, and relationship links it implies, reviewed inline and applied **stamped at the current
session**. It reuses the Import changeset-v2 engine (ADR-014/018) verbatim — which now also proposes
**field changes** to existing entities (ADR-028); manual entity/note editing (in Capture) becomes the
fallback. (A per-character *knowledge horizon* is noted as future work.) *(Per-entry inline extraction
was later replaced by the "Close out session" ritual — ADR-035, above.)*

**Capture & UI refinements** (ADR-023) — a cleanup pass after the Journal landed: **Quick-add** (the
name→type→note bar) is replaced by the full **Add entity** profile form (opened from the entity browser,
and by the global hotkey); Recall's **in-character mode is retired from the UI** (its logic stays in
`recall.service` for later); the **scene picker moved** from the sidebar into the Suggest pane; the
**Backfill** interview was removed (its engine folded into Import, above); and the in-Capture session-log
panel is gone (the Journal is a top-level view).

**Operational hardening** (ADR-020) — the data-safety + resilience layer: rotating pre-migration DB
backups (`VACUUM INTO`, keep 5, in `userData/backups`); a persistent main-process log
(`electron-log` → `userData/logs/main.log`) and logged WAL-checkpoint failures; a startup
migration-failure recovery dialog; a React error boundary + a renderer IPC error-toast audit; and
per-campaign session persistence. Shipped alongside **CI** (GitHub Actions: typecheck + lint + tests
on Windows) and a signed **NSIS installer** (`npm run dist`).

**Grim visual identity** (ADR-024) — the renderer was re-themed from the original cool cyan/slate to a grim
dark-fantasy **"Ash & Ember"** palette (warm charcoal, bone, a dying-ember accent, dried-blood death), with
an evocative-but-clear glossary (the AI is *the Keeper*; Recall / Suggest / Capture / Journal / Import
surface as *Lore / Counsel / Codex / Chronicle / Transcribe*, plus a top-level Sessions view — ADR-032) and a **death motif** that turns the
lifecycle + note-confidence model into the visual language — a Fallen entity's name is struck through with a
blood skull. Labels + tokens only, **no migration**; full as-built reference in `docs/design/theme.md`.

**Changeset field changes** (ADR-028) — Chronicle/Transcribe extraction gained a fourth reviewed change
kind: **add / cut / alter** to an existing entity's **traits, goals, flaws, and per-type attributes** (a
creature's weakness learned, a faction's alignment revealed), each a toggle-able diff row applied in the
same transaction as the batch's other changes. Existing entities only, not chronology-versioned, **no
migration**; the extractor is shown a mentioned entity's current fields so a cut/alter copies the exact item.

**Main character overhaul** (ADR-029) — the main character became the campaign's **mandatory, singular
protagonist and sole in-character lens**: it is created *with* the campaign (the New Campaign dialog and the
onboarding checklist both require a name), the free active-PC switcher is gone (a main-character badge locks
the lens to it and lets you re-designate it), and **backstory + persona + a new Voice Examples field are
main-character-only** (other PCs keep traits/goals/flaws). **Voice Examples** — sample lines the character
speaks (a promoted column, migration 0009) — ground Counsel & Converse by feeding persona generation and a
cached voice block in the in-character prompts. A **derive-from-backstory** AI tool proposes
description/traits/goals/flaws/voice from a written backstory for **per-field approval**. The ADR-024
"Saga" wording is reverted to **Campaign**.

**Character page + unified persona** (ADR-030) — a dedicated **Character** page (first in the navbar) is now
the single home for the main character: set/re-designate it there and manage its full profile (the dashboard
a bespoke two-column dashboard — text fields edit in place, the trait/goal/flaw/voice lists edit via
per-card popup editors, and the AI workflow is front-and-center: **Draft from backstory** (with an info popover) sits on
the backstory card — disabled with a hint when there's no backstory and until you change it after a run —
and runs a **two-step review**: the profile fields, then **world material** (new people/places/factions,
notes, and **standing relationship ties** — the extractor is told whose backstory it is) extracted from
the backstory via the changeset engine and added as undated, **pre-campaign background**). The
sidebar shows a read-only **"Playing as X"** indicator that links to the page, and Codex marks the main
character with a ★ that redirects there. The two persona generators are **collapsed into one canonical
template**: the derive tool proposes only the structured fields, and the persona is (re)built from the full
profile by the single generator — so the same character always gets one consistent brief.

**Changeset dedup hardening** (ADR-031) — every extraction flow (Chronicle / Transcribe / the backstory
Suggest) now dedups against the campaign before review: verbatim-duplicate notes are dropped, reworded
near-duplicates arrive flagged and unchecked ("Possible duplicate"), already-recorded ties and no-op
status/field changes never re-surface — so re-running the same text yields a near-empty changeset instead
of accumulating duplicates. (Resolves the note-dedup follow-up deferred in ADR-018.) AI-suggested statuses
prefer each type's curated presets and snap to their canonical form, adopting the preset's lifecycle — an
imported "Missing" npc correctly reads as *presumed lost*.

**UX consolidation** (ADR-032) — a pass after a full design audit: **Sessions** and **Transcribe** are now
top-level views (Sessions browses sessions + their summaries and hosts the recap; Codex slims to Inscribe +
Annals); **Consult was renamed Lore** and the Character page's derive tool **"Draft from backstory"**; the
assistant speaks as **"the Keeper"** everywhere but Settings; failure messages, empty states, and info
popovers are unified (Counsel gained one); **notes and relationship ties are editable in place**; and a
handful of bugs closed (a global keyboard-shortcut leak, NPC flaws being write-only, the main-character
search detour, a dead-end when a campaign had no session).

**Tie enrichment** (ADR-033) — a relationship now carries **how each side feels** (a short free-text
disposition, *per direction*, so "A is devoted to B while B merely tolerates A" is expressible) and an
**epistemic confidence** (known / rumored / suspected, like notes). The in-character lenses (Counsel,
Converse) read the asymmetric feeling; the Draft/Chronicle/Transcribe extractors propose it (plus the tie's
description) for review; and the Ties list shows it inline and edits it in place. Migration 0010.

Still not built (per §4 / §7): multi-user or sync, mobile companion, VTT / dice / initiative,
character-sheet stats, audio transcription, image/map attachments, and campaign file
export/import. The nearest queued follow-up is an **in-character recap voice**.
