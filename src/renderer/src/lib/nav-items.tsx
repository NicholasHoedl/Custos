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

export interface NavItem {
  key: ViewKey
  label: string
  icon: LucideIcon
}

// The nine primary views, in nav order (label ↔ code-name per ADR-024/032/036; Web is P2-3). Shared by
// the Sidebar and the command palette (P2-4) so the two never drift on labels or icons. Order follows the
// data lifecycle the first-run tutorial teaches (ADR-044): capture (Chronicle) → process (Sessions) → the
// world (Character/Codex/Web) → the AI lenses (Lore/Counsel/Converse). Chronicle is first (revises ADR-030's
// Character-first — Character stays the MC's home, just not first in nav).
export const NAV_ITEMS: NavItem[] = [
  { key: 'journal', label: 'Chronicle', icon: NotebookPen },
  { key: 'sessions', label: 'Sessions', icon: CalendarClock },
  { key: 'character', label: 'Character', icon: UserRound },
  { key: 'capture', label: 'Codex', icon: ScrollText },
  { key: 'web', label: 'Web', icon: Waypoints },
  { key: 'recall', label: 'Lore', icon: Search },
  { key: 'suggest', label: 'Counsel', icon: Sparkles },
  { key: 'converse', label: 'Converse', icon: MessagesSquare },
  { key: 'settings', label: 'Settings', icon: Settings }
]
