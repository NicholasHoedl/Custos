import { InfoPopover } from '@renderer/components/chrome'
import { LENS_PROMPT_TIPS, type LensKey } from '@renderer/lib/guide-content'

/**
 * The header info popover shared by all three AI lenses (Lore / Counsel / Converse) — a generalization of
 * the old inline `CounselInfo`. Renders a one-line "what it does" plus a "Get the best results" list of
 * prompt best-practices, all pulled from the single `LENS_PROMPT_TIPS` table so the three popovers stay
 * identical in shape and can't drift. Lives in the `action` slot of each lens's `PaneHeader`.
 */
export function LensPromptInfo({ lens }: { lens: LensKey }) {
  const { name, does, tips } = LENS_PROMPT_TIPS[lens]
  return (
    <InfoPopover label={`About ${name}`}>
      <p className="text-sm font-medium text-foreground">What {name} does</p>
      <p className="text-muted-foreground">{does}</p>
      <p className="text-sm font-medium text-foreground">Get the best results</p>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        {tips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </InfoPopover>
  )
}
