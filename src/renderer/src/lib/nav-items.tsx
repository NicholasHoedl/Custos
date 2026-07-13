import {
  CalendarClock,
  MessagesSquare,
  NotebookPen,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import type { ViewKey } from '@renderer/store/ui-store'

export type NavGroup = 'capture' | 'world' | 'ask' | 'settings'

export interface NavItem {
  key: ViewKey
  label: string
  icon: LucideIcon
  group: NavGroup
}

// Section headings for the grouped sidebar nav. Settings has no heading — it's set off by a divider.
export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  capture: 'Capture',
  world: 'World',
  ask: 'Ask',
  settings: ''
}

// The nine primary views, in nav order (label ↔ code-name per ADR-024/032/036; Web is P2-3). Shared by
// the Sidebar and the command palette (P2-4) so the two never drift on labels or icons. Order follows the
// data lifecycle the first-run tutorial teaches (ADR-044): capture (Chronicle) → process (Sessions) → the
// world (Character/Codex/Web) → the AI lenses (Lore/Counsel/Converse). Chronicle is first (revises ADR-030's
// Character-first — Character stays the MC's home, just not first in nav).
export const NAV_ITEMS: NavItem[] = [
  { key: 'journal', label: 'Chronicle', icon: NotebookPen, group: 'capture' },
  { key: 'sessions', label: 'Sessions', icon: CalendarClock, group: 'capture' },
  { key: 'character', label: 'Character', icon: UserRound, group: 'world' },
  { key: 'capture', label: 'Codex', icon: ScrollText, group: 'world' },
  { key: 'web', label: 'Web', icon: Waypoints, group: 'world' },
  { key: 'recall', label: 'Lore', icon: Search, group: 'ask' },
  { key: 'suggest', label: 'Counsel', icon: Sparkles, group: 'ask' },
  { key: 'converse', label: 'Converse', icon: MessagesSquare, group: 'ask' },
  { key: 'settings', label: 'Settings', icon: Settings, group: 'settings' }
]
