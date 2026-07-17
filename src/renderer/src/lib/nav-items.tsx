import {
  CalendarClock,
  Home,
  MessagesSquare,
  NotebookPen,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import type { ViewKey } from '@renderer/store/ui-store'

export type NavGroup = 'home' | 'capture' | 'world' | 'ask' | 'settings'

export interface NavItem {
  key: ViewKey
  label: string
  icon: LucideIcon
  group: NavGroup
}

// Section headings for the grouped sidebar nav. Settings has no heading — it's set off by a divider —
// and Home (the single top item) emits no marker at all (the Sidebar skips its group).
export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  home: '',
  capture: 'Capture',
  world: 'World',
  ask: 'Ask',
  settings: ''
}

// The primary views, in nav order (label ↔ code-name per ADR-024/032/036; Web is P2-3, Continuity is
// ADR-056). Shared by the Sidebar and the command palette (P2-4) so the two never drift on labels or icons.
// Home (the dashboard, ADR-061) is first and the default landing view — revising ADR-044's
// Chronicle-first; after it, order follows the data lifecycle the first-run tutorial teaches: capture
// (Chronicle) → process (Sessions) → the world (Character/Codex/Web) → the AI lenses
// (Lore/Counsel/Converse/Continuity).
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', icon: Home, group: 'home' },
  { key: 'journal', label: 'Chronicle', icon: NotebookPen, group: 'capture' },
  { key: 'sessions', label: 'Sessions', icon: CalendarClock, group: 'capture' },
  { key: 'character', label: 'Character', icon: UserRound, group: 'world' },
  { key: 'capture', label: 'Codex', icon: ScrollText, group: 'world' },
  { key: 'web', label: 'Web', icon: Waypoints, group: 'world' },
  { key: 'recall', label: 'Lore', icon: Search, group: 'ask' },
  { key: 'suggest', label: 'Counsel', icon: Sparkles, group: 'ask' },
  { key: 'converse', label: 'Converse', icon: MessagesSquare, group: 'ask' },
  { key: 'continuity', label: 'Continuity', icon: ShieldCheck, group: 'ask' },
  { key: 'settings', label: 'Settings', icon: Settings, group: 'settings' }
]
