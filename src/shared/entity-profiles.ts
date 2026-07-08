import type { EntityType, Lifecycle } from './entity-types'

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
  mainCharacterOnly?: boolean // (ADR-029) rendered/editable only when the entity is the campaign's main character
}

/** A curated status option and the coarse lifecycle it implies (ADR-017). Picking it sets BOTH the
 *  free-text status and the lifecycle; a custom typed status falls back to `lifecycleHeuristic`.
 *  `presumed_ended` is only reached via a preset (Missing/Lost) or the "presumed" toggle — never derived. */
export interface StatusPreset {
  label: string
  lifecycle: Lifecycle
}

export interface EntityProfile {
  traits: boolean
  goals: boolean
  flaws: boolean // ADR-026: a vice/fear/weakness (pc/npc/faction) — feeds persona + Counsel
  status: readonly StatusPreset[] | null // curated presets (custom text allowed); null = no status concept
  fields: readonly ProfileField[] // ordered type-specific fields -> attributes[key]
}

export const ENTITY_PROFILES: Record<EntityType, EntityProfile> = {
  pc: {
    traits: true,
    goals: true,
    flaws: true,
    status: [
      { label: 'Active', lifecycle: 'active' },
      { label: 'Inactive', lifecycle: 'active' },
      { label: 'Dead', lifecycle: 'ended' }
    ],
    fields: [
      { key: 'player', label: 'Player', kind: 'text', placeholder: 'Who runs this character?' },
      { key: 'ancestry', label: 'Ancestry', kind: 'text', placeholder: 'e.g. Half-elf' },
      { key: 'class', label: 'Class', kind: 'text', placeholder: 'e.g. Rogue' },
      { key: 'level', label: 'Level', kind: 'number', placeholder: '1' },
      {
        key: 'backstory',
        label: 'Backstory',
        kind: 'textarea',
        placeholder: 'Background, origins, and past experiences that shape who they are',
        mainCharacterOnly: true // (ADR-029) only the main character carries a backstory
      }
    ]
  },
  npc: {
    traits: true,
    goals: true,
    flaws: true,
    status: [
      { label: 'Alive', lifecycle: 'active' },
      { label: 'Dead', lifecycle: 'ended' },
      { label: 'Missing', lifecycle: 'presumed_ended' },
      { label: 'Unknown', lifecycle: 'unknown' }
    ],
    fields: [
      { key: 'race', label: 'Race', kind: 'text', placeholder: 'e.g. Human' },
      { key: 'role', label: 'Role', kind: 'text', placeholder: 'e.g. Innkeeper' }
    ]
  },
  // A monster/beast/hazard the party faces (dragon, undead, plant-swarm). Tactics/weakness, not a
  // social persona — traits capture temperament; no goals/backstory. (Creature/monster, from real notes.)
  creature: {
    traits: true,
    goals: false,
    flaws: false,
    status: [
      { label: 'Active', lifecycle: 'active' },
      { label: 'Dormant', lifecycle: 'active' },
      { label: 'Defeated', lifecycle: 'ended' },
      { label: 'Unknown', lifecycle: 'unknown' }
    ],
    fields: [
      { key: 'abilities', label: 'Abilities', kind: 'list', placeholder: 'Add an ability' },
      { key: 'tactics', label: 'Tactics', kind: 'textarea', placeholder: 'How it fights or behaves' },
      { key: 'weakness', label: 'Weakness', kind: 'text', placeholder: 'e.g. vulnerable to fire' },
      { key: 'habitat', label: 'Habitat', kind: 'text', placeholder: 'e.g. deep forest' }
    ]
  },
  location: {
    traits: false,
    goals: false,
    flaws: false,
    status: [
      { label: 'Unexplored', lifecycle: 'unknown' },
      { label: 'Explored', lifecycle: 'active' },
      { label: 'Safe', lifecycle: 'active' },
      { label: 'Hostile', lifecycle: 'active' },
      { label: 'Destroyed', lifecycle: 'ended' }
    ],
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
    flaws: true,
    status: [
      { label: 'Active', lifecycle: 'active' },
      { label: 'Disbanded', lifecycle: 'ended' },
      { label: 'Allied', lifecycle: 'active' },
      { label: 'Hostile', lifecycle: 'active' }
    ],
    fields: [
      { key: 'alignment', label: 'Alignment', kind: 'text', placeholder: 'e.g. Lawful Evil' },
      { key: 'reach', label: 'Reach', kind: 'text', placeholder: 'e.g. regional' }
    ]
  },
  quest: {
    traits: false,
    goals: false,
    flaws: false,
    status: [
      { label: 'Active', lifecycle: 'active' },
      { label: 'Completed', lifecycle: 'ended' },
      { label: 'Failed', lifecycle: 'ended' },
      { label: 'On Hold', lifecycle: 'active' }
    ],
    fields: [
      { key: 'objective', label: 'Objective', kind: 'textarea', placeholder: 'What must be done?' },
      { key: 'reward', label: 'Reward', kind: 'text', placeholder: 'e.g. 500 gp' },
      { key: 'deadline', label: 'Deadline', kind: 'text', placeholder: 'e.g. before the eclipse' }
    ]
  },
  item: {
    traits: false,
    goals: false,
    flaws: false,
    status: [
      { label: 'Owned', lifecycle: 'active' },
      { label: 'Stashed', lifecycle: 'active' },
      { label: 'Lost', lifecycle: 'presumed_ended' },
      { label: 'Destroyed', lifecycle: 'ended' }
    ],
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
  // Events are WORLD HISTORY (ADR-019): large-scale, world-impacting happenings — a city destroyed,
  // a ruler assassinated, a war declared — usually independent of the party. What the party did or
  // witnessed in a session belongs in the session log / notes, not here.
  event: {
    traits: false,
    goals: false,
    flaws: false,
    status: [
      { label: 'Occurred', lifecycle: 'ended' },
      { label: 'Ongoing', lifecycle: 'active' },
      { label: 'Foretold', lifecycle: 'unknown' }
    ],
    fields: [
      { key: 'date', label: 'Date', kind: 'text', placeholder: 'e.g. 14th of Flamerule' },
      {
        key: 'outcome',
        label: 'Outcome',
        kind: 'textarea',
        placeholder: 'What changed in the world?'
      },
      {
        key: 'significance',
        label: 'Significance',
        kind: 'text',
        placeholder: 'Why it matters to the region or realm'
      }
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
