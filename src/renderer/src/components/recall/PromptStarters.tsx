import { useMemo, useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import type { Entity } from '@shared/entity-types'
import { RECALL_PROMPTS, type PromptSlot, type RecallPrompt } from '@renderer/lib/recall-prompts'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { EntityPicker } from '@renderer/components/entities/EntityPicker'

/**
 * Lore "prebuilt prompts": a compact dropdown of madlib-style query templates. Templates with blanks open
 * a slot-form dialog (one type-constrained EntityPicker per slot); confirming assembles the sentence and
 * hands it to `onUse` (which fills the Lore box — it does NOT submit). A zero-slot template fills in one
 * click. Renderer-only; assembling reuses the pure `recall-prompts` catalog.
 */
export function PromptStarters({
  entities,
  onUse
}: {
  entities: Entity[]
  onUse: (query: string) => void
}) {
  const [activePrompt, setActivePrompt] = useState<RecallPrompt | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({}) // slot id -> entity id
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities])

  const entitiesForSlot = (s: PromptSlot): Entity[] =>
    s.types === null ? entities : entities.filter((e) => s.types!.includes(e.type))

  /** A template is offerable only if every slot has at least one matching entity (a zero-slot one always is). */
  const canFill = (p: RecallPrompt): boolean => p.slots.every((s) => entitiesForSlot(s).length > 0)

  function choose(p: RecallPrompt): void {
    if (p.slots.length === 0) {
      onUse(p.assemble({})) // canned campaign-wide question — no blanks to fill
      return
    }
    setPicked({})
    setActivePrompt(p)
  }

  function close(): void {
    setActivePrompt(null)
    setPicked({})
  }

  // Live preview: filled slots show the entity name, unfilled show a "[Label]" placeholder.
  const preview = activePrompt
    ? activePrompt.assemble(
        Object.fromEntries(
          activePrompt.slots.map((s) => {
            const name = picked[s.id] ? byId.get(picked[s.id])?.name : undefined
            return [s.id, name ?? `[${s.label}]`]
          })
        )
      )
    : ''

  const allFilled = activePrompt
    ? activePrompt.slots.every((s) => {
        const id = picked[s.id]
        return id != null && entitiesForSlot(s).some((e) => e.id === id)
      })
    : false

  function confirm(): void {
    if (!activePrompt || !allFilled) return
    const values = Object.fromEntries(
      activePrompt.slots.map((s) => [s.id, byId.get(picked[s.id])!.name])
    )
    onUse(activePrompt.assemble(values))
    close()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Sparkles className="size-3.5 text-muted-foreground" />
            Prompts
            <ChevronDown className="size-3.5 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {RECALL_PROMPTS.map((p) => (
            <DropdownMenuItem
              key={p.id}
              disabled={!canFill(p)}
              // Let the menu close first, then open the dialog next tick (avoids a Radix focus race).
              onSelect={() => queueMicrotask(() => choose(p))}
            >
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={activePrompt !== null} onOpenChange={(o) => !o && close()}>
        {activePrompt && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{activePrompt.label}</DialogTitle>
              {activePrompt.description && (
                <DialogDescription>{activePrompt.description}</DialogDescription>
              )}
            </DialogHeader>

            <div className="space-y-3">
              {activePrompt.slots.map((slot) => {
                const options = entitiesForSlot(slot)
                return (
                  <div key={slot.id} className="space-y-1.5">
                    <Label>{slot.label}</Label>
                    <EntityPicker
                      entities={options}
                      value={picked[slot.id] ?? null}
                      onChange={(id) => setPicked((prev) => ({ ...prev, [slot.id]: id }))}
                      placeholder={`Choose ${slot.label.toLowerCase()}…`}
                      searchPlaceholder="Search entities…"
                      emptyText="No matching entities."
                      // Single-type slots don't need type headings; multi-type / any slots do.
                      groupByType={slot.types === null || slot.types.length > 1}
                    />
                    {options.length === 0 && (
                      <p className="text-xs text-muted-foreground">No matching entities yet.</p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground/90">
              {preview}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button disabled={!allFilled} onClick={confirm}>
                Use prompt
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
