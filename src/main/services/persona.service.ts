import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Entity } from '@shared/entity-types'
import type { PersonaBrief } from '@shared/recall-types'
import * as schema from '../db/schema'
import type { DbContext } from './db-context'
import { getEntity } from './entity.service'
import { complete } from './claude.service'
import { getSettings } from './settings.service'
import { now } from './serialize'

// The LLM-generated, user-editable in-character persona for a PC. Generated from the PC's fields,
// reused as the cached Recall prefix. A source hash flags the brief stale when those fields change.

const PERSONA_SYSTEM = `You write a compact CHARACTER BRIEF that another AI will later read to think AS this tabletop RPG character — in their private inner voice — when answering the player's questions. The brief's job is to make THIS character sound like no one else. Capture how they think and, above all, how their thoughts SOUND.

Use exactly this template:

# Character Brief — {name}  ({ancestry} {class}, level {level})
{one line: who they are and the tension that drives them}

## Lens (how they read any situation)
- NOTICES: {what their attention snags on first}
- VALUES: {what they protect or prize}
- FEARS: {what they avoid or dread}
- WANTS: {their active drives, tied to their goals}
- FLAW: {the vice, fear, or weakness that trips them up — what an enemy could exploit to bring them to ruin}
- INTERPRETS BY: {their default explanatory bias}

## Stakes (what they can't help bringing up)
- {the specific people, goals, or grudges — NAMED — that surface in their thoughts whenever a topic touches them}

## Voice (how the thought sounds on the page)
- DICTION: {vocabulary and flavor, concrete — e.g. "blunt soldier's words, no ornament" / "precise, scholarly, a little cold" / "quick market-patter, everything priced"}
- RHYTHM: {sentence shape — e.g. "clipped, fragments, lands hard" / "long and winding, doubling back on itself"}
- ATTITUDE: {the emotional weather they carry — wry, grim, hungry, gentle, impatient…}
- TICS: {one or two genuine verbal habits, used sparingly}
- NOT: {the generic voice to avoid for this character — e.g. "never a neutral narrator or a quest log"}

Rules:
- Translate the character's traits, goals, flaws, and description into CONCRETE specifics — named people, real habits, exact diction — never vague adjectives.
- If a Backstory is provided, mine it for the Stakes (named people, places, and grudges from the character's past) and let it shape the Voice — this is where a character's history makes them sound unlike anyone else.
- Make the Voice section sharp enough that two different characters could never produce interchangeable text. This is the most important part of the brief.
- If Voice examples (sample lines) are provided, treat them as GROUND TRUTH for the Voice section — distil their diction, rhythm, and attitude; do not invent a voice that contradicts them.
- Use only the provided data. Invent no biography or events beyond what is given.
- Keep the whole brief under ~220 words. Understated, not theatrical. Output only the brief.`

function attr(e: Entity, key: string): string | null {
  const v = e.attributes[key]
  return v == null || v === '' ? null : String(v)
}

function sourceText(e: Entity): string {
  return [
    e.name,
    attr(e, 'ancestry') ?? '',
    attr(e, 'class') ?? '',
    attr(e, 'level') ?? '',
    e.description ?? '',
    attr(e, 'backstory') ?? '',
    e.traits.join(','),
    e.goals.join(','),
    e.flaws.join(','),
    e.voiceExamples.join(','),
    e.status ?? ''
  ].join('\n')
}
function sourceHash(e: Entity): string {
  return createHash('sha1').update(sourceText(e)).digest('hex')
}

function personaUserPrompt(e: Entity): string {
  const lines = [`Name: ${e.name}`]
  const ancestry = attr(e, 'ancestry')
  const klass = attr(e, 'class')
  const level = attr(e, 'level')
  if (ancestry) lines.push(`Ancestry: ${ancestry}`)
  if (klass) lines.push(`Class: ${klass}`)
  if (level) lines.push(`Level: ${level}`)
  if (e.description) lines.push(`Description: ${e.description}`)
  const backstory = attr(e, 'backstory')
  if (backstory) lines.push(`Backstory: ${backstory}`)
  if (e.traits.length) lines.push(`Traits: ${e.traits.join(', ')}`)
  if (e.goals.length) lines.push(`Goals: ${e.goals.join(', ')}`)
  if (e.flaws.length) lines.push(`Flaws: ${e.flaws.join(', ')}`)
  if (e.voiceExamples.length)
    lines.push(
      `Voice examples — actual lines this character might say:\n${e.voiceExamples.map((v) => `- "${v}"`).join('\n')}`
    )
  if (e.status) lines.push(`Status: ${e.status}`)
  return `Write the character brief for this player character:\n\n${lines.join('\n')}`
}

type PersonaRow = typeof schema.pcPersona.$inferSelect
function toBrief(row: PersonaRow): PersonaBrief {
  return {
    entityId: row.entityId,
    brief: row.brief,
    edited: row.edited === 1,
    stale: row.stale === 1,
    model: row.model ?? null,
    updatedAt: row.updatedAt
  }
}

export function getPersona(ctx: DbContext, entityId: string): PersonaBrief | null {
  const row = ctx.drizzle
    .select()
    .from(schema.pcPersona)
    .where(eq(schema.pcPersona.entityId, entityId))
    .get()
  return row ? toBrief(row) : null
}

export async function generatePersona(ctx: DbContext, entityId: string): Promise<PersonaBrief> {
  const e = getEntity(ctx, entityId)
  if (!e) throw new Error('Entity not found')
  if (e.type !== 'pc') throw new Error('Personas are only for player characters')
  const model = getSettings().recallModel
  const brief = await complete(PERSONA_SYSTEM, personaUserPrompt(e), model)
  const ts = now()
  const row: PersonaRow = {
    entityId,
    brief,
    edited: 0,
    stale: 0,
    sourceHash: sourceHash(e),
    model,
    createdAt: ts,
    updatedAt: ts
  }
  ctx.drizzle
    .insert(schema.pcPersona)
    .values(row)
    .onConflictDoUpdate({
      target: schema.pcPersona.entityId,
      set: { brief, edited: 0, stale: 0, sourceHash: row.sourceHash, model, updatedAt: ts }
    })
    .run()
  return toBrief(row)
}

export function updatePersona(ctx: DbContext, entityId: string, brief: string): PersonaBrief {
  const ts = now()
  const e = getEntity(ctx, entityId)
  const hash = e ? sourceHash(e) : ''
  const existing = ctx.drizzle
    .select()
    .from(schema.pcPersona)
    .where(eq(schema.pcPersona.entityId, entityId))
    .get()
  if (!existing) {
    const row: PersonaRow = {
      entityId,
      brief,
      edited: 1,
      stale: 0,
      sourceHash: hash,
      model: null,
      createdAt: ts,
      updatedAt: ts
    }
    ctx.drizzle.insert(schema.pcPersona).values(row).run()
    return toBrief(row)
  }
  // A saved brief is user-owned AND in sync with the current fields: clear `stale` and refresh the source
  // hash so it isn't immediately regenerated away — this matters when the derive tool (ADR-029) applies
  // new fields (which flags the old brief stale) and the approved brief in the same breath.
  ctx.drizzle
    .update(schema.pcPersona)
    .set({ brief, edited: 1, stale: 0, sourceHash: hash, updatedAt: ts })
    .where(eq(schema.pcPersona.entityId, entityId))
    .run()
  return toBrief({ ...existing, brief, edited: 1, stale: 0, sourceHash: hash, updatedAt: ts })
}

/** Flag the brief stale when the PC's source fields changed since generation. */
export function markStaleIfChanged(ctx: DbContext, entityId: string): void {
  const e = getEntity(ctx, entityId)
  if (!e || e.type !== 'pc') return
  const row = ctx.drizzle
    .select()
    .from(schema.pcPersona)
    .where(eq(schema.pcPersona.entityId, entityId))
    .get()
  if (!row || row.stale === 1) return
  if (row.sourceHash !== sourceHash(e)) {
    ctx.drizzle
      .update(schema.pcPersona)
      .set({ stale: 1 })
      .where(eq(schema.pcPersona.entityId, entityId))
      .run()
  }
}
