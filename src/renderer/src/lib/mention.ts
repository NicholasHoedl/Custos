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
    // Not a category code → an all-types free-text search token; spaces allowed so multi-word names
    // (`/sildar hal`) match. A stray '/' in prose only opens the menu if it actually matches an entity.
    return { type: null, filter: rest, start: i, end: caret }
  }
  return null
}

/** Scores how well a query matches an entity name (0 = no match, higher = better). Injected so this
 *  module stays dependency-free + node-testable — the app passes cmdk's fuzzy `defaultFilter`. */
export type MentionScorer = (name: string, query: string) => number

// Default matcher: prefix > contains > none. Self-contained fallback; the real app injects cmdk's fuzzy
// scorer (subsequence/typo tolerant, consistent with the command palette) — see MentionTextarea.
const substringScore: MentionScorer = (name, query) => {
  const n = name.toLowerCase()
  const q = query.toLowerCase()
  return n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0
}

/**
 * Rank campaign entities for a mention token: keep those of the token's type (if any) whose name scores
 * against the filter, best score first, sinking ended/presumed-ended threads (without dropping them) and
 * breaking ties alphabetically. Caps the list so the menu stays short; an empty filter (bare `/`) lists all.
 * `opts.score` defaults to a substring matcher — the app injects cmdk fuzzy for the real menu.
 */
export function rankEntities(
  entities: Entity[],
  token: MentionToken,
  opts: { cap?: number; score?: MentionScorer } = {}
): Entity[] {
  const { cap = 8, score = substringScore } = opts
  const typed = token.type ? entities.filter((e) => e.type === token.type) : entities
  const endedRank = (e: Entity): number =>
    e.lifecycle === 'ended' || e.lifecycle === 'presumed_ended' ? 1 : 0
  const f = token.filter.trim()
  if (!f) {
    return [...typed]
      .sort((a, b) => endedRank(a) - endedRank(b) || a.name.localeCompare(b.name))
      .slice(0, cap)
  }
  return typed
    .map((e) => ({ e, s: score(e.name, f) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || endedRank(a.e) - endedRank(b.e) || a.e.name.localeCompare(b.e.name))
    .slice(0, cap)
    .map((x) => x.e)
}
