// Small date/time formatting helpers for the capture surfaces (notes, events).

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
