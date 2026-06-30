import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type Entity,
  type EntityType
} from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useUiStore } from '@renderer/store/ui-store'

interface QuickAddBarProps {
  campaignId: string
  sessionId: string | null
  onCreated: (entity: Entity) => void
}

// The fast keyboard path for live play: name → type → optional first note, Enter to save (<10s).
// Refocuses itself after each add and on the global hotkey / Ctrl+K (via the quickAddNonce bump).
export function QuickAddBar({ campaignId, sessionId, onCreated }: QuickAddBarProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<EntityType>('npc')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const quickAddNonce = useUiStore((s) => s.quickAddNonce)

  useEffect(() => {
    nameRef.current?.focus()
  }, [quickAddNonce])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const entity = await ledger.entity.create({ campaignId, type, name: trimmed })
      if (note.trim()) {
        await ledger.note.create({
          entityIds: [entity.id],
          sessionId: sessionId ?? undefined,
          content: note.trim()
        })
      }
      useUiStore.getState().bumpEntities() // make the new entity appear in every list immediately
      toast.success(`Added ${ENTITY_TYPE_LABELS[type]}`, { description: trimmed })
      setName('')
      setNote('')
      onCreated(entity)
      nameRef.current?.focus()
    } catch (err) {
      toast.error('Could not save', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 p-2 shadow-sm">
      <Input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="Quick add — name a person, place, or thing…"
        className="flex-1"
      />
      <Select value={type} onValueChange={(v) => setType(v as EntityType)}>
        <SelectTrigger className="w-[150px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ENTITY_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {ENTITY_TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="First note (optional)"
        className="flex-1"
      />
      <Button onClick={submit} disabled={!name.trim() || busy} className="shrink-0">
        <Plus className="size-4" />
        Add
      </Button>
    </div>
  )
}
