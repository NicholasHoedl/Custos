import {
  CATEGORY_LABELS,
  tagLabel,
  type MomentSuggestion,
  type StorySuggestion,
  type SuggestCategory
} from '@shared/suggest-types'
import { converseTagLabel, type ConverseQuestion } from '@shared/converse-types'

// Turn a lens result into plain, readable prose — the payload for Copy-to-clipboard and "Inscribe to
// Annals" (ROADMAP P1-1). The audit's point: a memory tool must let you keep an answer, not just watch
// it scroll away. Inscribe reuses the campaign-lore note (entityIds: [], ADR-021); these serializers
// give it a human-readable body (no tags/enums-as-chips, just the words).

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

/** Lore: the question then the answer. */
export function recallProse(query: string, answer: string): string {
  return `Lore — ${query.trim()}\n\n${answer.trim()}`
}

/** Counsel "in the moment": each option's tag, its action-verb title, and a plain-English explanation. */
export function momentsProse(situation: string, recs: MomentSuggestion[]): string {
  const head = `Counsel — in the moment${situation.trim() ? `: ${situation.trim()}` : ''}`
  const body = recs
    .map((r) => `• [${tagLabel(r.primaryTag)}] ${r.title}\n  ${r.explanation}`)
    .join('\n\n')
  return `${head}\n\n${body}`
}

/** Counsel "what's next": directions grouped by category. */
export function directionsProse(situation: string, sugg: StorySuggestion[]): string {
  const head = `Counsel — what’s next${situation.trim() ? `: ${situation.trim()}` : ''}`
  const cats = [...new Set(sugg.map((s) => s.category))] as SuggestCategory[]
  const body = cats
    .map((cat) => {
      const items = sugg
        .filter((s) => s.category === cat)
        .map((s) => `• ${s.suggestion} — ${s.rationale}`)
        .join('\n')
      return `${CATEGORY_LABELS[cat]}\n${items}`
    })
    .join('\n\n')
  return `${head}\n\n${body}`
}

/** Converse: the target, the optional thread, then each question with its "read". */
export function converseProse(
  targetName: string,
  focus: string | undefined,
  questions: ConverseQuestion[]
): string {
  const head = `Questions for ${targetName}${focus?.trim() ? ` — ${focus.trim()}` : ''}`
  const body = questions
    .map((q) => `• [${converseTagLabel(q.tag)}] ${q.question}\n  (${q.read})`)
    .join('\n\n')
  return `${head}\n\n${body}`
}
