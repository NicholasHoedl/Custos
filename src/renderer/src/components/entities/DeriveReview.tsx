import { useEffect, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { DeriveProfileFailureReason } from '@shared/derive-profile-types'
import type { UpdateEntityInput } from '@shared/ipc-types'
import { cn } from '@renderer/lib/utils'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'
import { useDeriveProfile } from '@renderer/hooks/use-derive-profile'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'

interface Accept {
  description: boolean
  traits: boolean
  goals: boolean
  flaws: boolean
  voiceExamples: boolean
}
const ALL: Accept = {
  description: true,
  traits: true,
  goals: true,
  flaws: true,
  voiceExamples: true
}

const REASON_MESSAGE: Record<DeriveProfileFailureReason, string> = {
  no_backstory: 'Add a backstory to this character first — the tool derives everything from it.',
  no_key: 'Add an Anthropic API key in Settings to use AI tools.',
  bad_key: 'Your Anthropic API key was rejected — set a valid one in Settings.',
  offline: 'You appear to be offline. Reconnect and try again.',
  api: 'The AI request failed. Try again in a moment.',
  invalid: 'The AI returned nothing usable. Try again.'
}

/**
 * The "derive profile from backstory" review (ADR-029/030): runs the single-shot AI pass, shows each
 * proposed FIELD (description / traits / goals / flaws / voice examples) with an accept toggle, and on
 * Apply writes the accepted fields (entity.update) then REBUILDS the persona from the updated profile via
 * the one canonical generator (persona.generate). Nothing is written until Apply. Empty suggestions are
 * disabled + never overwrite existing values.
 */
export function DeriveReview({
  pcId,
  open,
  onOpenChange,
  onApplied
}: {
  pcId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}) {
  const derive = useDeriveProfile()
  const [accept, setAccept] = useState<Accept>(ALL)
  const [busy, setBusy] = useState(false)
  const { run, reset } = derive

  // Run once each time the dialog opens; clear when it closes.
  useEffect(() => {
    if (open) {
      setAccept(ALL)
      run(pcId)
    } else {
      reset()
    }
  }, [open, pcId, run, reset])

  const profile = derive.status === 'done' && derive.result?.ok ? derive.result.profile : null
  const failure =
    derive.status === 'done' && derive.result && !derive.result.ok ? derive.result.reason : null

  const toggle = (k: keyof Accept): void => setAccept((a) => ({ ...a, [k]: !a[k] }))

  const willApply =
    profile != null &&
    ((accept.description && !!profile.description) ||
      (accept.traits && profile.traits.length > 0) ||
      (accept.goals && profile.goals.length > 0) ||
      (accept.flaws && profile.flaws.length > 0) ||
      (accept.voiceExamples && profile.voiceExamples.length > 0))

  async function apply(): Promise<void> {
    if (!profile) return
    setBusy(true)
    try {
      // Only accepted, non-empty fields go in the patch — an empty suggestion never wipes existing data.
      const patch: UpdateEntityInput = {}
      if (accept.description && profile.description) patch.description = profile.description
      if (accept.traits && profile.traits.length) patch.traits = profile.traits
      if (accept.goals && profile.goals.length) patch.goals = profile.goals
      if (accept.flaws && profile.flaws.length) patch.flaws = profile.flaws
      if (accept.voiceExamples && profile.voiceExamples.length) patch.voiceExamples = profile.voiceExamples
      if (Object.keys(patch).length > 0) {
        await ledger.entity.update(pcId, patch)
        // Rebuild the persona from the now-updated fields via the ONE canonical generator (ADR-030).
        // Best-effort: if it fails the fields are still saved and the user can Regenerate on the page.
        await ledger.persona.generate(pcId).catch(() => {})
      }
      useUiStore.getState().bumpEntities()
      toast.success('Profile updated from backstory')
      onApplied()
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not apply', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Sparkles className="size-5 text-primary" />
            Derive profile from backstory
          </DialogTitle>
          <DialogDescription>
            Review the suggestions and choose which to apply. Nothing changes until you apply.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {derive.status === 'thinking' && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Reading the backstory…
            </p>
          )}
          {derive.status === 'error' && (
            <p className="py-10 text-center text-sm text-destructive">{derive.error}</p>
          )}
          {failure && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {REASON_MESSAGE[failure]}
            </p>
          )}
          {profile && (
            <>
              <FieldRow
                label="Description"
                on={accept.description}
                empty={!profile.description}
                onToggle={() => toggle('description')}
              >
                <p className="text-sm text-foreground/90">{profile.description || '—'}</p>
              </FieldRow>
              <ListRow
                label="Traits"
                items={profile.traits}
                on={accept.traits}
                onToggle={() => toggle('traits')}
              />
              <ListRow
                label="Goals"
                items={profile.goals}
                on={accept.goals}
                onToggle={() => toggle('goals')}
              />
              <ListRow
                label="Flaws"
                items={profile.flaws}
                on={accept.flaws}
                onToggle={() => toggle('flaws')}
              />
              <ListRow
                label="Voice examples"
                items={profile.voiceExamples}
                quoted
                on={accept.voiceExamples}
                onToggle={() => toggle('voiceExamples')}
              />
              <p className="px-1 text-xs text-muted-foreground">
                Applying rebuilds this character’s persona brief from the accepted fields.
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={!willApply || busy}>
            {busy ? 'Applying…' : 'Apply selected'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FieldRow({
  label,
  on,
  empty,
  onToggle,
  children
}: {
  label: string
  on: boolean
  empty?: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const active = on && !empty
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        active ? 'border-border bg-card/60' : 'border-dashed border-border/60 opacity-60'
      )}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={on}
          disabled={empty}
          onChange={onToggle}
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </label>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function ListRow({
  label,
  items,
  on,
  onToggle,
  quoted
}: {
  label: string
  items: string[]
  on: boolean
  onToggle: () => void
  quoted?: boolean
}) {
  return (
    <FieldRow label={label} on={on} empty={items.length === 0} onToggle={onToggle}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : quoted ? (
        <ul className="space-y-1">
          {items.map((v, i) => (
            <li key={i} className="border-l-2 border-metal/40 pl-3 text-sm italic text-foreground/90">
              “{v}”
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((v) => (
            <span key={v} className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-foreground">
              {v}
            </span>
          ))}
        </div>
      )}
    </FieldRow>
  )
}
