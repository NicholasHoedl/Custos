import {
  sqliteTable,
  text,
  integer,
  blob,
  index,
  uniqueIndex,
  primaryKey
} from 'drizzle-orm/sqlite-core'

// Phase 1: a typed property graph. Entities are nodes; entity_link rows are typed, directed edges.
// Containment hierarchy (located_in/contains, member_of/has_member) is just edges traversed with
// recursive CTEs — no separate tree table (composite-for-hierarchy, ADR-011). Vector tables arrive
// in Phase 2 (P2-03). All entities are campaign-scoped. ids = UUIDs; timestamps = unix-ms integers.
// JSON columns (traits/goals/tags = string[]; attributes = object) are parsed in the service layer.

export const campaign = sqliteTable('campaign', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaign.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title'),
    summary: text('summary'),
    date: text('date'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [uniqueIndex('session_campaign_number_idx').on(t.campaignId, t.number)]
)

export const entity = sqliteTable(
  'entity',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaign.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // EntityType (see @shared/entity-types)
    name: text('name').notNull(),
    description: text('description'),
    traits: text('traits'), // JSON string[] — promoted: Suggest (Phase 3) reads these by name
    goals: text('goals'), // JSON string[] — promoted
    attributes: text('attributes'), // JSON object — open bag of type-specific fields (no migration needed)
    status: text('status'),
    // Chronology (ADR-017): coarse lifecycle the AI trusts for past-vs-present; free-text `status`
    // stays for nuance. This is what history versions. Backfilled from status by heuristic in 0005.
    lifecycle: text('lifecycle').notNull().default('unknown'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [
    index('entity_campaign_type_idx').on(t.campaignId, t.type),
    index('entity_campaign_name_idx').on(t.campaignId, t.name)
  ]
)

// Chronology (ADR-017): append-only trail of an entity's status + lifecycle over time. A baseline row
// per entity (since_session_number NULL = pre-tracking) plus one row per status/lifecycle change,
// stamped with the session NUMBER it happened in (denormalized — no FK; the timeline is
// session.number, assigned once and never renumbered). `stateAsOf` reads the latest row <= N.
export const statusHistory = sqliteTable(
  'status_history',
  {
    id: text('id').primaryKey(),
    entityId: text('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    lifecycle: text('lifecycle').notNull(),
    status: text('status'),
    sinceSessionNumber: integer('since_session_number'), // NULL = pre-tracking baseline
    recordedAt: integer('recorded_at').notNull()
  },
  (t) => [index('status_history_entity_idx').on(t.entityId)]
)

// A note's content + provenance. Its entity association lives entirely in note_entity (M2M) — a note
// has no entity_id column (dropped in 0004); it carries an optional session_id for "when".
export const note = sqliteTable(
  'note',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    tags: text('tags'), // JSON string[]
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('note_session_idx').on(t.sessionId)]
)

// One note ↔ many entities (M2M). After migration 0004 this is the SOLE source of truth for the
// note↔entity association (the note table no longer has an entity_id column). Both FKs cascade:
// deleting a note clears its links; deleting an entity clears its links — and the entity service then
// removes any note left with zero links (orphan cleanup), since a note must always have ≥1 entity.
export const noteEntity = sqliteTable(
  'note_entity',
  {
    noteId: text('note_id')
      .notNull()
      .references(() => note.id, { onDelete: 'cascade' }),
    entityId: text('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.entityId] }),
    // note_id lookups ride the composite PK's leftmost prefix; only entity_id needs its own index.
    index('note_entity_entity_idx').on(t.entityId)
  ]
)

export const entityLink = sqliteTable(
  'entity_link',
  {
    id: text('id').primaryKey(),
    fromEntityId: text('from_entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    toEntityId: text('to_entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    relation: text('relation').notNull(), // forward RelationKey (see @shared/relations)
    description: text('description'), // the "why/when" of the edge — the key RAG-context lever
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaign.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at'), // nullable so ADD COLUMN is clean; the service always sets it
    // Chronology (ADR-017): relationship validity interval, by session NUMBER (denormalized — the
    // timeline is session.number). start_session_number NULL = pre-tracking; end_session_number NULL =
    // still live (an OPEN interval). Severing sets end_session_number; the row is never deleted.
    startSessionNumber: integer('start_session_number'),
    endSessionNumber: integer('end_session_number')
  },
  (t) => [
    index('link_from_idx').on(t.fromEntityId),
    index('link_to_idx').on(t.toEntityId),
    index('link_relation_idx').on(t.relation),
    // Plain index (was `link_unique_idx`). Uniqueness of an OPEN (from,to,relation) interval is
    // enforced by a PARTIAL unique index — `link_open_unique_idx ... WHERE end_session_number IS NULL`
    // — that lives ONLY in migration 0005, because Drizzle's index builder can't express a partial
    // predicate. Keep this PLAIN so `drizzle-kit generate` won't regenerate a full unique index and
    // reintroduce the pre-interval constraint (which would block sever -> reform). See ADR-017.
    index('link_from_to_relation_idx').on(t.fromEntityId, t.toEntityId, t.relation)
  ]
)

export const eventLog = sqliteTable(
  'event_log',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaign.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    entityId: text('entity_id').references(() => entity.id, { onDelete: 'set null' }),
    timestamp: integer('timestamp').notNull()
  },
  (t) => [index('event_session_idx').on(t.sessionId)]
)

// ---- Phase 2 (Recall) ----
// Local embeddings for RAG. One row per note / per entity (name+description). The vector is a float32
// array stored as a BLOB; campaign scope is derived by joining back to entity.campaignId. Brute-force
// cosine over these at MVP scale (ADR-012); sqlite-vec can replace the store later without schema change.

export const noteEmbedding = sqliteTable('note_embedding', {
  noteId: text('note_id')
    .primaryKey()
    .references(() => note.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  dim: integer('dim').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  contentHash: text('content_hash').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const entityEmbedding = sqliteTable('entity_embedding', {
  entityId: text('entity_id')
    .primaryKey()
    .references(() => entity.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  dim: integer('dim').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  contentHash: text('content_hash').notNull(),
  updatedAt: integer('updated_at').notNull()
})

// The LLM-generated, user-editable in-character persona for a PC (the cached Recall prefix body).
export const pcPersona = sqliteTable('pc_persona', {
  entityId: text('entity_id')
    .primaryKey()
    .references(() => entity.id, { onDelete: 'cascade' }),
  brief: text('brief').notNull(),
  edited: integer('edited').notNull().default(0), // 1 once the user hand-edits the brief
  stale: integer('stale').notNull().default(0), // 1 when the PC's source fields changed since generation
  sourceHash: text('source_hash').notNull(),
  model: text('model'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})
