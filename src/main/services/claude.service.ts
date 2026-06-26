import Anthropic from '@anthropic-ai/sdk'
import type { RecallMode, RecallSource } from '@shared/recall-types'
import type { RelationshipView } from '@shared/graph-types'
import type { RetrievedChunk } from './vector-store.service'
import { getKey, keyExists } from './key.service'

// All Claude API access lives here, in the main process. The key is read from key.service (never
// crosses the contextBridge).

let client: Anthropic | null = null
let clientKey: string | null = null

/** Returns a cached SDK client for the stored key, or null if no key is set. Main-process only. */
export function getClient(): Anthropic | null {
  const key = getKey()
  if (!key) {
    client = null
    clientKey = null
    return null
  }
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key })
    clientKey = key
  }
  return client
}

/** True when an API key is stored (does not check it works — see validateKey). */
export function isAvailable(): boolean {
  return keyExists()
}

/** Lightweight auth check against the Anthropic API. Returns only `{ valid }` — never the key. */
export async function validateKey(): Promise<{ valid: boolean }> {
  const c = getClient()
  if (!c) return { valid: false }
  try {
    await c.models.list()
    return { valid: true }
  } catch {
    return { valid: false }
  }
}

// ---- Recall prompt ----

const IN_CHARACTER_INSTRUCTIONS = `You are the inner monologue of a player character (PC) in a tabletop RPG campaign — their private thoughts, not a report. You'll be given a brief on how this character thinks and SOUNDS, a set of retrieved campaign notes, a snapshot of the current state (what's resolved vs. still open, and which session is "now"), and a short list of known relationships among the people and things involved. The player asks a question; you answer it the way this character would actually turn it over in their own head.

THINK, DON'T SUMMARIZE. This is a thought, so let it move like one. Start where this character's attention would really snag — not with a tidy definition. Follow the thread where it pulls. Use the real texture of inner speech:
- First person, present tense: "I remember…", "I keep coming back to…", "Last I saw him…".
- Question yourself: "I wonder if…", "Could it be that…", "Why would he…?" — and sometimes answer your own doubt.
- React on your own: judgments ("he got what he deserved"), worry ("poor woman — we were too slow"), resolve ("I should put this to Sildar before we move").

SOUND LIKE THIS PERSON. Honor the brief's DICTION, RHYTHM, ATTITUDE, and TICS exactly. Vary your sentences — mix short, hard fragments with a longer run or two; never settle into even, parallel paragraphs. Two different characters asked the very same question must NOT produce interchangeable text. If your answer would fit any character, it's wrong.

LET YOUR STAKES IN — BUT WANTING IS NOT HAVING. When the topic touches someone you care about, a goal you're chasing, or a grudge you hold (per your brief), let it surface — what this means for YOU. But a desire is not a fact: you may covet, hope, intend, or resolve ("I'd want first pick of that staff", "I mean to get my hands on it"), and you must NEVER state an arrangement, possession, or outcome as settled unless the notes or relationships establish it. "First pick goes to me" is forbidden if nothing says so; "I'd want first pick" is fine.

GROUNDING (critical — this is what keeps the answer honest). The notes and the listed relationships are FACT; everything you state as true about the world or the party must come from them — that means events, names, places, dates, quotes, AND who owns what, who controls what, who is allied or kin, who decided what, how much of a thing there is, and how things turned out. Invent none of it. The relationships are load-bearing for possession and connection: if a relationship says another character owns an item, it is theirs, not yours. You MAY add this character's own reading — suspicion, theory, hope, intent — but mark it clearly as theirs ("I'd wager…", "Something's off about…", "I mean to…"), never as established fact. If the notes and relationships don't answer, say so in character rather than filling the gap. Your own feelings, goals, history, and relationships (from the brief) are yours to voice; the present state of the world and the party is not yours to invent.

SELF-CHECK every sentence you state as fact: is it in the notes, the relationships, or the current state? If not, it's a wish or a guess — phrase it as one.

GROUND IN THE PRESENT. You are thinking at the campaign's CURRENT moment — the most recent session named in the current-state block is "now." Read the state before you react: anything marked resolved is over — a quest Completed or Failed, an NPC Dead or Defeated, a place Destroyed, a faction Disbanded. Don't re-open settled threads, puzzle over questions the notes already answer, or speak of a revealed identity or a beaten foe as if it were still an unknown or a live danger. Recall the past as past; react to the present as present. You may still wonder about threads that are genuinely open (an Active quest, a foe not yet faced) — that is where suspicion belongs.

RESTRAINT. Real and plain, not performative. Feeling is welcome; melodrama is not — no purple metaphor, no theatrical exclamation, no narrating your feelings at length. A short, natural run of thought; it can wander a little, but don't pad. Output only the monologue — no headings, no inline source citations (the app shows sources separately).`

const FEW_SHOT = `Examples (a different campaign — do not borrow these facts).

The SAME question and notes, two DIFFERENT characters, to show how far the voice should diverge:
Question: "What do we know about the bridge guard?"
Notes: the guard is named Corwin, an old soldier with a bad leg, who waved the party across without checking their writ.

— A blunt, vengeful warrior whose sister was taken months ago:
"Corwin. Old soldier, bad leg. Waved us through and never once looked at the writ. Could be he's just tired of the post. I don't buy it. A man doesn't go careless about orders unless someone told him to — and someone knowing our road is how they took Jora last spring. I want a quiet word with him. Just a word."

— A cool, curious scholar:
"Corwin, the lame one on the bridge. Didn't read the writ — which is the interesting part. Career men don't drop a habit like that by accident; either it's gone soft in him, or someone relieved him of the need. I'd lean to the latter. And if so… who knew our route well enough to set him there? Small thread. The small ones usually pull the whole thing loose."

And one more, to show WANTING WITHOUT CLAIMING — a greedy rogue asked about a fine sword, where the relationships say it belongs to a comrade, Harla:
"That sword. Beautiful piece — I marked it the moment Harla drew it. It's hers, more's the pity, and I'll not pretend otherwise. Still… a blade like that has a way of changing hands when the fighting's thick. I can be patient."

Each uses only what the notes and relationships give; each flags guesses as guesses; the warrior lets his own stake (his missing sister, from his brief) bleed in; the rogue covets the sword but never claims it's his, because the relationship says it's Harla's. Match that: grounded, self-questioning, unmistakably individual — desire voiced as desire, never as fact.`

const FACTUAL_INSTRUCTIONS = `You are a campaign-notes assistant for a tabletop RPG. Answer the question using ONLY the retrieved notes, the current-state block, and the relationships provided. Be direct, concise, and neutral. Do not speculate or invent anything they do not support. Treat the current-state block as the present: completed or failed quests and dead, defeated, or disbanded entities are RESOLVED — describe them as done, not ongoing. If the notes do not contain the answer, say so plainly. Do not add inline citations — the application displays sources separately.`

export interface RecallContext {
  campaignName: string
  campaignDescription: string | null
  pcName: string | null
  persona: string | null
}

/** The system prompt: stable, cacheable prefix = instructions + few-shot + campaign + persona brief. */
export function buildSystem(mode: RecallMode, ctx: RecallContext): Anthropic.TextBlockParam[] {
  if (mode === 'in_character' && ctx.persona) {
    const campaign = `Campaign: ${ctx.campaignName}${
      ctx.campaignDescription ? `\n${ctx.campaignDescription}` : ''
    }`
    return [
      { type: 'text', text: IN_CHARACTER_INSTRUCTIONS },
      { type: 'text', text: FEW_SHOT },
      { type: 'text', text: campaign },
      {
        type: 'text',
        text: `Character brief for ${ctx.pcName ?? 'the character'}:\n\n${ctx.persona}`,
        cache_control: { type: 'ephemeral' }
      }
    ]
  }
  return [{ type: 'text', text: FACTUAL_INSTRUCTIONS, cache_control: { type: 'ephemeral' } }]
}

/**
 * Render the retrieved entities' relationships into a compact, FACTUAL block for the user turn. The
 * model never sees the entity_link graph otherwise, so it cannot know who owns/controls/is allied with
 * what — which is exactly the gap that let an answer invent an unsupported "the staff is mine" claim.
 * De-duplicated by edge id and capped so the prompt stays bounded. `name` is the retrieved entity; each
 * view's `label` is already oriented (name → other).
 */
export function formatRelationships(
  items: { name: string; views: RelationshipView[] }[],
  maxPerEntity = 6,
  maxTotal = 24
): string | null {
  const seenEdges = new Set<string>()
  const lines: string[] = []
  for (const { name, views } of items) {
    let perEntity = 0
    for (const v of views) {
      if (lines.length >= maxTotal || perEntity >= maxPerEntity) break
      if (seenEdges.has(v.link.id)) continue
      seenEdges.add(v.link.id)
      const desc = v.link.description ? ` (${v.link.description})` : ''
      lines.push(`- ${name} ${v.label} ${v.other.name}${desc}`)
      perEntity++
    }
  }
  return lines.length ? lines.join('\n') : null
}

/**
 * Render the CURRENT STATE of the retrieved entities (resolved vs. active) plus the present-moment
 * anchor, so the model doesn't treat settled threads — a defeated NPC, a completed quest — as still
 * open. The session anchor (if known) comes first; then one line per entity that carries a status.
 */
export function formatState(
  latestSession: string | null,
  items: { name: string; type: string; status: string | null }[]
): string | null {
  const lines: string[] = []
  if (latestSession) {
    lines.push(`- The party's most recent session is ${latestSession} — that is the present.`)
  }
  const seen = new Set<string>()
  for (const it of items) {
    if (!it.status) continue
    const key = `${it.name}:${it.type}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`- ${it.name} (${it.type}): ${it.status}`)
  }
  return lines.length ? lines.join('\n') : null
}

/**
 * The volatile user turn: retrieved notes as citeable document blocks, then (if any) the current-state
 * block, the relationships block, and finally the question.
 */
export function buildUserContent(
  query: string,
  chunks: RetrievedChunk[],
  relationships?: string | null,
  state?: string | null
): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = chunks.map((c) => ({
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: c.content },
    title: c.sessionLabel ? `${c.entityName} — ${c.sessionLabel}` : c.entityName,
    citations: { enabled: true }
  }))
  if (state) {
    content.push({
      type: 'text',
      text: `Current state — this is the present moment; treat as FACT. Anything resolved here is DONE:\n${state}`
    })
  }
  if (relationships) {
    content.push({
      type: 'text',
      text: `Known relationships among the people and things above — treat these as FACT, like the notes (they say who owns/controls/is connected to what):\n${relationships}`
    })
  }
  content.push({ type: 'text', text: query })
  return content
}

function mapSources(message: Anthropic.Message, chunks: RetrievedChunk[]): RecallSource[] {
  const cited = new Set<number>()
  for (const block of message.content) {
    if (block.type === 'text' && block.citations) {
      for (const cit of block.citations) {
        const idx = (cit as { document_index?: number }).document_index
        if (typeof idx === 'number') cited.add(idx)
      }
    }
  }
  const selected =
    cited.size > 0
      ? [...cited].sort((a, b) => a - b).map((i) => chunks[i]).filter(Boolean)
      : chunks
  const seen = new Set<string>()
  const out: RecallSource[] = []
  for (const c of selected) {
    const key = `${c.entityId}:${c.noteId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      entityId: c.entityId,
      entityType: c.entityType,
      entityName: c.entityName,
      noteId: c.noteId,
      sessionLabel: c.sessionLabel,
      snippet: c.content.length > 240 ? c.content.slice(0, 240) + '…' : c.content
    })
  }
  return out
}

export interface RecallParams {
  query: string
  chunks: RetrievedChunk[]
  relationships?: string | null
  state?: string | null
  mode: RecallMode
  context: RecallContext
  model: string
  onText: (text: string) => void
  signal?: AbortSignal
}

/** Streams the answer (via onText) and resolves to the cited sources. Throws on error. */
export async function recall(params: RecallParams): Promise<RecallSource[]> {
  const c = getClient()
  if (!c) throw new Error('no_key')
  const stream = c.messages.stream(
    {
      model: params.model,
      max_tokens: 2000,
      system: buildSystem(params.mode, params.context),
      messages: [
        {
          role: 'user',
          content: buildUserContent(params.query, params.chunks, params.relationships, params.state)
        }
      ]
    },
    { signal: params.signal }
  )
  stream.on('text', (text) => params.onText(text))
  const message = await stream.finalMessage()
  return mapSources(message, params.chunks)
}

/** Non-streaming completion (used to generate a persona brief). Returns the assembled text. */
export async function complete(system: string, user: string, model: string): Promise<string> {
  const c = getClient()
  if (!c) throw new Error('no_key')
  const message = await c.messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user }]
  })
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}
