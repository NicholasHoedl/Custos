import { useState } from 'react'
import { toast } from 'sonner'
import type { Entity } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/store/ui-store'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { EntityPicker } from './EntityPicker'

// Merge one duplicate entity into another (ROADMAP P1-6, re-point only). The CURRENT entity is the loser
// — its notes, relationships, chronology, and event refs move onto the chosen survivor, then it's
// deleted. The repair path for duplicates that slip past extraction dedup (ADR-031).
export function MergeEntityDialog({
  loser,
  allEntities,
  open,
  onOpenChange,
  onMerged
}: {
  loser: Entity
  allEntities: Entity[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onMerged: (survivorId: string) => void
}) {
  const [survivorId, setSurvivorId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const candidates = allEntities.filter((e) => e.id !== loser.id)
  const survivor = candidates.find((e) => e.id === survivorId) ?? null

  async function merge(): Promise<void> {
    if (!survivorId || busy) return
    setBusy(true)
    try {
      const kept = await ledger.entity.merge(survivorId, loser.id)
      useUiStore.getState().bumpEntities()
      toast.success('Merged', { description: `${loser.name} → ${kept.name}` })
      onMerged(survivorId)
    } catch (err) {
      toast.error('Could not merge', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Merge {loser.name}</DialogTitle>
          <DialogDescription>
            Move {loser.name}’s notes, relationships, and history onto another entity, then delete{' '}
            {loser.name}. Its own description and traits are discarded. This can’t be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Merge into</span>
          <EntityPicker
            entities={candidates}
            value={survivorId}
            onChange={setSurvivorId}
            placeholder="Choose the entity to keep…"
            searchPlaceholder="Search entities…"
          />
          {survivor && survivor.type !== loser.type && (
            <p className="text-xs text-metal">
              Note: {survivor.name} is a different kind ({survivor.type}) than {loser.name} (
              {loser.type}).
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void merge()}
            disabled={!survivorId || busy}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {busy ? 'Merging…' : `Merge into ${survivor?.name ?? '…'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
