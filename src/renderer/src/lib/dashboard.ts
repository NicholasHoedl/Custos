import {
  ENTITY_TYPES,
  type Entity,
  type EntityType,
  type Note,
  type Session
} from '@shared/entity-types'

// Pure selectors behind the Home dashboard (ADR-061) — mirrors lib/mention.ts / lib/graph-reduce.ts:
// plain records in, plain data out, unit-tested without the DOM or IPC (tests/unit/renderer/dashboard).

/** Open threads: active quests, most recently touched first. */
export function activeQuests(entities: Entity[], cap = 5): Entity[] {
  return entities
    .filter((e) => e.type === 'quest' && e.lifecycle === 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, cap)
}

/** Open threads: notes still carrying epistemic doubt (rumored/suspected), newest first. */
export function unresolvedRumors(notes: Note[], cap = 3): Note[] {
  return notes
    .filter((n) => n.confidence !== 'confirmed')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, cap)
}

/** Memory at a glance: entity counts per type, canonical ENTITY_TYPES order, zero-count types omitted. */
export function typeCounts(entities: Entity[]): { type: EntityType; count: number }[] {
  const counts = new Map<EntityType, number>()
  for (const e of entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return ENTITY_TYPES.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => ({
    type: t,
    count: counts.get(t) ?? 0
  }))
}

/** The most recently edited entities (any type), newest first. */
export function recentlyTouched(entities: Entity[], cap = 6): Entity[] {
  return [...entities].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, cap)
}

/** The newest session by number (input order not assumed). */
export function latestSession(sessions: Session[]): Session | null {
  return sessions.reduce<Session | null>((a, b) => (a && a.number >= b.number ? a : b), null)
}

/** Before session 1 (ADR-063): a campaign with no sessions yet needs its first one started. The caller
 *  guards on the sessions-loading flag so it doesn't flash before the initial list resolves. */
export function needsFirstSession(sessions: Session[]): boolean {
  return sessions.length === 0
}

/** "today" / "yesterday" / "N days ago" for the hero's last-played line. */
export function relativeDays(ts: number, now: number): string {
  const days = Math.floor(Math.max(0, now - ts) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export type ArchiveSpotlight =
  | { kind: 'dormant'; entity: Entity; lastNoteAt: number }
  | { kind: 'rumor'; note: Note }

/**
 * "From the archives…": one dormant thread worth revisiting — an ACTIVE entity whose newest note is the
 * oldest among candidates ("whatever happened to…"), or an old unresolved rumor. `seed` (a day number at
 * the call site) keeps the pick stable across renders while rotating it day to day. Null while the
 * record is too young to have archives.
 */
export function archiveSpotlight(
  entities: Entity[],
  notes: Note[],
  seed: number
): ArchiveSpotlight | null {
  const newestNote = new Map<string, number>()
  for (const n of notes)
    for (const id of n.entityIds) {
      const prev = newestNote.get(id)
      if (prev === undefined || n.createdAt > prev) newestNote.set(id, n.createdAt)
    }
  const dormant: ArchiveSpotlight[] = entities
    .filter((e) => e.lifecycle === 'active' && newestNote.has(e.id))
    .map((e) => ({ kind: 'dormant' as const, entity: e, lastNoteAt: newestNote.get(e.id) ?? 0 }))
    .sort((a, b) => a.lastNoteAt - b.lastNoteAt)
    .slice(0, 5)
  const rumors: ArchiveSpotlight[] = notes
    .filter((n) => n.confidence !== 'confirmed')
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, 5)
    .map((n) => ({ kind: 'rumor' as const, note: n }))
  const pool = [...dormant, ...rumors]
  if (pool.length === 0) return null
  return pool[Math.abs(seed) % pool.length]
}
