// ONE voice for the Keeper's failure states (ADR-032). Every AI surface renders these reasons through
// this map instead of hand-rolling copy — the audit found seven divergent implementations ("add one in
// Settings" vs "set a valid one", "Claude" vs "the AI", and four lenses missing bad_key entirely).
// Surfaces with genuinely different semantics (Lore's retrieval-only degrade, Chronicle's saved-anyway)
// COMPOSE with these strings rather than replacing them.

/** Superset of every AI feature's failure reasons. */
export type AiFailureReason =
  | 'no_key'
  | 'bad_key'
  | 'offline'
  | 'no_model'
  | 'no_pc'
  | 'invalid'
  | 'empty'
  | 'too_long'
  | 'no_backstory'
  | 'api'
  | 'unknown'

export function reasonCopy(reason: string): string {
  switch (reason as AiFailureReason) {
    case 'no_key':
      return 'No API key — add one in Settings.'
    case 'bad_key':
      return 'Your API key was rejected — update it in Settings.'
    case 'offline':
      return 'You’re offline — the Keeper needs an internet connection.'
    case 'no_model':
      return 'The local search model isn’t downloaded yet — get it in Settings.'
    case 'no_pc':
      return 'Set a main character first — the Character page is their home.'
    case 'invalid':
      return 'The Keeper returned nothing usable — try again.'
    case 'empty':
      return 'Nothing usable was found in that text.'
    case 'too_long':
      return 'That text is too long for one pass — split it and try again.'
    case 'no_backstory':
      return 'Add a backstory to this character first — drafting derives everything from it.'
    default:
      return 'Something went wrong reaching the Keeper. Try again in a moment.'
  }
}
