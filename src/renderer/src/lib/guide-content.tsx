import { BookCheck, Library, NotebookPen, Wand2, type LucideIcon } from 'lucide-react'
import type { ViewKey } from '@renderer/store/ui-store'

// Shared teaching content — the single source for the first-run tutorial's tool tour
// (`onboarding/TutorialOverlay.tsx`) and the always-available Quickstart guide
// (`onboarding/QuickstartGuide.tsx`). Keeping the copy here (mirrors how `lib/nav-items.tsx` is the
// single source for the Sidebar + command palette) means the two surfaces never drift on wording.
// Data only — no JSX; each surface owns its own presentation.

/** One-line "what it's for" per nav view, keyed by `NAV_ITEMS.key`. Used by the tour + the guide. */
export const TOOL_BLURBS: Record<string, string> = {
  journal:
    "Jot what happens as you play — one plain line at a time. You'll spend most of your time here.",
  sessions:
    'Each game night is a session. Review it, get a "previously on…" recap, and run Illuminate to enrich your world from its notes.',
  character:
    "Your main character's home — their profile, backstory, persona, and voice (the voice the Keeper speaks in).",
  capture:
    'Your world library: every person, place, faction, quest, and item. Browse, edit, and inscribe new entries.',
  web: "A living map of how everyone and everything connects — a force-directed graph of your campaign's relationships.",
  recall:
    'Ask a question in plain language; get a cited answer drawn from your own notes. (Needs the search model — download it in Settings.)',
  suggest:
    'Stuck in the moment? Get in-character ideas for what your character might do — tagged and grounded in the scene.',
  converse:
    'About to talk to someone? Get a spread of in-character questions to draw them out, from safe openers to pointed probes.'
}

/** The three AI lenses, the ones whose output is only as good as the prompt. */
export type LensKey = 'recall' | 'suggest' | 'converse'

/**
 * Copy for each AI lens's header info popover (`components/lens/LensPromptInfo.tsx`). `name` names the tool
 * ("What Lore does"), `does` is the one-line what-it-does, `using` is the mechanical how-to, and `query` is
 * the prompt best-practices — what a query should actually CONTAIN to get the best result. The `query` copy
 * is validated by a live weak-vs-strong A/B against each lens (grounding held constant): a specific, detailed
 * query beats a vague one every time — Counsel most starkly (a vague situation makes it guess). Kept beside
 * `TOOL_BLURBS` so lens help copy shares one home and the three popovers can't drift.
 */
export const LENS_PROMPT_TIPS: Record<
  LensKey,
  { name: string; does: string; using: string[]; query: string[] }
> = {
  recall: {
    name: 'Lore',
    does: "Searches your notes and answers in your character's voice, citing what it drew on.",
    using: [
      'One question at a time — follow-ups remember the thread, so build on the last answer.',
      'Use “as of” to answer as of an earlier session, without spoilers from later ones.'
    ],
    query: [
      'Name the person, place, or thing — it matches your words against note text and entity names, so “Glasstaff” finds far more than “the wizard,” and a bare “him” finds nothing.',
      'Ask about what you’ve actually recorded — it answers only from your notes, and keeps a rumor a rumor rather than inventing.',
      'Ask one concrete thing, not a broad “what’s going on?” — a pointed question gets a pointed, right-sized answer instead of a shallow tour.'
    ]
  },
  suggest: {
    name: 'Counsel',
    does: 'Reads your character and the campaign and offers four ways to play the moment — or, with no situation, story directions from your open threads.',
    using: [
      'Set the scene — especially the mode (Combat / Social / Stealth / Downtime…) — so the moves fit the kind of moment.',
      'Add a goal to point all four options toward it; leave it off for a wider spread.',
      'Not quite right? Refine re-rolls the same moment bolder or calmer.'
    ],
    query: [
      'Describe the exact moment — who just did or said what, and the choice you’re now facing. “The mayor just admitted he pays the Redbrands, and he’s waiting on our answer” beats “we’re in trouble.”',
      'Name who’s involved and what’s at stake — the four options anchor to those characters’ real ties to you.',
      'Vague in, generic out: given only “we’re in trouble,” it guesses at what you mean and hands back safe, middle-of-the-road moves.'
    ]
  },
  converse: {
    name: 'Converse',
    does: 'Gives four in-character questions to ask someone — from safe openers to pointed probes.',
    using: [
      'Pick who you’re talking WITH — an NPC or another player’s character.',
      'To follow up, pick the question you actually asked, then paraphrase their answer — the next four build on it.',
      'Use “as of” to ask only what your character knew at an earlier session.'
    ],
    query: [
      'Name the specific thing you want to crack — “Does he know who hired the bandits?” aims most of the four questions there, and reaches specifics a blank thread won’t.',
      'It only knows what you’ve recorded about them — their goals, flaws, and how you two stand. Flesh a thin character out first, or the questions stay thin.',
      'In a follow-up, include HOW they answered — a dodge, a flinch, a boast — so the next questions push on the tell, not just the words.'
    ]
  }
}

/** The tools, grouped into the three teaching screens (nav order within each). */
export const TOUR_GROUPS: Record<
  'tour-capture' | 'tour-world' | 'tour-ask',
  { title: string; keys: ViewKey[] }
> = {
  'tour-capture': { title: 'Capture the story', keys: ['journal', 'sessions'] },
  'tour-world': { title: 'Your world', keys: ['character', 'capture', 'web'] },
  'tour-ask': { title: 'Ask the Keeper', keys: ['recall', 'suggest', 'converse'] }
}

export interface LoopStep {
  icon: LucideIcon
  label: string
  gloss: string
}

// The core ritual. Icons match the real buttons: BookCheck = the "Close out session" button; the rest
// read as their step. Rendered by the Quickstart guide.
export const LOOP_STEPS: LoopStep[] = [
  {
    icon: NotebookPen,
    label: 'Chronicle',
    gloss: 'Jot what happens at the table, in plain lines.'
  },
  { icon: BookCheck, label: 'Close out', gloss: 'Turn the session’s log into entities & notes.' },
  { icon: Wand2, label: 'Illuminate', gloss: 'Fill in ties & profiles from those notes.' },
  { icon: Library, label: 'Ask', gloss: 'Lore, Counsel & Converse draw on it all.' }
]

/** Where to get an Anthropic API key — the console link + the numbered "how to" steps. Shared by the
 *  tutorial's required key step and the Quickstart guide's getting-started section. */
export const ANTHROPIC_CONSOLE_URL = 'https://console.anthropic.com/settings/keys'
export const ANTHROPIC_CONSOLE_LABEL = 'console.anthropic.com'

export const API_KEY_STEPS: string[] = [
  'Open the Anthropic Console at console.anthropic.com and sign in — or create a free account.',
  'Add a little billing credit — API usage is pay-as-you-go, and a few dollars is plenty to try Custos.',
  'Go to API keys → Create Key, then copy the key (it starts with “sk-ant-”).',
  "Paste it into Custos and verify — it's stored encrypted on this device and only ever used to call Anthropic."
]
