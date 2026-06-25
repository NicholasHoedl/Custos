import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [
    index('entity_campaign_type_idx').on(t.campaignId, t.type),
    index('entity_campaign_name_idx').on(t.campaignId, t.name)
  ]
)

export const note = sqliteTable(
  'note',
  {
    id: text('id').primaryKey(),
    entityId: text('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    tags: text('tags'), // JSON string[]
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('note_entity_idx').on(t.entityId), index('note_session_idx').on(t.sessionId)]
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
    createdAt: integer('created_at') // nullable so ADD COLUMN is clean; the service always sets it
  },
  (t) => [
    index('link_from_idx').on(t.fromEntityId),
    index('link_to_idx').on(t.toEntityId),
    index('link_relation_idx').on(t.relation),
    uniqueIndex('link_unique_idx').on(t.fromEntityId, t.toEntityId, t.relation)
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
