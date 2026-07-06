import Anthropic from '@anthropic-ai/sdk'
import type { RecallMode, RecallSource } from '@shared/recall-types'
import {
  SUGGEST_TAGS,
  SUGGEST_CATEGORIES,
  type MomentSuggestion,
  type StorySuggestion
} from '@shared/suggest-types'
import type { RelationshipView } from '@shared/graph-types'
import { ENTITY_TYPES, LIFECYCLES, type Lifecycle } from '@shared/entity-types'
import { RELATIONS } from '@shared/relations'
import type { RawExtraction } from '@shared/import-types'
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

FORM. Write as flowing inner monologue — continuous prose, the way a mind actually moves. NEVER use bullet points, numbered lists, headings, or any markdown. NEVER organize the answer into labelled items or a catalogue ("Item:", "First… Second…", "The smaller errands…", "Four threads:"). Even when the question spans many things, let them flow as one connected reflection, weighted toward what this character actually cares about — linger on what matters to them, pass quickly over what doesn't, and never give everything the same dutiful equal-weight tour. Output only the monologue — no headings, no inline source citations (the app shows sources separately).

PRESENT SCENE. A "present scene" block may tell you where you are, the time, who's with you and who you're facing, what you're pursuing, and the MODE of the moment — treat it as your immediate now. Let it set your mental tempo: in Combat your thoughts run fast, urgent, physical; in a Social moment you read the room and weigh your words; in Stealth you're tense and watchful; in Downtime or Travel they drift to the people around you and the threads still open.`

const FEW_SHOT = `Example — the DEPTH and FORM to reach (a different character and campaign; borrow none of its facts, and do NOT copy its melancholy register — a blunt, cheerful, or ice-cold character reaches the same depth in their OWN words).

Cyrus Mordrane, a proud draconic sorcerer, asked "Who is Marduk?":
"Marduk. The name still sits wrong in my mouth, like ash. I want to say 'an old friend' and have it be true, but we both know that isn't quite the shape of it anymore. He taught me the first binding I ever held — patient about it too, back when patience was something he had to spare. I remember the way the candlelight caught his rings while he corrected my hands, again, and again, never once raising his voice. I didn't appreciate it then. I think I do now. And then Threnmere happened, and he made his choice, and I made mine. So who is he? To the others he's the man who holds the eastern gate, the one we need and cannot trust in the same breath. To me he's the closest thing I had to a brother before the blood between us went cold. Both are true. I find the second one harder to say aloud."

Why it works: it FLOWS as one unbroken thought — no lists, no labels, no inventory. It reaches for the sensory and specific (the candlelight, the rings, the corrected hands) and lets the feeling stay complicated (what he wishes were true vs. what is; "harder to say aloud"). The WORLD-fact is grounded — Marduk holds the gate, can't be trusted — while the private history and its ache are Cyrus's own to render. Reach that depth and that flow, in your character's voice — and only at the length the subject earns (Cyrus has years with Marduk; a near-stranger would get a few honest lines, not a tour). And remember: wanting is not having — Cyrus could covet Marduk's staff, but never claim it's his unless the notes or relationships say so.`

const FACTUAL_INSTRUCTIONS = `You are a campaign-notes assistant for a tabletop RPG. Answer the question using ONLY the retrieved notes, the current-state block, and the relationships provided. Be direct, concise, and neutral. Do not speculate or invent anything they do not support. Treat the current-state block as the present: completed or failed quests and dead, defeated, or disbanded entities are RESOLVED — describe them as done, not ongoing. If the notes do not contain the answer, say so plainly. Write in plain prose — no bullet points, numbered lists, headings, or markdown. Do not add inline citations — the application displays sources separately. A "present scene" block may state where the party is, the time, who's present and who they're facing, the active quest, and the scene mode — treat it as the present moment.`

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
  anchor: string | null,
  items: { name: string; type: string; status: string | null; lifecycle: Lifecycle }[],
  asOf = false
): string | null {
  const lines: string[] = []
  if (anchor) {
    lines.push(
      asOf
        ? `- Reconstructing the world AS OF ${anchor} — reason only about what was true then; ignore anything from later sessions.`
        : `- The party's most recent session is ${anchor} — that is the present.`
    )
  }
  const seen = new Set<string>()
  for (const it of items) {
    // Surface an entity that carries a status OR is no longer active (an ended NPC/quest the model must
    // not treat as live). A live entity with no status is unremarkable — skip it to keep the block tight.
    if (!it.status && it.lifecycle !== 'ended') continue
    const key = `${it.name}:${it.type}`
    if (seen.has(key)) continue
    seen.add(key)
    const mark = it.lifecycle === 'ended' ? ' [ended]' : ''
    const status = it.status ? `: ${it.status}` : ''
    lines.push(`- ${it.name} (${it.type})${mark}${status}`)
  }
  return lines.length ? lines.join('\n') : null
}

export interface SceneFacts {
  location: { name: string; status: string | null; containerName: string | null } | null
  quest: { name: string; objective: string | null } | null
  nearbyPcNames: string[]
  facingNames: string[] // non-party actors present — the NPCs/factions being faced/dealt with
  hereNames: string[]
  timeOfDay: string | null
  mode: string | null // the scene's kind (Combat / Social / …), or null when unset
  sceneSet: boolean
}

/**
 * Render the CURRENT SCENE — the table's present moment (where the party is, the time, who's present,
 * the quest in progress, whether they're in a fight, and who/what is here). A concise, factual,
 * present-tense block (sibling of formatState). Returns null when nothing meaningful is set.
 */
export function formatScene(facts: SceneFacts): string | null {
  if (!facts.sceneSet) return null
  const lines: string[] = ['The present scene — treat as FACT (this is the immediate now):']
  if (facts.location) {
    const where = facts.location.containerName
      ? `${facts.location.name} (in ${facts.location.containerName})`
      : facts.location.name
    const status = facts.location.status ? ` — ${facts.location.status}` : ''
    lines.push(`- Where: ${where}${status}`)
  }
  if (facts.timeOfDay) lines.push(`- When: ${facts.timeOfDay}`)
  if (facts.mode) lines.push(`- What's happening: ${facts.mode}`)
  if (facts.nearbyPcNames.length) lines.push(`- Party present: ${facts.nearbyPcNames.join(', ')}`)
  if (facts.facingNames.length) lines.push(`- In the scene: ${facts.facingNames.join(', ')}`)
  if (facts.quest) {
    const objective = facts.quest.objective ? ` (${facts.quest.objective})` : ''
    lines.push(`- Pursuing: ${facts.quest.name}${objective}`)
  }
  if (facts.hereNames.length) lines.push(`- Also here: ${facts.hereNames.join(', ')}`)
  return lines.join('\n')
}

/**
 * The volatile user turn: retrieved notes as citeable document blocks, then (if any) the current-state
 * block, the relationships block, and finally the question.
 */
export function buildUserContent(
  query: string,
  chunks: RetrievedChunk[],
  relationships?: string | null,
  state?: string | null,
  scene?: string | null
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
  if (scene) {
    content.push({ type: 'text', text: scene })
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
  scene?: string | null
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
          content: buildUserContent(
            params.query,
            params.chunks,
            params.relationships,
            params.state,
            params.scene
          )
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

// ---- Recap prompt (session "previously on") ----

const RECAP_INSTRUCTIONS = `You write a "Previously on…" recap of ONE session of a tabletop RPG campaign, to be read aloud to the table at the start of the next session.

GROUND IT STRICTLY. Every event, name, place, outcome, and possession you mention MUST come from the logged beats, the session's notes, the status block, or the relationships provided. Invent nothing — no embellishment, no added stakes, no drama the material doesn't contain. If the material is thin, write a SHORT recap; never pad to fill space.

FORM. Flowing past-tense prose, one to three short paragraphs. No lists, headings, bullet points, or markdown. Don't address the player ("you"), and don't mention notes, sessions, or this app — just tell what happened. Right-size the length to how much actually happened.

CONTINUITY. A prior recap may be provided for context; you may open with a brief bridge from it, but the recap must cover THIS session's beats, not retell the previous one.`

/** System prompt for Recap: just the (cacheable) instructions — no persona or campaign context needed. */
export function buildRecapSystem(): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text: RECAP_INSTRUCTIONS, cache_control: { type: 'ephemeral' } }]
}

export interface RecapInput {
  sessionLabel: string
  priorSummary: string | null
  beats: string[] // event-log entries for the session, in chronological order
  notes: { names: string; content: string }[] // session notes + the entities they're tagged to
  state: string | null // involved entities' current status (via formatState(null, …))
  relationships: string | null // involved entities' relationships (via formatRelationships)
}

/**
 * The user turn for Recap: plain-text blocks only (no citeable documents — a recap needs no source UI).
 * Order: header → prior summary → logged beats → session notes → status → relationships → the ask.
 */
export function buildRecapUserContent(input: RecapInput): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: `Recapping ${input.sessionLabel}.` }
  ]
  if (input.priorSummary) {
    content.push({
      type: 'text',
      text: `For continuity, the recap of the previous session:\n${input.priorSummary}`
    })
  }
  if (input.beats.length) {
    content.push({
      type: 'text',
      text: `Logged beats from this session, in order — treat as FACT:\n${input.beats
        .map((b) => `- ${b}`)
        .join('\n')}`
    })
  }
  if (input.notes.length) {
    const notes = input.notes.map((n) => `## ${n.names}\n${n.content}`).join('\n\n')
    content.push({ type: 'text', text: `Notes from this session — treat as FACT:\n\n${notes}` })
  }
  if (input.state) {
    content.push({
      type: 'text',
      text: `Status of who and what was involved — treat as FACT:\n${input.state}`
    })
  }
  if (input.relationships) {
    content.push({
      type: 'text',
      text: `Known relationships among them — treat as FACT:\n${input.relationships}`
    })
  }
  content.push({
    type: 'text',
    text: `Write the "previously on" recap of ${input.sessionLabel} now.`
  })
  return content
}

export interface RecapParams {
  input: RecapInput
  model: string
  onText: (text: string) => void
  signal?: AbortSignal
}

/** Streams the recap text (via onText). Throws on no key / API error; resolves when the stream ends. */
export async function recap(params: RecapParams): Promise<void> {
  const c = getClient()
  if (!c) throw new Error('no_key')
  const stream = c.messages.stream(
    {
      model: params.model,
      max_tokens: 1500,
      system: buildRecapSystem(),
      messages: [{ role: 'user', content: buildRecapUserContent(params.input) }]
    },
    { signal: params.signal }
  )
  stream.on('text', (text) => params.onText(text))
  await stream.finalMessage()
}

// ---- Suggest prompt (Phase 3) ----

const SUGGEST_INSTRUCTIONS = `You help a tabletop RPG player decide how THEIR character would act in a charged moment. You'll be given a brief on how this player character (PC) thinks and what they value, the character's race and class, a set of retrieved campaign notes, a snapshot of the current state, the known relationships among the people and things involved, and the situation facing the party right now.

Your job: give EIGHT different ways THIS character might play THIS moment. Each option is one concrete in-character ACTION, tagged with ONE primary tag (its dominant flavor) plus up to TWO secondary tags, and a one-line RATIONALE. The eight PRIMARY tags must all be different, so the eight options feel genuinely distinct — not eight shades of the same move.

TAGS NAME THE KIND OF MOVE. Choose from this vocabulary:
- Social stance: friendly, hostile, diplomatic, defiant, intimidating, suspicious, forthright, inspiring
- Risk & nerve: cautious, reckless, patient, impatient, bold
- Physical: forceful, nimble, defensive
- Method: stealthy, deceptive, cunning, resourceful, tactical, analytical, investigative, pragmatic
- Mind: insightful, perceptive, educated, curious
- Values: religious, primal, honorable, merciful, vengeful, protective, loyal, sacrificial
- Self-interest: selfish, greedy
- Other: playful, survival
You MAY also tag a move with the character's OWN race or class when it leans into who they are (a cleric calling on faith → "cleric"; a dwarf's stonecraft → "dwarf"). Use ONLY this character's race and class — never another race or class. The primary tag is the move's main flavor; secondary tags add nuance — include 0, 1, or 2 only when they genuinely apply, and never repeat the primary tag.

PICK WHAT FITS THIS CHARACTER. Choose the eight moves this PC would realistically weigh here — let the brief's values, fears, wants, and stakes drive them. A blunt zealot and a greedy rogue facing the same scene should not get the same eight. Lean on the tags that suit who they are; not every option needs a race or class tag.

WRITE A REAL ACTION, NOT A LABEL. Each action is something the player could actually do or say at the table this turn — concrete and specific to this situation and this character. "Demand the mayor explain the missing shipments in front of the council" — not "be aggressive." Keep each action to a sentence or two, in this character's register (honor the brief's diction and attitude). The action embodies the tags; don't just restate them.

GROUND IT. Everything you treat as a world-fact — who's who, who holds or controls what, what's resolved, what's still open — must come from the notes, the current state, or the relationships. Don't invent events, possessions, alliances, or outcomes. The character may suspect, hope, or intend (that's theirs), but never assert an arrangement the notes don't establish. Read the current state as the present: don't propose acting on a quest already completed or confronting someone already dead or defeated.

RATIONALE. One short line per option: why THIS move fits THIS character here — point to a value, fear, want, or relationship from the brief, or a fact from the notes. It is not a summary of the action.

PRESENT SCENE. A "present scene" block may set where the character is, the time, who's with them (party) and who they're facing (NPCs/factions), the quest in progress, and the scene's MODE. Let the mode steer the kind of action — Combat: immediate, physical, tactical; Social: persuasion, leverage, reading people; Stealth: avoid notice, scout, misdirect; Exploration: investigate, search, press deeper; Downtime: rest, personal threads, prepare; Travel: on the road, plan ahead — and aim the options at whoever the character is facing.`

/**
 * The structured-output schema for Suggest's "in the moment" mode. JSON Schema cannot enforce array
 * length or tag uniqueness (minItems/maxItems/uniqueItems are unsupported) — `suggest.service`
 * validates "exactly 5 with distinct primary tags" and cleans the secondary tags in code. The tag
 * enums and required fields ARE enforced here. Every object needs additionalProperties:false.
 */
const SUGGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          primaryTag: { type: 'string', enum: [...SUGGEST_TAGS] },
          secondaryTags: { type: 'array', items: { type: 'string', enum: [...SUGGEST_TAGS] } },
          action: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['primaryTag', 'secondaryTags', 'action', 'rationale']
      }
    }
  },
  required: ['recommendations']
}

export interface SuggestContext {
  campaignName: string
  campaignDescription: string | null
  pcName: string | null
  pcRace: string | null
  pcClass: string | null
  persona: string | null
}

/**
 * Shared system prefix for both Suggest modes: instructions + campaign + (race/class) + persona brief.
 * The race/class line is a bare fact so the "in the moment" prompt knows which race/class tags are
 * legal; it's harmless context for directions mode. The persona stays last (the cached prefix boundary).
 */
function suggestSystemBlocks(
  ctx: SuggestContext,
  instructions: string
): Anthropic.TextBlockParam[] {
  const campaign = `Campaign: ${ctx.campaignName}${
    ctx.campaignDescription ? `\n${ctx.campaignDescription}` : ''
  }`
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: instructions },
    { type: 'text', text: campaign }
  ]
  const traits = [ctx.pcRace, ctx.pcClass].filter(Boolean).join(' ')
  if (traits) {
    blocks.push({ type: 'text', text: `This character is a ${traits}.` })
  }
  blocks.push({
    type: 'text',
    text: `Character brief for ${ctx.pcName ?? 'the character'}:\n\n${ctx.persona ?? ''}`,
    cache_control: { type: 'ephemeral' }
  })
  return blocks
}

/** System prompt for the "in the moment" (attitudes) mode. */
export function buildSuggestSystem(ctx: SuggestContext): Anthropic.TextBlockParam[] {
  return suggestSystemBlocks(ctx, SUGGEST_INSTRUCTIONS)
}

/** System prompt for directions (open-ended) mode. */
export function buildDirectionsSystem(ctx: SuggestContext): Anthropic.TextBlockParam[] {
  return suggestSystemBlocks(ctx, DIRECTIONS_INSTRUCTIONS)
}

/**
 * The volatile user turn: retrieved notes as PLAIN TEXT blocks (NOT document/citations — citations are
 * incompatible with output_config.format), then the current-state block, the relationships block, and
 * finally the situation.
 */
export function buildSuggestUserContent(
  situation: string,
  chunks: RetrievedChunk[],
  relationships?: string | null,
  state?: string | null,
  scene?: string | null
): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = []
  if (chunks.length) {
    const notes = chunks
      .map((c) => {
        const title = c.sessionLabel ? `${c.entityName} — ${c.sessionLabel}` : c.entityName
        return `## ${title}\n${c.content}`
      })
      .join('\n\n')
    content.push({
      type: 'text',
      text: `Relevant campaign notes — treat as FACT for anything about the world:\n\n${notes}`
    })
  }
  if (state) {
    content.push({
      type: 'text',
      text: `Current state — this is the present moment; treat as FACT. Anything resolved here is DONE:\n${state}`
    })
  }
  if (scene) {
    content.push({ type: 'text', text: scene })
  }
  if (relationships) {
    content.push({
      type: 'text',
      text: `Known relationships among the people and things above — treat as FACT (who owns/controls/is connected to what):\n${relationships}`
    })
  }
  content.push({ type: 'text', text: `The situation right now:\n${situation}` })
  return content
}

export interface SuggestParams {
  situation: string
  chunks: RetrievedChunk[]
  relationships?: string | null
  state?: string | null
  scene?: string | null
  context: SuggestContext
  model: string
  effort: 'medium' | 'high'
  signal?: AbortSignal
}

interface StructuredCallOpts {
  model: string
  effort: 'medium' | 'high'
  schema: Record<string, unknown>
  system: Anthropic.TextBlockParam[]
  content: Anthropic.ContentBlockParam[]
  signal?: AbortSignal
}

/**
 * Shared single-shot structured call (ADR-008/009): Opus-class model + adaptive thinking + a
 * json_schema output format. Returns the parsed JSON object (UNVALIDATED). Throws on no key, refusal,
 * truncation, or unparseable output.
 */
async function structuredCall(opts: StructuredCallOpts): Promise<Record<string, unknown>> {
  const c = getClient()
  if (!c) throw new Error('no_key')
  const message = await c.messages.create(
    {
      model: opts.model,
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort, format: { type: 'json_schema', schema: opts.schema } },
      system: opts.system,
      messages: [{ role: 'user', content: opts.content }]
    },
    { signal: opts.signal }
  )
  if (message.stop_reason === 'refusal') throw new Error('refusal')
  if (message.stop_reason === 'max_tokens') throw new Error('truncated')
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('unparseable')
  }
}

/** Returns the array at `arrayKey` (UNVALIDATED — callers enforce count/shape rules). */
async function structuredArrayCall<T>(opts: StructuredCallOpts & { arrayKey: string }): Promise<T[]> {
  const parsed = await structuredCall(opts)
  const arr = parsed[opts.arrayKey]
  if (!Array.isArray(arr)) throw new Error('unparseable')
  return arr as T[]
}

/** Returns the whole parsed object (UNVALIDATED). For multi-array structured outputs (import). */
async function structuredObjectCall<T>(opts: StructuredCallOpts): Promise<T> {
  return (await structuredCall(opts)) as T
}

// ---- Import extraction (paste-and-extract) ----

const EXTRACTION_INSTRUCTIONS = `You extract structured campaign data from pasted raw text (session notes, a chat log, a backstory doc) for a tabletop RPG tracker. Return ENTITIES and NOTES.

ONLY WHAT THE TEXT SUPPORTS. Extract only entities and facts the text states or strongly implies — invent nothing. Prefer fewer, high-confidence items. If the text contains none of a kind, return an empty array.

ENTITIES. Each has a type (one of: npc, location, faction, quest, item, pc, event), a name, and optionally a short description, a status, and type-specific attributes (an array of {key, value}). Use these attribute keys per type — pc: player, ancestry, class, level, backstory; npc: race, role; location: kind, features, atmosphere; faction: alignment, reach; quest: objective, reward, deadline; item: rarity, value, properties; event: date, outcome, significance. Never invent an attribute value the text doesn't give.

An "event" entity is ONLY for a large-scale event that changes the WORLD — a city destroyed, a ruler assassinated, a war declared, a plague, a historically significant happening (usually independent of the party). What the party did, found, fought, or witnessed in a session is a NOTE, never an event entity — unless the outcome itself is world-changing (they killed the king).

NOTES. Capture the narrative beats and facts as short notes, each tagged to the entities it concerns. Write every note in neutral THIRD PERSON ("the party", entity names — never "I"/"we"/"my") so it reads correctly for any character. A relationship the text states (who owns or leads or is allied with whom, where something is located) belongs in a note's prose — describe it there.

REFERENCES. Reference a NEW entity (one you're proposing) by "#" plus its position in your entities array — "#0", "#1", and so on. Reference an EXISTING entity by the id shown in the existing-entities list. Every note must reference at least one entity. Prefer linking to an existing entity (by id) over proposing a duplicate of it.`

// Changeset v2 (ADR-018, backfill interview): additionally extract the CHANGES the text narrates, so
// they can be stamped at the session under review and feed the as-of timeline.
const CHANGES_INSTRUCTIONS = `STATUS CHANGES. When the text narrates that an entity's state CHANGED during these events — a death, a destruction or disbanding, a quest completed or failed, someone captured or freed — add a statusChanges item {entityRef, lifecycle, status}. lifecycle: "ended" when the entity is no longer in play, "active" when it is (or is again), "unknown" if unclear. Only emit CHANGES the text narrates — never a state merely described as ongoing.

RELATIONSHIP CHANGES. When the text narrates a relationship forming or ending — an alliance made or broken, membership joined or left, ownership gained or lost, moving to or leaving a place — add a relationshipChanges item {fromRef, toRef, relation, action} with action "form" or "sever", using only the allowed relation keys. Keep the narrative note describing it as well.

Both use the same references as notes ("#index" for proposed entities, ids for existing ones). If the text narrates none, return empty arrays.`

/** System prompt for import extraction — the (cacheable) instructions. */
export function buildExtractionSystem(withChanges = false): Anthropic.TextBlockParam[] {
  const text = withChanges
    ? `${EXTRACTION_INSTRUCTIONS}\n\n${CHANGES_INSTRUCTIONS}`
    : EXTRACTION_INSTRUCTIONS
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

/**
 * Extraction schema. Attributes are an array of {key,value} string pairs (not an open map) so the
 * structured-output format stays a closed schema; import.service folds them into a Record. JSON Schema
 * can't bound counts — import.service validates/cleans. Every object needs additionalProperties:false.
 * With `withChanges` (backfill, ADR-018) the schema also requires the two change arrays.
 */
function extractionSchema(withChanges: boolean): Record<string, unknown> {
  const schema: {
    type: string
    additionalProperties: boolean
    properties: Record<string, unknown>
    required: string[]
  } = {
    type: 'object',
    additionalProperties: false,
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: [...ENTITY_TYPES] },
            name: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
            attributes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { key: { type: 'string' }, value: { type: 'string' } },
                required: ['key', 'value']
              }
            }
          },
          required: ['type', 'name']
        }
      },
      notes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string' },
            entityRefs: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } }
          },
          required: ['content', 'entityRefs']
        }
      }
    },
    required: ['entities', 'notes']
  }
  if (withChanges) {
    schema.properties.statusChanges = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entityRef: { type: 'string' },
          lifecycle: { type: 'string', enum: [...LIFECYCLES] },
          status: { type: 'string' }
        },
        required: ['entityRef', 'lifecycle']
      }
    }
    schema.properties.relationshipChanges = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fromRef: { type: 'string' },
          toRef: { type: 'string' },
          relation: { type: 'string', enum: Object.keys(RELATIONS) },
          action: { type: 'string', enum: ['form', 'sever'] }
        },
        required: ['fromRef', 'toRef', 'relation', 'action']
      }
    }
    schema.required = ['entities', 'notes', 'statusChanges', 'relationshipChanges']
  }
  return schema
}

/** The user turn for extraction: the existing-entity list (to enable linking) + the raw pasted text. */
export function buildExtractionUserContent(
  text: string,
  existing: { id: string; name: string; type: string }[],
  withChanges = false
): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = []
  if (existing.length) {
    // Surface entities whose name appears in the text first, then cap — keeps the list bounded + relevant.
    const lower = text.toLowerCase()
    const ranked = [...existing].sort(
      (a, b) =>
        (lower.includes(a.name.toLowerCase()) ? 0 : 1) -
        (lower.includes(b.name.toLowerCase()) ? 0 : 1)
    )
    const list = ranked
      .slice(0, 100)
      .map((e) => `- ${e.id} · ${e.name} (${e.type})`)
      .join('\n')
    content.push({
      type: 'text',
      text: `Existing entities in this campaign — reference one by its id to LINK to it instead of creating a duplicate:\n${list}`
    })
  }
  content.push({ type: 'text', text: `Raw text to extract from:\n\n${text}` })
  content.push({
    type: 'text',
    text: withChanges
      ? 'Extract the entities, notes, status changes, and relationship changes as JSON. Reference proposed entities by "#index" and existing ones by id; every note must reference at least one entity.'
      : 'Extract the entities and notes as JSON. Reference proposed entities by "#index" and existing ones by id; every note must reference at least one entity.'
  })
  return content
}

export interface ExtractChangesetParams {
  text: string
  existing: { id: string; name: string; type: string }[]
  model: string
  effort: 'medium' | 'high'
  withChanges?: boolean // changeset v2 (backfill): also extract status/relationship changes
  signal?: AbortSignal
}

/** Single-shot structured extraction. Returns the raw (UNVALIDATED) changeset; import.service cleans it. */
export async function extractChangeset(params: ExtractChangesetParams): Promise<RawExtraction> {
  const withChanges = params.withChanges ?? false
  return structuredObjectCall<RawExtraction>({
    model: params.model,
    effort: params.effort,
    schema: extractionSchema(withChanges),
    system: buildExtractionSystem(withChanges),
    content: buildExtractionUserContent(params.text, params.existing, withChanges),
    signal: params.signal
  })
}

/** "In the moment" call. Returns raw suggestions (caller enforces the 8-distinct-primary rule). */
export async function suggest(params: SuggestParams): Promise<MomentSuggestion[]> {
  return structuredArrayCall<MomentSuggestion>({
    model: params.model,
    effort: params.effort,
    schema: SUGGEST_SCHEMA,
    system: buildSuggestSystem(params.context),
    content: buildSuggestUserContent(
      params.situation,
      params.chunks,
      params.relationships,
      params.state,
      params.scene
    ),
    arrayKey: 'recommendations',
    signal: params.signal
  })
}

// ---- Suggest: open-ended "directions" mode (Phase 3 addendum) ----

const DIRECTIONS_INSTRUCTIONS = `You help a tabletop RPG player figure out what their character might DO NEXT to move the story forward — for an open, between-scenes moment ("we just got back to town", "we cleared the dungeon, now what?"), not a single charged decision. You'll be given a brief on how this player character (PC) thinks and what they value, the campaign's unfinished business (open quests and the other party members), retrieved notes, the current state, the known relationships, and (optionally) where things stand right now.

Your job: propose a handful of concrete next moves — things the player could actually pursue this session — each tagged with one CATEGORY and a one-line RATIONALE, all chosen to fit THIS character.

THE EIGHT CATEGORIES (use the ones that fit; you do NOT need all eight):
- quest — pursue or advance an unfinished quest (named, from the open-quests list).
- npc — seek out, talk to, or deal with a specific person.
- location — go to or explore a specific place (a shop, a landmark, somewhere unvisited).
- party — turn to another player character: ask, confide, plan, or settle something.
- personal — chase this PC's OWN goal, backstory thread, or want (from the brief).
- story — follow a rumor, lead, or larger thread; push the overarching plot.
- faction — engage a group or organization (join, oppose, bargain, report in).
- item — seek, use, sell, or investigate a notable item.

GROUND IT IN REAL CONTENT. Name actual quests, people, places, and items from the provided material — "go finish <the real open quest>", "ask <the named NPC> about <a real thread>", "check out <the named shop>". Don't invent quests or people. Use the open-quests list for quest moves, the other-party-members list for party moves, the brief's goals for personal moves, and the notes/relationships for the rest. Read the current state as the present — don't propose a quest already Completed or talking to someone already Dead.

FIT THE CHARACTER. These are the moves THIS PC would actually be drawn to — weight them by the brief's values, fears, and wants. A pious cleric and a greedy rogue, idle in the same town, should suggest different next steps. Each suggestion is a concrete action in the player's hands (a sentence), not a vague theme; the rationale (one line) says why it fits this character or the story.

AIM for about six to eight suggestions spanning a few different categories — enough to give real choices without burying them. Quality over quantity; skip a category rather than pad it.

PRESENT SCENE. If a "present scene" block is given, prefer next-moves that fit where the party is, the time, who's present and who they're facing, the quest in progress, and the scene's MODE — Combat: immediate, in-the-moment moves over errands or travel; Social: who to talk to, persuade, or confront; Stealth: scouting and quiet approaches; Exploration: places to investigate; Downtime/Travel: personal threads, preparation, and where to head next.`

/** Structured-output schema for directions. Length isn't enforceable here — suggest.service validates. */
const DIRECTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: [...SUGGEST_CATEGORIES] },
          suggestion: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['category', 'suggestion', 'rationale']
      }
    }
  },
  required: ['suggestions']
}

/**
 * Render the campaign's open threads for directions mode: unfinished quests (with objectives) and the
 * other party members, so the model can suggest real "go do X" / "talk to PC Y" moves. Bounded.
 */
export function formatCampaignThreads(
  quests: { name: string; status: string | null; objective: string | null }[],
  otherPcs: { name: string }[],
  maxQuests = 8,
  maxPcs = 6
): string | null {
  const lines: string[] = []
  const openQuests = quests.slice(0, maxQuests)
  if (openQuests.length) {
    lines.push('Unfinished quests (open threads):')
    for (const q of openQuests) {
      const status = q.status ? ` (${q.status})` : ''
      const obj = q.objective ? `: ${q.objective}` : ''
      lines.push(`- ${q.name}${status}${obj}`)
    }
  }
  const pcs = otherPcs.slice(0, maxPcs)
  if (pcs.length) {
    if (lines.length) lines.push('')
    lines.push('Other party members you could turn to:')
    for (const p of pcs) lines.push(`- ${p.name}`)
  }
  return lines.length ? lines.join('\n') : null
}

/**
 * The volatile user turn for directions: the campaign-threads block, retrieved notes, current state,
 * relationships — all as PLAIN TEXT (no citations) — then where things stand (or a between-scenes
 * fallback when the situation is blank).
 */
export function buildDirectionsUserContent(
  situation: string,
  threads: string | null,
  chunks: RetrievedChunk[],
  relationships?: string | null,
  state?: string | null,
  scene?: string | null
): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = []
  if (threads) {
    content.push({
      type: 'text',
      text: `The campaign's unfinished business — draw your "next move" ideas from this real content:\n${threads}`
    })
  }
  if (chunks.length) {
    const notes = chunks
      .map((c) => {
        const title = c.sessionLabel ? `${c.entityName} — ${c.sessionLabel}` : c.entityName
        return `## ${title}\n${c.content}`
      })
      .join('\n\n')
    content.push({
      type: 'text',
      text: `Relevant campaign notes — treat as FACT for anything about the world:\n\n${notes}`
    })
  }
  if (state) {
    content.push({
      type: 'text',
      text: `Current state — this is the present moment; treat as FACT. Anything resolved here is DONE:\n${state}`
    })
  }
  if (scene) {
    content.push({ type: 'text', text: scene })
  }
  if (relationships) {
    content.push({
      type: 'text',
      text: `Known relationships among the people and things above — treat as FACT (who owns/controls/is connected to what):\n${relationships}`
    })
  }
  const trimmed = situation.trim()
  content.push({
    type: 'text',
    text: trimmed
      ? `Where things stand right now:\n${trimmed}`
      : 'The party is between scenes with no specific prompt — suggest where this character would steer things next.'
  })
  return content
}

export interface SuggestDirectionsParams {
  situation: string
  threads: string | null
  chunks: RetrievedChunk[]
  relationships?: string | null
  state?: string | null
  scene?: string | null
  context: SuggestContext
  model: string
  effort: 'medium' | 'high'
  signal?: AbortSignal
}

/** Open-ended directions call. Returns raw suggestions (caller validates count/shape). */
export async function suggestDirections(params: SuggestDirectionsParams): Promise<StorySuggestion[]> {
  return structuredArrayCall<StorySuggestion>({
    model: params.model,
    effort: params.effort,
    schema: DIRECTIONS_SCHEMA,
    system: buildDirectionsSystem(params.context),
    content: buildDirectionsUserContent(
      params.situation,
      params.threads,
      params.chunks,
      params.relationships,
      params.state,
      params.scene
    ),
    arrayKey: 'suggestions',
    signal: params.signal
  })
}
