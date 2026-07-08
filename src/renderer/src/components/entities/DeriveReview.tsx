import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { Entity } from '@shared/entity-types'
import type { UpdateEntityInput } from '@shared/ipc-types'
import { cn } from '@renderer/lib/utils'
import { ledger } from '@renderer/lib/ipc'
import { plural } from '@renderer/lib/format'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { useUiStore } from '@renderer/store/ui-store'
import { useDeriveProfile } from '@renderer/hooks/use-derive-profile'
import { useImport } from '@renderer/hooks/use-import'
import { ChangesetReview } from '@renderer/components/capture/ChangesetReview'
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

/**
 * The "Draft from backstory" review (ADR-029/030) — a TWO-STEP wizard:
 *   Step 1 (Profile): the derived profile FIELDS (description / traits / goals / flaws / voice) with
 *   per-field accept toggles; Apply writes the accepted fields (entity.update) then REBUILDS the persona
 *   via the one canonical generator (persona.generate).
 *   Step 2 (World): the backstory run through the shared changeset engine (useImport withChanges) —
 *   proposed NEW entities, notes, and relationship ties, reviewed in the same ChangesetReview that
 *   Chronicle/Transcribe use and applied UNDATED (sessionId null → pre-tracking / pre-campaign
 *   background, ADR-030). Field changes are stripped — the MC's fields are step 1's job.
 * Both passes run in parallel on open; either step can be skipped; nothing writes without approval.
 */
export function DeriveReview({
  pcId,
  backstory,
  campaignEntities,
  open,
  onOpenChange,
  onApplied
}: {
  pcId: string
  backstory: string
  campaignEntities: Entity[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}) {
  const derive = useDeriveProfile()
  // The world pass is told WHOSE backstory it's reading (ADR-030 v3) — standing ties anchor to the MC.
  const imp = useImport({ withChanges: true, backstorySubjectId: pcId })
  const [step, setStep] = useState<'profile' | 'world'>('profile')
  const [accept, setAccept] = useState<Accept>(ALL)
  const [busy, setBusy] = useState(false)
  const worldApplied = useRef(false)
  const { run, reset } = derive
  const { extract: impExtract, reset: impReset } = imp

  // On open: run BOTH passes in parallel — field derivation (step 1) and the world extraction (step 2).
  // Reset both when the dialog closes.
  useEffect(() => {
    if (open) {
      setStep('profile')
      setAccept(ALL)
      worldApplied.current = false
      run(pcId)
      impExtract(backstory)
    } else {
      reset()
      impReset()
    }
  }, [open, pcId, backstory, run, reset, impExtract, impReset])

  // Step 1 owns the main character's profile fields — double-proposing them as field CHANGES in step 2
  // would be confusing, so strip them from the world review (deliberate, ADR-030 v3).
  const { status: impStatus, setFieldChanges } = imp
  useEffect(() => {
    if (impStatus === 'review') setFieldChanges([])
  }, [impStatus, setFieldChanges])

  // The world apply resolves asynchronously (the hook flips to 'done') — notify the dashboard once.
  useEffect(() => {
    if (imp.status === 'done' && !worldApplied.current) {
      worldApplied.current = true
      onApplied()
    }
  }, [imp.status, onApplied])

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

  async function applyProfile(): Promise<void> {
    if (!profile) return
    setBusy(true)
    try {
      // Only accepted, non-empty fields go in the patch — an empty suggestion never wipes existing data.
      const patch: UpdateEntityInput = {}
      if (accept.description && profile.description) patch.description = profile.description
      if (accept.traits && profile.traits.length) patch.traits = profile.traits
      if (accept.goals && profile.goals.length) patch.goals = profile.goals
      if (accept.flaws && profile.flaws.length) patch.flaws = profile.flaws
      if (accept.voiceExamples && profile.voiceExamples.length)
        patch.voiceExamples = profile.voiceExamples
      if (Object.keys(patch).length > 0) {
        await ledger.entity.update(pcId, patch)
        // Rebuild the persona from the now-updated fields via the ONE canonical generator (ADR-030).
        // Best-effort: if it fails the fields are still saved and the user can Regenerate on the page.
        await ledger.persona.generate(pcId).catch(() => {})
        useUiStore.getState().bumpEntities()
        toast.success('Profile updated from backstory')
        onApplied()
      }
      setStep('world')
    } catch (err) {
      toast.error('Could not apply', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  const worldWaiting =
    imp.status === 'extracting' || (imp.status === 'idle' && imp.reason === null && !imp.error)
  const worldChanges = imp.result
    ? imp.result.statusChangesApplied +
      imp.result.relationshipChangesApplied +
      imp.result.fieldChangesApplied
    : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Sparkles className="size-5 text-primary" />
            Draft from backstory
          </DialogTitle>
          <DialogDescription>
            {step === 'profile'
              ? 'Step 1 of 2 — the character’s profile. Choose what to apply; the persona is rebuilt from it.'
              : 'Step 2 of 2 — people, places, notes, and ties found in the backstory, added as pre-campaign background.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'profile' ? (
          <>
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
                  {reasonCopy(failure)}
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
              <Button variant="outline" onClick={() => setStep('world')} disabled={busy}>
                Skip
              </Button>
              <Button onClick={() => void applyProfile()} disabled={!willApply || busy}>
                {busy ? 'Applying…' : 'Apply & continue'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {worldWaiting ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Reading the backstory for people, places, and ties…
              </p>
            ) : imp.status === 'review' || imp.status === 'applying' ? (
              <div className="flex max-h-[60vh] min-h-0 min-w-0 flex-col">
                <ChangesetReview
                  imp={imp}
                  campaignEntities={campaignEntities}
                  applyLabel="Add to campaign"
                  onApply={() => imp.apply(null)} // undated: pre-campaign background (pre-tracking, ADR-030)
                  onDiscard={() => onOpenChange(false)}
                />
              </div>
            ) : imp.status === 'done' && imp.result ? (
              <div className="space-y-3 py-8 text-center">
                <p className="text-sm text-foreground">
                  Added <strong>{imp.result.createdEntityIds.length}</strong>{' '}
                  {plural(imp.result.createdEntityIds.length, 'new entity', 'new entities')}
                  {imp.result.linkedEntityIds.length > 0 && (
                    <> · linked {imp.result.linkedEntityIds.length}</>
                  )}
                  {worldChanges > 0 && (
                    <>
                      {' '}
                      · <strong>{worldChanges}</strong> {plural(worldChanges, 'tie', 'ties')}
                    </>
                  )}
                  {imp.result.createdNoteIds.length > 0 && (
                    <>
                      {' '}
                      · {imp.result.createdNoteIds.length}{' '}
                      {plural(imp.result.createdNoteIds.length, 'note', 'notes')}
                    </>
                  )}{' '}
                  — as pre-campaign background.
                </p>
                <Button size="sm" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            ) : imp.status === 'error' ? (
              <p className="py-10 text-center text-sm text-destructive">{imp.error}</p>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {imp.reason === 'empty'
                  ? 'Nothing new found in the backstory — its people and places may already be in the campaign.'
                  : 'Could not read the backstory for world material. Try again in a moment.'}
              </p>
            )}
            {imp.status !== 'review' && imp.status !== 'applying' && imp.status !== 'done' && (
              <DialogFooter>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </DialogFooter>
            )}
          </>
        )}
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
