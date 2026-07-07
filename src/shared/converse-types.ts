// Shared types for Converse: the request/response contract for the in-character "question" lens — the
// third AI sibling to Consult (Recall, factual answers) and Counsel (Suggest, action ideas). Given the
// asking PC and a TARGET entity, Converse returns a short briefing about the target plus in-character
// questions the PC could ask to draw them out. Like Suggest, it's single-shot (request/response, not
// streaming) and returns a structured result (ADR-008, ADR-009).

export interface ConverseRequest {
  campaignId: string
  /** The asker — the in-character POV. Requires an active PC (+ persona), like Suggest/Counsel. */
  pcId: string
  /** The entity to brief on and draw out (any type — NPC/PC/etc.). */
  targetId: string
  /** Optional free-text nudge that steers the questions toward a thread. */
  focus?: string
  /** Chronology (ADR-017): reconstruct "as of" this session NUMBER (state + ties clamped ≤ N). */
  asOfSession?: number
}

/** The briefing: three labelled threads assembled about the target. Each entry is one short line. */
export interface ConverseBriefing {
  known: string[] // solid, confirmed facts
  openSuspected: string[] // rumored/suspected/uncertain threads + gaps — the things worth asking about
  connections: string[] // notable ties (the target's 1-hop neighbourhood)
}

/** One in-character question the asking PC could pose: the line, the thread it opens, and why to ask. */
export interface ConverseQuestion {
  question: string // phrased in the asker PC's voice
  targetsThread: string // the thread/gap it aims to open
  why: string // one line: why it's worth asking now
}

export type ConverseFailureReason = 'no_key' | 'offline' | 'no_pc' | 'invalid' | 'api' | 'unknown'

/**
 * The result of a Converse query. On success: a briefing (three threads) + the in-character questions.
 * On failure: a reason the renderer can render without try/catch (mirrors SuggestResult). There is no
 * 'no_model' reason — Converse grounds by DIRECT FETCH, not semantic search, so it needs no local model.
 */
export type ConverseResult =
  | { ok: true; briefing: ConverseBriefing; questions: ConverseQuestion[] }
  | { ok: false; reason: ConverseFailureReason; message?: string }
