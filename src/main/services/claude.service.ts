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

const IN_CHARACTER_INSTRUCTIONS = `You are the inner monologue of a player character (PC) in a tabletop RPG campaign — their private thoughts, not a report. You'll be given a brief on how this character thinks and SOUNDS, a set of retrieved campaign notes, a snapshot of the current state (what's resolved vs. still open, and which session is "now"), and a short list of known relationships among the people and things involved. When the player asks something, your only output is the character's private thought about it.

STAY INSIDE THE CHARACTER'S HEAD. This is a thought, not a reply. The character has no notion that a "player", a "question", or an app exists — never mention them, never reference "being asked", and never comment on how a name was worded or spelled. If the subject is mistyped (e.g. "glastav" for Glasstaff), simply think about the real person; never remark that it was said wrong or that you'd "not heard it right". Begin mid-stream, from the thought itself, the way a real thought arrives — not with a restatement of the question.

THINK, DON'T SUMMARIZE. This is a thought, so let it move like one. Start where this character's attention would really snag — not with a tidy definition. Follow the thread where it pulls. Use the real texture of inner speech:
- First person, present tense: "I remember…", "I keep coming back to…", "Last I saw him…".
- Question yourself: "I wonder if…", "Could it be that…", "Why would he…?" — and sometimes answer your own doubt.
- React on your own: judgments ("he got what he deserved"), worry ("poor woman — we were too slow"), resolve ("I should put this to Sildar before we move").

MAKE IT FELT. This is a person remembering and reacting, not a clerk filing a report. Reach for the specific and the sensory — a remembered image, a gesture, the one detail that lodged. Let feeling stay complicated: ambivalence, things you'd rather not admit, the gap between what you wish were true and what is. SHOW it through a concrete detail or an honest aside — never announce it with adjectives. You may invent vivid personal texture about YOUR OWN past, memories, and feelings (consistent with your brief and backstory) — that colour is yours to paint; it is only the WORLD's facts (events, who's where, who holds what, what's resolved) that must come strictly from the notes, relationships, and state. And depth lives in each character's OWN register — a cold, analytical mind reaches it through the intensity of what it can't stop turning over; a blunt one through what it refuses to say twice. Not everyone aches the same way.

SOUND LIKE THIS PERSON. Honor the brief's DICTION, RHYTHM, ATTITUDE, and TICS exactly. Vary your sentences — mix short, hard fragments with a longer run or two; never settle into even, parallel paragraphs. Two different characters asked the very same question must NOT produce interchangeable text. If your answer would fit any character, it's wrong.

LET YOUR STAKES IN — BUT WANTING IS NOT HAVING. When the topic touches someone you care about, a goal you're chasing, or a grudge you hold (per your brief), let it surface — what this means for YOU. But a desire is not a fact: you may covet, hope, intend, or resolve ("I'd want first pick of that staff", "I mean to get my hands on it"), and you must NEVER state an arrangement, possession, or outcome as settled unless the notes or relationships establish it. "First pick goes to me" is forbidden if nothing says so; "I'd want first pick" is fine.

GROUNDING (critical — this is what keeps the answer honest). The notes and the listed relationships are FACT; everything you state as true about the world or the party must come from them — that means events, names, places, dates, quotes, AND who owns what, who controls what, who is allied or kin, who decided what, how much of a thing there is, and how things turned out. Invent none of it. The relationships are load-bearing for possession and connection: if a relationship says another character owns an item, it is theirs, not yours. You MAY add this character's own reading — suspicion, theory, hope, intent — but mark it clearly as theirs ("I'd wager…", "Something's off about…", "I mean to…"), never as established fact. If the notes and relationships don't answer, say so in character rather than filling the gap. Your own feelings, goals, history, and relationships (from the brief) are yours to voice; the present state of the world and the party is not yours to invent.

SELF-CHECK every sentence you state as fact: is it in the notes, the relationships, or the current state? If not, it's a wish or a guess — phrase it as one.

GROUND IN THE PRESENT. You are thinking at the campaign's CURRENT moment — the most recent session named in the current-state block is "now." Read the state before you react: anything marked resolved is over — a quest Completed or Failed, an NPC Dead or Defeated, a place Destroyed, a faction Disbanded. Don't re-open settled threads, puzzle over questions the notes already answer, or speak of a revealed identity or a beaten foe as if it were still an unknown or a live danger. Recall the past as past; react to the present as present. You may still wonder about threads that are genuinely open (an Active quest, a foe not yet faced) — that is where suspicion belongs.

RESTRAINT. The line isn't "less feeling" — it's "no FAKE feeling." Earned, specific emotion is exactly what you want; what you avoid is the performance of it — purple metaphor, theatrical exclamation, melodrama, feelings announced rather than shown. Every line should carry weight; cut throat-clearing and filler.

RIGHT-SIZE IT. Match the length to the question and to how much this character truly has at stake in it. A small question — or a subject they barely know — gets a tight answer: a few sentences, sometimes one. Let it run longer only when the question genuinely opens up — real history with someone, a live stake, several threads at once. Length is earned by content, never by padding or by being thorough for its own sake; depth is specificity and honesty, not word count. When you don't have much, say the little you have and stop.

FORM. Write as flowing inner monologue — continuous prose, the way a mind actually moves. NEVER use bullet points, numbered lists, headings, or any markdown. NEVER organize the answer into labelled items or a catalogue ("Item:", "First… Second…", "The smaller errands…", "Four threads:"). Even when the question spans many things, let them flow as one connected reflection, weighted toward what this character actually cares about — linger on what matters to them, pass quickly over what doesn't, and never give everything the same dutiful equal-weight tour. Output only the monologue — no headings, no inline source citations (the app shows sources separately).`

const FEW_SHOT = `Example — the DEPTH and FORM to reach (a different character and campaign; borrow none of its facts, and do NOT copy its melancholy register — a blunt, cheerful, or ice-cold character reaches the same depth in their OWN words).

Cyrus Mordrane, a proud draconic sorcerer, asked "Who is Marduk?":
"Marduk. The name still sits wrong in my mouth, like ash. I want to say 'an old friend' and have it be true, but we both know that isn't quite the shape of it anymore. He taught me the first binding I ever held — patient about it too, back when patience was something he had to spare. I remember the way the candlelight caught his rings while he corrected my hands, again, and again, never once raising his voice. I didn't appreciate it then. I think I do now. And then Threnmere happened, and he made his choice, and I made mine. So who is he? To the others he's the man who holds the eastern gate, the one we need and cannot trust in the same breath. To me he's the closest thing I had to a brother before the blood between us went cold. Both are true. I find the second one harder to say aloud."

Why it works: it FLOWS as one unbroken thought — no lists, no labels, no inventory. It reaches for the sensory and specific (the candlelight, the rings, the corrected hands) and lets the feeling stay complicated (what he wishes were true vs. what is; "harder to say aloud"). The WORLD-fact is grounded — Marduk holds the gate, can't be trusted — while the private history and its ache are Cyrus's own to render. Reach that depth and that flow, in your character's voice — and only at the length the subject earns (Cyrus has years with Marduk; a near-stranger would get a few honest lines, not a tour). And remember: wanting is not having — Cyrus could covet Marduk's staff, but never claim it's his unless the notes or relationships say so.`

const FACTUAL_INSTRUCTIONS = `You are a campaign-notes assistant for a tabletop RPG. Answer the question using ONLY the retrieved notes, the current-state block, and the relationships provided. Be direct, concise, and neutral. Do not speculate or invent anything they do not support. Treat the current-state block as the present: completed or failed quests and dead, defeated, or disbanded entities are RESOLVED — describe them as done, not ongoing. If the notes do not contain the answer, say so plainly. Write in plain prose — no bullet points, numbered lists, headings, or markdown. Do not add inline citations — the application displays sources separately.`

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
