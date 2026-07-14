import { InfoPopover } from '@renderer/components/chrome'
import { CHRONICLE_TIPS } from '@renderer/lib/guide-content'

/**
 * The Chronicle header's info popover — the capture-side counterpart to the AI lenses' `LensPromptInfo`,
 * built on the same `InfoPopover` primitive so it reads as "the same variety". Explains what Chronicle is,
 * how to use it, and — the point of it — how to phrase entries so Extract + Illuminate read them well
 * (real names, who-did-what, plain status changes, flagged rumor). Copy lives in `guide-content.tsx`
 * (`CHRONICLE_TIPS`); rendered in the Chronicle `PaneHeader` action slot.
 */
export function ChronicleInfo() {
  const { name, does, using, writing } = CHRONICLE_TIPS
  return (
    <InfoPopover label={`About ${name}`}>
      <p className="text-sm font-medium text-foreground">What {name} does</p>
      <p className="text-muted-foreground">{does}</p>
      <p className="text-sm font-medium text-foreground">Using it</p>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        {using.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <p className="text-sm font-medium text-foreground">Writing for the Keeper</p>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        {writing.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </InfoPopover>
  )
}
