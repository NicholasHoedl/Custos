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
    'Note what happens as you play, one plain line at a time. This is the view you’ll live in during a session.',
  sessions:
    'Every game night is a session. Review what happened, get a “previously on…” recap, and turn its log into your world — Extract, Illuminate, and Transcribe all live here.',
  character:
    'Your main character’s home: their profile, backstory, and the persona and voice the Keeper speaks in.',
  capture:
    'Your world library — every person, place, faction, quest, and item you meet. Browse, edit, and inscribe new entries.',
  web: 'A living map of your campaign’s relationships — an interactive graph you can filter, focus, and rewind through past sessions.',
  recall:
    'Ask a question in plain language and get an answer drawn from your own notes, with its sources cited. Needs the free search model (download it in Settings).',
  suggest:
    'Not sure what to do? Get four in-character options for the moment, grounded in your character and the scene.',
  converse:
    'About to talk to someone? Get four in-character questions to draw them out, from safe openers to pointed probes.',
  continuity:
    'Audit your campaign for inconsistencies — a fallen NPC still acting, two notes that disagree, a status that doesn’t match its lifecycle — with automatic checks plus an AI pass over your notes.'
}

/** The AI lenses whose header carries an info popover. */
export type LensKey = 'recall' | 'suggest' | 'converse' | 'continuity'

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
  { name: string; does: string; using: string[]; query: string[]; queryLabel?: string }
> = {
  recall: {
    name: 'Lore',
    does: 'Searches your notes and answers in your character’s voice, citing the entries it drew from.',
    using: [
      'Ask one question at a time. Follow-ups remember the thread, so you can build on the last answer.',
      'Use “as of” to answer from an earlier session’s point of view, with no spoilers from later ones.'
    ],
    query: [
      'Name the person, place, or thing. Lore matches your words against your notes and entity names, so “Glasstaff” finds far more than “the wizard” — and a bare “him” finds nothing.',
      'Ask about what you’ve actually recorded. Lore answers only from your notes, and it keeps a rumor a rumor rather than inventing details.',
      'Ask one concrete question rather than a broad “what’s going on?” A focused question gets a focused, right-sized answer instead of a shallow tour.'
    ]
  },
  suggest: {
    name: 'Counsel',
    does: 'Reads your character and the campaign, then offers four ways to play the moment — or, with no situation given, story directions drawn from your open threads.',
    using: [
      'Set the scene — especially the mode (Combat, Social, Stealth, Downtime…) — so the options fit the moment.',
      'Add a goal to aim all four options at it, or leave it blank for a wider spread.',
      'Not quite right? Refine re-rolls the same moment — bolder, more cautious, or from a fresh angle.'
    ],
    query: [
      'Describe the exact moment — who just did or said what, and the choice you now face. “The mayor just admitted he pays the Redbrands, and he’s waiting on our answer” works far better than “we’re in trouble.”',
      'Name who’s involved and what’s at stake. The four options anchor to those characters’ real ties to you.',
      'Vague in, generic out: given only “we’re in trouble,” Counsel has to guess what you mean and falls back on safe, middle-of-the-road moves.'
    ]
  },
  converse: {
    name: 'Converse',
    does: 'Suggests four in-character questions to ask someone, from safe openers to pointed probes.',
    using: [
      'Pick who you’re talking with — an NPC or another player’s character.',
      'To follow up, choose the question you actually asked and paraphrase their answer. The next four build on what they said.',
      'Use “as of” to ask only what your character knew at an earlier session.'
    ],
    query: [
      'Add a thread — the specific thing you want to crack. “Does he know who hired the bandits?” aims most of the four questions there and reaches details a blank thread won’t.',
      'The questions draw on what you’ve recorded about that character — their description, traits, goals, flaws, your notes on them, and how the two of you stand. Flesh out a thin character first, or the questions stay thin. With a thread set, Converse also pulls in related people and places from your notes.',
      'In a follow-up, include how they answered — a dodge, a flinch, a boast — so the next questions push on the tell, not just the words.'
    ]
  },
  continuity: {
    name: 'Continuity',
    does: 'Scans your whole campaign for inconsistencies — automatic checks plus an AI pass over your notes — and lists what to fix.',
    using: [
      'Press Run check any time. The automatic checks work with no API key or internet; the AI contradiction pass needs a key (add one in Settings).',
      'Click an entity in a finding to jump straight to it and fix the problem.',
      'Re-run after a session — findings you’ve resolved drop off, so it stays a short, current to-do list.'
    ],
    query: [
      'Automatic checks (instant, precise): a status that doesn’t match its lifecycle, a pair recorded as both allies and enemies, a live tie or a fresh note on an entity that has ended.',
      'The AI pass reads your notes for contradictions the checks can’t see: two notes that disagree, a “fallen” character still acting, a rumor a later note resolved but still tagged uncertain.',
      'It flags only what your record actually supports, and never changes anything — every fix is yours to make.'
    ],
    queryLabel: 'What it checks'
  }
}

/**
 * Copy for the Chronicle header info popover (`components/capture/ChronicleInfo.tsx`) — the capture-side
 * counterpart to `LENS_PROMPT_TIPS`. `writing` is the important half: how to phrase entries so the tier-1
 * Extract (real names → entities, plain status changes → chronology, rumor/suspicion → note confidence) and
 * tier-2 Illuminate (who-did-what → relationship direction) read them well. The Keeper only knows what you write.
 */
export const CHRONICLE_TIPS: { name: string; does: string; using: string[]; writing: string[] } = {
  name: 'Chronicle',
  does: 'A plain running log of your session. Later, Extract turns it into people, places, and notes, and Illuminate fills in how they connect — so the Keeper can answer from what you actually played.',
  using: [
    'Jot one plain line as things happen — a sentence or two, no polish needed. The newest sits at the bottom, like a transcript.',
    'Type “/” to drop in an entity by name — or “/npc”, “/loc”, “/que”… to browse a type — without leaving the composer to look it up.',
    'When the night’s over, open the Sessions page and run Extract, then Illuminate. Editing a line afterward won’t rewrite notes you’ve already extracted — they’re separate records.'
  ],
  writing: [
    'Use real names, spelled the same way every time. “Glasstaff”, “Sildar”, “Tresendar Manor” become entities the Keeper can track; “the wizard” or “him” give it nothing, and a name spelled two ways can split into two.',
    'Say who did what to whom. “Glasstaff leads the Redbrands”, “Sildar hired us to find Gundren” — a clear subject and object let Illuminate draw the right relationship, in the right direction.',
    'Record status changes the moment they land. “Sildar is captured”, “Iarno is dead”, “the Redbrands are broken” — state drives the timeline, so the Keeper knows what’s true as of each session.',
    'Flag rumor and hunches. “We heard Cragmaw took Gundren”, “we suspect the mayor’s lying” — kept as rumor or suspicion, so the Keeper hedges instead of stating them as fact.',
    'The Keeper only knows what you write. One concrete line beats a page of vague ones — and you can always add detail before you Extract.'
  ]
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

// The core loop. Icons match the real buttons: BookCheck = the Sessions page's "Extract" button; the rest
// read as their step. Rendered by the Quickstart guide.
export const LOOP_STEPS: LoopStep[] = [
  {
    icon: NotebookPen,
    label: 'Chronicle',
    gloss: 'Jot down what happens at the table, in plain lines.'
  },
  { icon: BookCheck, label: 'Extract', gloss: 'Turn the session’s log into entities and notes.' },
  {
    icon: Wand2,
    label: 'Illuminate',
    gloss: 'Fill in relationships and profiles from those notes.'
  },
  { icon: Library, label: 'Ask', gloss: 'Lore, Counsel, and Converse draw on it all.' }
]

/** Where to get an Anthropic API key — the console link + the numbered "how to" steps. Shared by the
 *  tutorial's required key step and the Quickstart guide's getting-started section. */
export const ANTHROPIC_CONSOLE_URL = 'https://console.anthropic.com/settings/keys'
export const ANTHROPIC_CONSOLE_LABEL = 'console.anthropic.com'

export const API_KEY_STEPS: string[] = [
  'Go to the Anthropic Console at console.anthropic.com and sign in, or create a free account.',
  'Add a little billing credit. API usage is pay-as-you-go, and a few dollars is plenty to try Custos.',
  'Under API Keys, choose Create Key, then copy it — keys start with “sk-ant-”.',
  'Paste it into Custos to save and verify it. Your key is stored encrypted on this device and used only to call Anthropic.'
]
