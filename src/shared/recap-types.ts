// Shared types for Session Recap — a streamed "Previously on…" summary of ONE session, grounded only
// in that session's own beats/notes (+ the prior session's summary for continuity). The request streams
// back like Recall (requestId-tagged chunk/done/error), and the finished text is saved to
// session.summary. Mirrors recall-types' streaming shape.

export interface RecapRequest {
  requestId: string
  campaignId: string
  sessionId: string
}

export interface RecapChunk {
  requestId: string
  text: string
}

/** Why a recap finished: 'ok' = text streamed + saved; the rest are non-generating outcomes. */
export type RecapReason = 'ok' | 'offline' | 'no_key' | 'empty'

export interface RecapDone {
  requestId: string
  sessionId: string
  reason: RecapReason
}

export type RecapErrorKind = 'offline' | 'no_key' | 'api' | 'unknown'

export interface RecapError {
  requestId: string
  message: string
  kind: RecapErrorKind
}
