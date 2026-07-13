import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ENTITY_TYPE_LABELS, type Entity } from '@shared/entity-types'
import { ENTITY_TYPE_COLOR, ENTITY_TYPE_ICON } from '@renderer/lib/entity-visuals'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useCampaigns, useEntities } from '@renderer/hooks/use-ledger'
import { NAV_ITEMS } from '@renderer/lib/nav-items'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'

// The global ⌘/Ctrl+K palette (ROADMAP P2-4): jump to any view, find any entity by name, or add an
// entity. The keyboard spine the audit flagged as missing. Reuses the unused CommandDialog primitive and
// the SearchBox navigation (MC → Character page, else the Codex detail pane). Entity matching is cmdk's
// in-memory filter over the campaign's entities (instant, no IPC) — the richer note-content search stays
// on Ctrl+F (SearchBox).
export function CommandPalette({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const requestQuickAddFocus = useUiStore((s) => s.requestQuickAddFocus)
  const { entities } = useEntities(activeCampaignId)
  const { campaigns } = useCampaigns()
  const [search, setSearch] = useState('')

  const mainCharacterId = campaigns.find((c) => c.id === activeCampaignId)?.mainCharacterId ?? null

  function close(): void {
    setSearch('')
    onOpenChange(false)
  }
  function run(action: () => void): void {
    close()
    action()
  }
  function openEntity(e: Entity): void {
    if (e.id === mainCharacterId) setActiveView('character')
    else {
      setSelectedEntity(e.id)
      setActiveView('capture')
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      showCloseButton={false}
      title="Command palette"
      description="Jump to a view or find an entity"
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Jump to a view or find an entity…"
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Go to">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <CommandItem key={key} value={label} onSelect={() => run(() => setActiveView(key))}>
              <Icon className="size-4" />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>

        {activeCampaignId && entities.length > 0 && (
          <CommandGroup heading="Entities">
            {entities.map((e) => {
              const Icon = ENTITY_TYPE_ICON[e.type]
              return (
                <CommandItem
                  key={e.id}
                  value={`${e.name} ${e.id}`}
                  onSelect={() => run(() => openEntity(e))}
                >
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Icon className="size-3" style={{ color: ENTITY_TYPE_COLOR[e.type] }} />
                    {ENTITY_TYPE_LABELS[e.type]}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {activeCampaignId && (
          <CommandGroup heading="Actions">
            <CommandItem value="Add entity" onSelect={() => run(requestQuickAddFocus)}>
              <Plus className="size-4" />
              Add entity
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
