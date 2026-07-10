# ADR-039: Entity portraits — a base64 thumbnail in a nullable column

## Status

Accepted — **implemented** (ROADMAP P2-2). Every entity gets an optional portrait, shown in the Codex
rows, the entity detail header, the Character sheet, and clipped into the Web graph nodes (ADR-040). The
arc's **first migration, 0011** — a clean one-line `ALTER`. Verified: typecheck + lint + full suite
(image round-trip in `entity.service.test.ts`; export→import carry in `campaign-import.test.ts`).

**Date:** 2026-07-10
**Deciders:** Solo developer

## Context

The audit roadmap asked for an optional portrait per entity — a face on the NPC, a sigil on the faction —
so the cast reads at a glance instead of as a wall of names. The roadmap's original sketch stored the
bytes as a file in a `userData` images directory referenced by path.

## Decision

**Store the image as a base64 data-URL thumbnail in a new nullable `entity.image` TEXT column** — not as
a file on disk. The picker (`entity:pickImage`, `ipc/entity.ts`) opens a native file dialog, then
`nativeImage.createFromPath(path).resize({ width: 512 }).toJPEG(72)` produces a bounded thumbnail encoded
as `data:image/jpeg;base64,…`. `nativeImage` is built into Electron, so **no new dependency**.

Chosen over the files-directory approach deliberately:
- **No file lifecycle.** A column value is created, updated, and deleted with the entity row — no orphaned
  files when an entity is deleted, no dangling path when a file is moved, no `registerFileProtocol` /
  custom scheme to serve local images into the renderer under the CSP.
- **Export/import is free.** The image is just text on the `Entity`, so it rides through
  `buildCampaignExport` → `importCampaign` with zero extra code (the field-by-field values map carries
  `image: e.image`) and survives the round-trip. A file-based scheme would need the exporter to bundle
  bytes and the importer to rehydrate them.
- **Bytes are bounded at the source.** Thumbnailing to 512px JPEG q72 keeps a portrait well under ~50KB,
  so the column (and the export JSON) stays small. Users don't paste multi-MB originals into the DB.

**Not embedded.** `image` is invisible to the RAG pipeline — `embedding-index.ts` `entityText` never
reads it, so setting or changing a portrait does **not** trigger a re-embed. It's presentation only.

**Passthrough mirrors `description` exactly** — `serialize.rowToEntity`, `createEntity`
(`image: input.image ?? null`), `updateEntity` (set only when the patch key is present, so an omitted
`image` is left untouched and it's not a history-affecting field), `Entity` +
`CreateEntityInput`/`UpdateEntityInput`. **Migration 0011** is a nullable ADD, so the SQLite
table-rebuild pattern isn't needed — a single `ALTER TABLE entity ADD image text;` (the `drizzle/0009`
precedent).

**Fallback + render.** A shared `Portrait` component renders the data-URL as a rounded-square `<img>`
(entities include places and things, so a square tile, not a person-circle avatar); with no image it
shows 1–2 initials on a muted tile. Fallen / presumed entities dim (opacity + grayscale), matching the
strike/italic death motif (ADR-024). Set-a-portrait lives in the `EntityForm` (all entities) and, for the
main character, as a click-to-set portrait in the `CharacterDashboard` header via the existing
`savePromoted({ image })` path.

## Consequences

### Positive
- Zero file management, zero new dependency, and export/import "just works" — the image is data on the
  entity like any other field.
- A bounded thumbnail keeps the DB and the export small; no giant blobs.
- No embedding impact — portraits are purely cosmetic and never perturb retrieval.

### Negative / Risks
- Base64 in a TEXT column is ~33% larger than the raw bytes and is read whenever the entity row is read.
  Accepted: thumbnails are small and entity reads aren't hot-path bulk scans.
- Re-picking re-encodes (no de-dup of identical images across entities). Accepted — negligible at
  campaign scale.
- The original resolution is discarded on import (only the 512px thumbnail is kept). Accepted — this is a
  reference face, not a gallery.

## Related Decisions
- ADR-040 (the Web graph clips this portrait into each node). ADR-024 (the fallen/presumed dimming motif
  reused here). ADR-004 (migration discipline — 0011 is the nullable-ADD case, not a table rebuild).

## References
- Schema: `db/schema.ts` (`entity.image`); migration `drizzle/0011_*.sql`.
- Main: `ipc/entity.ts` (`entity:pickImage` + `nativeImage` thumbnail), `services/serialize.ts`,
  `services/entity.service.ts`, `services/import-campaign.service.ts`.
- Renderer: `components/entities/Portrait.tsx`; `EntityForm.tsx`, `CharacterDashboard.tsx`,
  `EntityDetail.tsx`, `EntityBrowser.tsx`.
- Tests: `tests/unit/services/entity.service.test.ts`, `tests/integration/campaign-import.test.ts`.
