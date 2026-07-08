// Small date/time formatting helpers for the capture surfaces (notes, events).

import type { ApplyResult } from '@shared/import-types'

export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Tiny pluralizer for result summaries: plural(2, 'note', 'notes') → 'notes'. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** One line summarizing an applied changeset ("2 new · 1 linked · 3 changes · 4 notes"). */
export function applySummary(r: ApplyResult): string {
  const parts = [
    r.createdEntityIds.length > 0 && `${r.createdEntityIds.length} new`,
    r.linkedEntityIds.length > 0 && `${r.linkedEntityIds.length} linked`,
    r.statusChangesApplied + r.relationshipChangesApplied + r.fieldChangesApplied > 0 &&
      `${r.statusChangesApplied + r.relationshipChangesApplied + r.fieldChangesApplied} changes`,
    r.createdNoteIds.length > 0 && `${r.createdNoteIds.length} notes`
  ].filter(Boolean) as string[]
  return parts.length > 0 ? parts.join(' · ') : 'No new changes'
}
