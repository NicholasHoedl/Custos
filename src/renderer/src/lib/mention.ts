import type { Entity, EntityType } from '@shared/entity-types'

// Pure core for the inline entity autocomplete ("quick write"): in a text box, typing `/npc` (or `/loc`,
// `/que`, …) opens a filtered menu of that entity type; picking one drops the entity's plain name in
// place of the token — so you don't leave the composer to look a name up in the Codex. Kept free of React
// and IPC so it unit-tests as plain functions.

/**
 * Slash codes → EntityType. The three-letter abbreviations are the primary trigger
 * (`/npc`, `/loc`, `/que`, `/fac`, `/eve`, `/cre`); `item` and `pc` are already short. Full type names
 * are aliased too, so `/location` works as well as `/loc`.
 */
export const SLASH_TYPES: Record<string, EntityType> = {
  npc: 'npc',
  loc: 'location',
  que: 'quest',
  fac: 'faction',
  item: 'item',
  pc: 'pc',
  eve: 'event',
  cre: 'creature',
  // full type names as aliases
  location: 'location',
  quest: 'quest',
  faction: 'faction',
  event: 'event',
  creature: 'creature'
}

export interface MentionToken {
  /** The scoped entity type, or null for a bare/unknown slash (filter across all types). */
  type: EntityType | null
  /** The name filter after the type code (may contain spaces when a type is set). */
  filter: string
  /** Index of the triggering '/' (inclusive) — the token spans value[start..end]. */
  start: number
  /** The caret index (exclusive end of the token). */
  end: number
}

/**
 * Find the active mention token immediately before the caret, or null if there is none.
 *
 * Scans left from the caret for the nearest '/' at a word boundary (start-of-string or after
 * whitespace) — so `http://x` and `and/or` never trigger. A newline between the caret and a candidate
 * '/' aborts (a mention never spans lines). At a boundary '/':
 *   - if the first whitespace-delimited word after it is a known SLASH_TYPES code, the token is
 *     type-scoped and everything after the code (spaces allowed) is the name filter;
 *   - else, if that word is already followed by a space, it's prose, not a mention → null;
 *   - else it's a bare/unknown slash → an all-types token filtered by the word.
 */
export function parseMentionToken(value: string, caret: number): MentionToken | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === '\n') return null
    if (ch !== '/') continue
    const prev = value[i - 1]
    if (i !== 0 && !/\s/.test(prev)) continue // '/' mid-word (URL, and/or) — not a boundary; keep scanning
    const rest = value.slice(i + 1, caret)
    const firstWord = rest.match(/^\S*/)?.[0] ?? ''
    const key = firstWord.toLowerCase()
    if (Object.prototype.hasOwnProperty.call(SLASH_TYPES, key)) {
      return {
        type: SLASH_TYPES[key],
        filter: rest.slice(firstWord.length).replace(/^\s+/, ''),
        start: i,
        end: caret
      }
    }
    if (/\s/.test(rest)) return null // an unknown word already followed by a space → prose
    return { type: null, filter: rest, start: i, end: caret }
  }
  return null
}

/**
 * Rank campaign entities for a mention token: keep those matching the token's type (if any) and a
 * case-insensitive name substring, ranking name-prefix matches above mid-name matches and sinking
 * ended/presumed-ended threads (without dropping them). Caps the list so the menu stays short. Mirrors
 * CommandPalette's client-side filter — no per-keystroke IPC.
 */
export function rankEntities(entities: Entity[], token: MentionToken, cap = 8): Entity[] {
  const f = token.filter.trim().toLowerCase()
  let pool = token.type ? entities.filter((e) => e.type === token.type) : entities
  if (f) pool = pool.filter((e) => e.name.toLowerCase().includes(f))
  const prefixRank = (e: Entity): number => (f && e.name.toLowerCase().startsWith(f) ? 0 : 1)
  const endedRank = (e: Entity): number =>
    e.lifecycle === 'ended' || e.lifecycle === 'presumed_ended' ? 1 : 0
  return [...pool]
    .sort(
      (a, b) =>
        prefixRank(a) - prefixRank(b) || endedRank(a) - endedRank(b) || a.name.localeCompare(b.name)
    )
    .slice(0, cap)
}
