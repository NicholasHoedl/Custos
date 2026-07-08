// The "derive from backstory" tool (ADR-029, revised ADR-030). A single-shot structured AI pass that
// reads the MAIN CHARACTER's backstory and proposes profile FIELDS for the user to approve — a
// description, traits, goals, flaws, and voice examples. Main-character-only and review-gated (nothing
// writes without per-field approval). The persona brief is NOT proposed here — after the approved fields
// are applied it is (re)built from the full profile by the one canonical generator (persona.service).

export interface DeriveProfileRequest {
  campaignId: string
  pcId: string // the main character to derive a profile for
}

/** The AI's suggested profile FIELDS. Every field is present; arrays may be empty. Approved per-field in
 *  the UI. The persona is NOT here — it's regenerated from these (once applied) by persona.service. */
export interface DerivedProfile {
  description: string
  traits: string[]
  goals: string[]
  flaws: string[]
  voiceExamples: string[]
}

export type DeriveProfileFailureReason =
  | 'no_key'
  | 'bad_key'
  | 'offline'
  | 'api'
  | 'invalid'
  | 'no_backstory' // the main character has no backstory to derive from

export type DeriveProfileResult =
  | { ok: true; profile: DerivedProfile }
  | { ok: false; reason: DeriveProfileFailureReason; message?: string }
