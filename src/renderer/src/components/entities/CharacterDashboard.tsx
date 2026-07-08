import { useEffect, useState, type ReactNode } from 'react'
import { Pencil, Skull, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ENTITY_TYPE_LABELS, LIFECYCLE_LABELS, type Entity } from '@shared/entity-types'
import { profileFor } from '@shared/entity-profiles'
import { lifecycleHeuristic } from '@shared/lifecycle'
import type { UpdateEntityInput } from '@shared/ipc-types'
import { cn } from '@renderer/lib/utils'
import { ledger } from '@renderer/lib/ipc'
import { useEntity, useNotes } from '@renderer/hooks/use-ledger'
import { useUiStore } from '@renderer/store/ui-store'
import { NoteList } from '@renderer/components/notes/NoteList'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Label } from '@renderer/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { InfoPopover } from '@renderer/components/chrome'
import { StatusCombobox } from './StatusCombobox'
import { ListEditDialog } from './ListEditDialog'
import { PersonaEditor } from './PersonaEditor'
import { RelationshipEditor } from './RelationshipEditor'
import { EntityHistory } from './EntityHistory'
import { DeriveReview } from './DeriveReview'

// The main character's DASHBOARD (ADR-030): a bespoke, two-column surface — a "character sheet"
// (identity + traits/goals/flaws/voice) beside "story & voice" (backstory + Suggest, persona, ties),
// with history + notes below. Text fields save in place on blur (silent; error-toast only); the four
// promoted LISTS are read-only chips edited via a per-card popup (ListEditDialog — one batched write per
// editing session, ADR-030 v3). Replaces the reused EntityDetail on the Character page; EntityDetail
// still serves Codex. Loads its own copy of the entity so it can refetch after each save.
export function CharacterDashboard({
  mainCharacterId,
  allEntities,
  onDeleted
}: {
  mainCharacterId: string
  allEntities: Entity[]
  onDeleted: () => void
}) {
  const { entity, refresh } = useEntity(mainCharacterId)
  const { notes, refresh: refreshNotes } = useNotes(mainCharacterId)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deriveOpen, setDeriveOpen] = useState(false)
  const [personaKey, setPersonaKey] = useState(0) // bump to remount PersonaEditor after a save/derive
  // Session guard (ADR-030): the backstory text the profile was last derived from. Null on load, so a
  // fresh launch re-enables Suggest; set after a successful derive; cleared-by-comparison when the
  // backstory is edited. NOT persisted.
  const [lastDerived, setLastDerived] = useState<string | null>(null)
  // Which promoted list the popup editor is open for (traits/goals/flaws/voice) — ADR-030 v3.
  const [editList, setEditList] = useState<PromotedListKey | null>(null)

  if (!entity) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
    )
  }

  const prof = profileFor('pc')
  const fallen = entity.lifecycle === 'ended'
  const presumed = entity.lifecycle === 'presumed_ended'
  const savedBackstory = String(entity.attributes.backstory ?? '').trim()
  const canSuggest = Boolean(savedBackstory) && savedBackstory !== lastDerived
  const suggestHint = !savedBackstory
    ? 'Add a backstory below to draft traits, goals, flaws, and voice from it.'
    : savedBackstory === lastDerived
      ? 'Drafted from this backstory — edit it to draft again.'
      : ''

  // ---- inline saves ----
  // Promoted fields (name/description/traits/goals/flaws/voiceExamples/status/lifecycle) are top-level.
  async function savePromoted(patch: UpdateEntityInput): Promise<void> {
    try {
      await ledger.entity.update(mainCharacterId, patch)
      useUiStore.getState().bumpEntities()
      refresh()
      setPersonaKey((k) => k + 1)
    } catch (err) {
      toast.error('Could not save', { description: String(err) })
      refresh() // revert the optimistic control value
    }
  }
  // Attributes REPLACE wholesale — re-read fresh so a concurrent attribute edit isn't clobbered.
  async function saveAttribute(key: string, value: string): Promise<void> {
    try {
      const cur = await ledger.entity.get(mainCharacterId)
      if (!cur) return
      const attributes = { ...cur.attributes }
      if (value.trim()) attributes[key] = value.trim()
      else delete attributes[key]
      await ledger.entity.update(mainCharacterId, { attributes })
      useUiStore.getState().bumpEntities()
      refresh()
      setPersonaKey((k) => k + 1)
    } catch (err) {
      toast.error('Could not save', { description: String(err) })
      refresh()
    }
  }

  async function handleDelete(): Promise<void> {
    try {
      await ledger.entity.delete(mainCharacterId)
      useUiStore.getState().bumpEntities()
      toast.success('Deleted', { description: entity!.name })
      onDeleted()
    } catch (err) {
      toast.error('Could not delete', { description: String(err) })
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header: name + type/status + Delete (editing is inline; no Edit dialog here). */}
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
              {ENTITY_TYPE_LABELS.pc}
            </span>
            {entity.status && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {entity.status}
              </span>
            )}
            {(fallen || presumed) && (
              <span className="inscribed text-[11px] text-blood">{LIFECYCLE_LABELS[entity.lifecycle]}</span>
            )}
          </div>
          <h2
            className={cn(
              'mt-1 flex items-center gap-2 font-display text-2xl font-semibold text-foreground',
              fallen && 'text-foreground/70 line-through decoration-blood decoration-2',
              presumed && 'italic text-foreground/60'
            )}
          >
            {entity.name}
            {fallen && <Skull className="size-5 text-blood" aria-label="Fallen" />}
            {presumed && <Skull className="size-4 text-blood/60" aria-label="Presumed lost" />}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          className="shrink-0 text-muted-foreground hover:border-destructive/50 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>

      {/* Body: two columns (container-query) + a full-width secondary section below. */}
      <div className="@container flex-1 overflow-y-auto p-4">
        <div className="grid gap-4 @3xl:grid-cols-2">
          {/* LEFT — the sheet */}
          <div className="min-w-0 space-y-4">
            <Card title="Identity">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ancestry">
                  <InlineText
                    value={String(entity.attributes.ancestry ?? '')}
                    onSave={(v) => void saveAttribute('ancestry', v)}
                    placeholder="e.g. Half-elf"
                  />
                </Field>
                <Field label="Class">
                  <InlineText
                    value={String(entity.attributes.class ?? '')}
                    onSave={(v) => void saveAttribute('class', v)}
                    placeholder="e.g. Rogue"
                  />
                </Field>
                <Field label="Level">
                  <InlineText
                    value={String(entity.attributes.level ?? '')}
                    onSave={(v) => void saveAttribute('level', v)}
                    placeholder="1"
                  />
                </Field>
                <Field label="Player">
                  <InlineText
                    value={String(entity.attributes.player ?? '')}
                    onSave={(v) => void saveAttribute('player', v)}
                    placeholder="Who runs them?"
                  />
                </Field>
              </div>
              <Field label="Status">
                <StatusCombobox
                  value={entity.status ?? ''}
                  options={prof.status ?? []}
                  onChange={(v, lc) =>
                    void savePromoted({
                      status: v.trim() || null,
                      lifecycle: lc ?? lifecycleHeuristic(v.trim() || null)
                    })
                  }
                />
                {(fallen || presumed) && (
                  <label className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={presumed}
                      onChange={(e) =>
                        void savePromoted({ lifecycle: e.target.checked ? 'presumed_ended' : 'ended' })
                      }
                    />
                    Presumed / unconfirmed
                  </label>
                )}
              </Field>
              <Field label="Description">
                <InlineText
                  multiline
                  rows={3}
                  value={entity.description ?? ''}
                  onSave={(v) => void savePromoted({ description: v.trim() || null })}
                  placeholder="Who they are in a line or two."
                />
              </Field>
            </Card>

            <Card title="Traits" action={<EditListButton onClick={() => setEditList('traits')} />}>
              <ChipList items={entity.traits} />
            </Card>
            <Card title="Goals" action={<EditListButton onClick={() => setEditList('goals')} />}>
              <ChipList items={entity.goals} />
            </Card>
            <Card title="Flaws" action={<EditListButton onClick={() => setEditList('flaws')} />}>
              <ChipList items={entity.flaws} />
            </Card>
            <Card
              title="Voice examples"
              action={<EditListButton onClick={() => setEditList('voiceExamples')} />}
            >
              <ChipList items={entity.voiceExamples} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Sample lines in their own words — these ground Counsel and Converse.
              </p>
            </Card>
          </div>

          {/* RIGHT — story & voice */}
          <div className="min-w-0 space-y-4">
            <Card
              title="Backstory"
              action={
                <div className="flex items-center gap-1">
                  <SuggestInfo />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canSuggest}
                    onClick={() => setDeriveOpen(true)}
                    title={suggestHint || 'Draft the profile and world material from the backstory'}
                  >
                    <Sparkles className="size-3.5" />
                    Draft from backstory
                  </Button>
                </div>
              }
            >
              <InlineText
                multiline
                rows={10}
                value={String(entity.attributes.backstory ?? '')}
                onSave={(v) => void saveAttribute('backstory', v)}
                placeholder="Where they come from — Draft from backstory turns this into traits, goals, flaws, and voice."
              />
              {suggestHint && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">{suggestHint}</p>
              )}
            </Card>

            <Card>
              <PersonaEditor key={personaKey} entityId={mainCharacterId} />
            </Card>

            <Card>
              <RelationshipEditor entity={entity} allEntities={allEntities} />
            </Card>
          </div>
        </div>

        {/* Full-width secondary: history + notes */}
        <div className="mt-4 space-y-4">
          <Card>
            <EntityHistory entityId={mainCharacterId} />
          </Card>
          <Card title="Annals">
            <NoteList notes={notes} onChanged={refreshNotes} />
          </Card>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete {entity.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes your main character
              {notes.length > 0 && `, its ${notes.length} note${notes.length === 1 ? '' : 's'}`}, and all
              of its relationships. The campaign will need a new main character. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeriveReview
        pcId={mainCharacterId}
        backstory={savedBackstory}
        campaignEntities={allEntities}
        open={deriveOpen}
        onOpenChange={setDeriveOpen}
        onApplied={() => {
          setLastDerived(savedBackstory) // lock Suggest until the backstory changes
          refresh()
          setPersonaKey((k) => k + 1)
        }}
      />

      {editList && (
        <ListEditDialog
          title={LIST_META[editList].title}
          hint={LIST_META[editList].hint}
          placeholder={LIST_META[editList].placeholder}
          open
          onOpenChange={(o) => {
            if (!o) setEditList(null)
          }}
          value={entity[editList]}
          onSave={(next) => savePromoted(listPatch(editList, next))}
        />
      )}
    </div>
  )
}

type PromotedListKey = 'traits' | 'goals' | 'flaws' | 'voiceExamples'

const LIST_META: Record<PromotedListKey, { title: string; placeholder: string; hint: string }> = {
  traits: {
    title: 'Edit traits',
    placeholder: 'Add a trait — e.g. gruff',
    hint: 'Personality traits that shape how they act.'
  },
  goals: {
    title: 'Edit goals',
    placeholder: 'Add a goal — e.g. protect the town',
    hint: 'What they actively want.'
  },
  flaws: {
    title: 'Edit flaws',
    placeholder: 'A vice, fear, or weakness',
    hint: 'What trips them up — the richest roleplay hooks.'
  },
  voiceExamples: {
    title: 'Edit voice examples',
    placeholder: "A line they'd say",
    hint: 'Lines in their own words — these ground Counsel and Converse.'
  }
}

function listPatch(key: PromotedListKey, next: string[]): UpdateEntityInput {
  switch (key) {
    case 'traits':
      return { traits: next }
    case 'goals':
      return { goals: next }
    case 'flaws':
      return { flaws: next }
    case 'voiceExamples':
      return { voiceExamples: next }
  }
}

// A titled panel. Persona/Ties/History render their own headings, so those cards pass no title.
function Card({
  title,
  action,
  children
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card/40 p-4">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h3 className="inscribed text-xs">{title}</h3> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

// The list cards are READ-ONLY chips (ADR-030 v3) — editing happens in ListEditDialog via the per-card
// Edit button, so each editing session is one batched write (no inline add fields, no save races).
function EditListButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <Pencil className="size-3.5" />
      Edit
    </Button>
  )
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">None yet — use Edit to add.</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <span
          key={`${it}-${i}`}
          className="max-w-full break-words rounded-md bg-muted/60 px-2 py-1 text-xs leading-snug text-foreground"
        >
          {it}
        </span>
      ))}
    </div>
  )
}

// What drafting does + how to get good results (ADR-030 v3) — the workflow is otherwise invisible
// until you trip over the backstory requirement or the re-run lock.
function SuggestInfo() {
  return (
    <InfoPopover label="About Draft from backstory">
      <p className="text-sm font-medium text-foreground">What drafting does</p>
      <p className="text-muted-foreground">
        Reads the backstory and proposes, in two reviewed steps: first this character&apos;s profile —
        description, traits, goals, flaws, voice examples (the persona is rebuilt from what you accept)
        — then world material: new people, places, and factions, notes, and relationship ties, added as
        undated pre-campaign background. Nothing is written until you approve each item.
      </p>
      <p className="text-sm font-medium text-foreground">Get the best results</p>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        <li>Use real names for people, places, and groups.</li>
        <li>State relationships outright — &ldquo;Victor was his mentor.&rdquo;</li>
        <li>Concrete events beat vague vibes.</li>
        <li>Show how the character speaks — it feeds the voice examples.</li>
        <li>Edit the backstory and draft again any time — the button unlocks when it changes.</li>
      </ul>
    </InfoPopover>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 space-y-1 first:mt-0">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

// An inline text/textarea that holds a local draft and saves on blur. Synced from the saved `value`, so an
// external refresh (e.g. after a derive) flows in without clobbering an in-progress edit (the draft only
// re-syncs when the SAVED value actually changes).
function InlineText({
  value,
  onSave,
  placeholder,
  multiline,
  rows
}: {
  value: string
  onSave: (next: string) => void
  placeholder?: string
  multiline?: boolean
  rows?: number
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  const commit = (): void => {
    if (draft !== value) onSave(draft)
  }
  if (multiline) {
    return (
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={rows}
        placeholder={placeholder}
        className="text-sm"
      />
    )
  }
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      placeholder={placeholder}
      className="h-8"
    />
  )
}
