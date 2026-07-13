import {
  Flag,
  MapPin,
  Package,
  PawPrint,
  ScrollText,
  User,
  UserRound,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { EntityType } from '@shared/entity-types'

// Per-entity-type visuals for the Web relationship graph (ADR-040). The color values live in
// globals.css (`--type-*`, the theme source of truth); this maps each type to its CSS var plus a
// lucide glyph, so a node reads by BOTH color and shape. `Record<EntityType, …>` is exhaustive — a
// new entity type won't compile until it is given a color and an icon here.

export const ENTITY_TYPE_COLOR: Record<EntityType, string> = {
  npc: 'var(--type-npc)',
  pc: 'var(--type-pc)',
  location: 'var(--type-location)',
  faction: 'var(--type-faction)',
  quest: 'var(--type-quest)',
  item: 'var(--type-item)',
  event: 'var(--type-event)',
  creature: 'var(--type-creature)'
}

export const ENTITY_TYPE_ICON: Record<EntityType, LucideIcon> = {
  npc: User,
  pc: UserRound,
  location: MapPin,
  faction: Flag,
  quest: ScrollText,
  item: Package,
  event: Zap,
  creature: PawPrint
}
