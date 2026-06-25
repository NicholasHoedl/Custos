import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// Phase 0: relational tables only. Vector tables (NoteEmbedding/EventEmbedding)
// arrive in Phase 2 (P2-03). All entities are campaign-scoped (ADR + SPEC §9).
// ids are app-generated UUIDs (crypto.randomUUID); timestamps are unix-ms integers;
// JSON-array columns (traits/goals/tags) are stored as text and parsed in the service layer.

export const campaign = sqliteTable('campaign', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaign.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  title: text('title'),
  summary: text('summary'),
  date: text('date'),
  createdAt: integer('created_at').notNull()
})

export const entity = sqliteTable('entity', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaign.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // EntityType (see @shared/entity-types)
  name: text('name').notNull(),
  description: text('description'),
  traits: text('traits'), // JSON string[] — used heavily for PCs in Suggest (Phase 3)
  goals: text('goals'), // JSON string[]
  status: text('status'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const note = sqliteTable('note', {
  id: text('id').primaryKey(),
  entityId: text('entity_id')
    .notNull()
    .references(() => entity.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  tags: text('tags'), // JSON string[]
  createdAt: integer('created_at').notNull()
})

export const entityLink = sqliteTable('entity_link', {
  id: text('id').primaryKey(),
  fromEntityId: text('from_entity_id')
    .notNull()
    .references(() => entity.id, { onDelete: 'cascade' }),
  toEntityId: text('to_entity_id')
    .notNull()
    .references(() => entity.id, { onDelete: 'cascade' }),
  relation: text('relation').notNull(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaign.id, { onDelete: 'cascade' })
})

export const eventLog = sqliteTable('event_log', {
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
})
