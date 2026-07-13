import { BookCheck, Library, NotebookPen, Wand2, type LucideIcon } from 'lucide-react'
import type { ViewKey } from '@renderer/store/ui-store'

// Shared teaching content — the single source for the first-run tutorial's tool tour
// (`onboarding/TutorialOverlay.tsx`), the always-available Quickstart guide (`onboarding/QuickstartGuide.tsx`),
// and the Chronicle loop card (`onboarding/LoopExplainer.tsx`). Keeping the copy here (mirrors how
// `lib/nav-items.tsx` is the single source for the Sidebar + command palette) means the three surfaces
// never drift on wording. Data only — no JSX; each surface owns its own presentation.

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
 * "How to prompt this tool well" copy for each AI lens's header info popover
 * (`components/lens/LensPromptInfo.tsx`). `name` names the tool ("What Lore does" / "About Lore"), `does`
 * is a one-line what-it-does, and `tips` are the prompt best-practices. Kept here beside `TOOL_BLURBS` so
 * all lens help copy shares one home and the three popovers can't drift.
 */
export const LENS_PROMPT_TIPS: Record<LensKey, { name: string; does: string; tips: string[] }> = {
  recall: {
    name: 'Lore',
    does: 'Searches your notes and writes a cited answer in plain language.',
    tips: [
      'Name the person, place, or event you’re asking about — retrieval matches on names.',
      'Ask one clear question at a time.',
      'Follow-ups stay in context — build on the last answer instead of restating it.',
      'Use “as of” to ask about an earlier session without spoiling what came later.'
    ]
  },
  suggest: {
    name: 'Counsel',
    does: 'Reads your character and the campaign and offers ideas that fit them — four tagged ways to play a moment, or story directions grounded in your open quests and the party.',
    tips: [
      'Set the scene — where you are and who’s present sharpens the read.',
      'Describe a concrete moment, not a vague situation.',
      'Name a goal to bias the options toward it.',
      'Use “as of” to ask without spoiling what your character doesn’t know yet.'
    ]
  },
  converse: {
    name: 'Converse',
    does: 'Gives a spread of in-character questions to ask someone — from safe openers to pointed probes.',
    tips: [
      'Pick who you’re talking WITH — an NPC or another player’s character.',
      'Name a thread to steer them (a person, topic, or rumor), or leave it blank to draw them out generally.',
      'To follow up, pick the question you actually asked, then paraphrase their answer — the next questions build on it.',
      'Use “as of” to ask only what your character could know at that point.'
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
// read as their step. Rendered by LoopExplainer (Chronicle card) and the Quickstart guide.
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
  'Add a little billing credit — API usage is pay-as-you-go, and a few dollars is plenty to try Ledger.',
  'Go to API keys → Create Key, then copy the key (it starts with “sk-ant-”).',
  "Paste it into Ledger and verify — it's stored encrypted on this device and only ever used to call Anthropic."
]
