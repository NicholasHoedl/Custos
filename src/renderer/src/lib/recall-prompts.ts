// Prebuilt "madlib" prompt templates for the Lore page (RecallView). A user picks a template, fills its
// typed entity slots, and the assembled sentence is dropped into the Lore query box to review and Ask.
// This module is PURE (type-only shared import, no React/DOM/@renderer) so it is unit-testable under the
// node test runner. Slots are filled with entity DISPLAY NAMES; naming real entities also sharpens Lore's
// hybrid retrieval (dense + fuzzy entity-name match), so these read better than generic questions.

import type { EntityType } from '@shared/entity-types'

/** One blank in a template: a key used by `assemble`, a human label, and the entity types allowed in it
 *  (`null` = any type). The renderer builds a type-constrained entity picker per slot. */
export interface PromptSlot {
  id: string
  label: string
  types: EntityType[] | null
}

/** A prebuilt Lore prompt: menu label, optional one-line description, its ordered slots, and a pure
 *  `assemble` that turns the picked entities' names (keyed by slot id) into the final query string.
 *  A prompt with no slots is a one-click canned question. */
export interface RecallPrompt {
  id: string
  label: string
  description?: string
  slots: PromptSlot[]
  assemble(values: Record<string, string>): string
}

const CHARACTER: EntityType[] = ['npc', 'pc']

/** The Core 7 (ADR-034 follow-up). The two "open threads" prompts re-deliver the retired Converse
 *  briefing value — surfacing what's unresolved/rumored — as an ordinary cited Lore answer. */
export const RECALL_PROMPTS: RecallPrompt[] = [
  {
    id: 'dossier',
    label: 'Dossier',
    description: 'A rundown of one character — who they are and what you know.',
    slots: [{ id: 'character', label: 'Character', types: CHARACTER }],
    assemble: (v) => `Who is ${v.character}, and what do we know about them?`
  },
  {
    id: 'relationship',
    label: 'Relationship',
    description: 'How one character relates to another entity.',
    slots: [
      { id: 'subject', label: 'Character', types: CHARACTER },
      { id: 'other', label: 'Related to', types: null }
    ],
    assemble: (v) => `What is ${v.subject}'s relationship to ${v.other}?`
  },
  {
    id: 'connections',
    label: 'Connections',
    description: 'Everyone and everything tied to one entity.',
    slots: [{ id: 'entity', label: 'Entity', types: null }],
    assemble: (v) => `Who and what is ${v.entity} connected to?`
  },
  {
    id: 'quest-status',
    label: 'Quest status',
    description: 'Where a quest stands and what remains.',
    slots: [{ id: 'quest', label: 'Quest', types: ['quest'] }],
    assemble: (v) => `Where does the quest ${v.quest} stand, and what's left to do?`
  },
  {
    id: 'faction',
    label: 'Faction',
    description: 'What a faction is, who belongs to it, and its aims.',
    slots: [{ id: 'faction', label: 'Faction', types: ['faction'] }],
    assemble: (v) => `What is ${v.faction}, who belongs to it, and what are they after?`
  },
  {
    id: 'open-threads-entity',
    label: 'Open threads',
    description: 'What is still unresolved or only suspected about one entity.',
    slots: [{ id: 'entity', label: 'Entity', types: null }],
    assemble: (v) =>
      `What's still unresolved about ${v.entity} — what's rumored or only suspected, and what should we be asking?`
  },
  {
    id: 'open-threads-campaign',
    label: 'Open threads (campaign)',
    description: 'The biggest unanswered questions across the whole campaign.',
    slots: [],
    assemble: () =>
      `What are the biggest open threads and unanswered questions in the campaign right now?`
  }
]
