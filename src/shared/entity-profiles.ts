import type { EntityType } from './entity-types'

// The per-type "profile": which promoted fields (traits/goals/status) apply, plus the ordered list of
// type-specific fields stored in the entity `attributes` JSON bag. One source of truth for the entity
// editor (EntityForm) and the detail view (EntityDetail). Cross-entity facts (owner, location, members,
// quest giver) are modeled as relationships (see @shared/relations), NOT as profile fields.

export type FieldKind = 'text' | 'textarea' | 'list' | 'select' | 'number'

export interface ProfileField {
  key: string // stable attributes key, e.g. 'ancestry'
  label: string
  kind: FieldKind
  options?: readonly string[] // required when kind === 'select'
  placeholder?: string
}

export interface EntityProfile {
  traits: boolean
  goals: boolean
  status: readonly string[] | null // dropdown presets (custom values allowed); null = no status concept
  fields: readonly ProfileField[] // ordered type-specific fields -> attributes[key]
}

export const ENTITY_PROFILES: Record<EntityType, EntityProfile> = {
  pc: {
    traits: true,
    goals: true,
    status: ['Active', 'Inactive', 'Dead'],
    fields: [
      { key: 'player', label: 'Player', kind: 'text', placeholder: 'Who runs this character?' },
      { key: 'ancestry', label: 'Ancestry', kind: 'text', placeholder: 'e.g. Half-elf' },
      { key: 'class', label: 'Class', kind: 'text', placeholder: 'e.g. Rogue' },
      { key: 'level', label: 'Level', kind: 'number', placeholder: '1' }
    ]
  },
  npc: {
    traits: true,
    goals: true,
    status: ['Alive', 'Dead', 'Missing', 'Unknown'],
    fields: [
      { key: 'race', label: 'Race', kind: 'text', placeholder: 'e.g. Human' },
      { key: 'role', label: 'Role', kind: 'text', placeholder: 'e.g. Innkeeper' }
    ]
  },
  location: {
    traits: false,
    goals: false,
    status: ['Unexplored', 'Explored', 'Safe', 'Hostile', 'Destroyed'],
    fields: [
      {
        key: 'kind',
        label: 'Kind',
        kind: 'select',
        options: ['City', 'Town', 'Village', 'Dungeon', 'Wilderness', 'Building', 'Shop', 'Other']
      },
      { key: 'features', label: 'Features', kind: 'list', placeholder: 'Add a notable feature' },
      { key: 'atmosphere', label: 'Atmosphere', kind: 'text', placeholder: 'e.g. tense, foggy' }
    ]
  },
  faction: {
    traits: false,
    goals: true,
    status: ['Active', 'Disbanded', 'Allied', 'Hostile'],
    fields: [
      { key: 'alignment', label: 'Alignment', kind: 'text', placeholder: 'e.g. Lawful Evil' },
      { key: 'reach', label: 'Reach', kind: 'text', placeholder: 'e.g. regional' }
    ]
  },
  quest: {
    traits: false,
    goals: false,
    status: ['Active', 'Completed', 'Failed', 'On Hold'],
    fields: [
      { key: 'objective', label: 'Objective', kind: 'textarea', placeholder: 'What must be done?' },
      { key: 'reward', label: 'Reward', kind: 'text', placeholder: 'e.g. 500 gp' },
      { key: 'deadline', label: 'Deadline', kind: 'text', placeholder: 'e.g. before the eclipse' }
    ]
  },
  item: {
    traits: false,
    goals: false,
    status: ['Owned', 'Stashed', 'Lost', 'Destroyed'],
    fields: [
      {
        key: 'rarity',
        label: 'Rarity',
        kind: 'select',
        options: ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact']
      },
      { key: 'value', label: 'Value', kind: 'text', placeholder: 'e.g. 1,200 gp' },
      {
        key: 'properties',
        label: 'Properties',
        kind: 'textarea',
        placeholder: 'Magical effects, notes'
      }
    ]
  },
  event: {
    traits: false,
    goals: false,
    status: null,
    fields: [
      { key: 'date', label: 'Date', kind: 'text', placeholder: 'e.g. 14th of Flamerule' },
      { key: 'outcome', label: 'Outcome', kind: 'textarea', placeholder: 'What happened?' },
      { key: 'significance', label: 'Significance', kind: 'text', placeholder: 'Why it matters' }
    ]
  }
}

export function profileFor(type: EntityType): EntityProfile {
  return ENTITY_PROFILES[type]
}

/** The attributes keys owned by a type's profile (everything else is an ad-hoc / legacy attribute). */
export function profileKeys(type: EntityType): Set<string> {
  return new Set(ENTITY_PROFILES[type].fields.map((f) => f.key))
}
