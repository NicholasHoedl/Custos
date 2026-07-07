import { useState } from 'react'
import { Check, ChevronDown, ChevronsUpDown, X } from 'lucide-react'
import { ENTITY_TYPE_LABELS } from '@shared/entity-types'
import { SCENE_MODES, SCENE_MODE_LABELS, type SceneMode } from '@shared/scene-types'
import { cn } from '@renderer/lib/utils'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Badge } from '@renderer/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'

const SCENE_NONE = '__none__'

function isOpenQuestStatus(status: string | null): boolean {
  return !status || !['completed', 'failed'].includes(status.toLowerCase())
}

// The "current scene" cluster: the scene mode, where the party is, the time, who's present, who they're
// facing, and the quest in progress. These feed the optional `scene` payload into Recall and Suggest
// (see use-recall / use-suggest). Collapsible to save room; each entity-backed selector hides when its
// list is empty. Collapsing only hides the controls — the selected scene (in app-store) stays active.
export function SceneControls({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(true)
  const scene = useAppStore((s) => s.scene)
  const sceneActive =
    Boolean(scene.locationId) ||
    Boolean(scene.embarkedQuestId) ||
    scene.nearbyPcIds.length > 0 ||
    scene.presentEntityIds.length > 0 ||
    Boolean(scene.sceneMode)
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2"
      >
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Scene
          </span>
          {!open && sceneActive && (
            <span className="size-1.5 rounded-full bg-primary" aria-label="a scene is set" />
          )}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 text-muted-foreground transition-transform',
            !open && '-rotate-90'
          )}
        />
      </button>
      {open && (
        <div className="space-y-1.5">
          <SceneModeSelector />
          <LocationSelector campaignId={campaignId} />
          <EmbarkedQuestSelector campaignId={campaignId} />
          <NearbyPcsSelector campaignId={campaignId} />
          <PresentEntitiesSelector campaignId={campaignId} />
        </div>
      )}
    </div>
  )
}

function LocationSelector({ campaignId }: { campaignId: string }) {
  const { entities: locations } = useEntities(campaignId, 'location')
  const locationId = useAppStore((s) => s.scene.locationId)
  const setSceneLocation = useAppStore((s) => s.setSceneLocation)
  if (locations.length === 0) return null
  return (
    <Select
      value={locationId ?? SCENE_NONE}
      onValueChange={(v) => setSceneLocation(v === SCENE_NONE ? null : v)}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Location" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SCENE_NONE}>No location</SelectItem>
        {locations.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EmbarkedQuestSelector({ campaignId }: { campaignId: string }) {
  const { entities: quests } = useEntities(campaignId, 'quest')
  const embarkedQuestId = useAppStore((s) => s.scene.embarkedQuestId)
  const setEmbarkedQuest = useAppStore((s) => s.setEmbarkedQuest)

  const openQuests = quests.filter((q) => isOpenQuestStatus(q.status))
  // Keep the currently-selected quest visible even if it has since been completed/failed.
  const options =
    embarkedQuestId && !openQuests.some((q) => q.id === embarkedQuestId)
      ? [...openQuests, ...quests.filter((q) => q.id === embarkedQuestId)]
      : openQuests
  if (options.length === 0) return null

  return (
    <Select
      value={embarkedQuestId ?? SCENE_NONE}
      onValueChange={(v) => setEmbarkedQuest(v === SCENE_NONE ? null : v)}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Embarked quest" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SCENE_NONE}>No quest</SelectItem>
        {options.map((q) => (
          <SelectItem key={q.id} value={q.id}>
            {q.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function NearbyPcsSelector({ campaignId }: { campaignId: string }) {
  const { entities: pcs } = useEntities(campaignId, 'pc')
  const activePcId = useAppStore((s) => s.activePcId)
  const nearbyPcIds = useAppStore((s) => s.scene.nearbyPcIds)
  const setNearbyPcs = useAppStore((s) => s.setNearbyPcs)
  const [open, setOpen] = useState(false)

  // The active PC is shown separately, never as "also present".
  const options = pcs.filter((p) => p.id !== activePcId)
  if (options.length === 0) return null

  const selected = new Set(nearbyPcIds)
  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setNearbyPcs(options.filter((p) => next.has(p.id)).map((p) => p.id))
  }
  const selectedPcs = options.filter((p) => selected.has(p.id))
  const label =
    selectedPcs.length === 0
      ? 'Party present'
      : selectedPcs.length === 1
        ? selectedPcs[0].name
        : `${selectedPcs.length} present`

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn(selectedPcs.length === 0 && 'text-muted-foreground')}>{label}</span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search characters…" />
            <CommandList>
              <CommandEmpty>No characters.</CommandEmpty>
              <CommandGroup>
                {options.map((p) => (
                  <CommandItem key={p.id} value={p.name} onSelect={() => toggle(p.id)}>
                    <Check
                      className={cn('size-4', selected.has(p.id) ? 'opacity-100' : 'opacity-0')}
                    />
                    {p.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedPcs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedPcs.map((p) => (
            <Badge key={p.id} variant="secondary" className="gap-1 pr-1">
              {p.name}
              <button
                type="button"
                onClick={() => toggle(p.id)}
                aria-label={`Remove ${p.name}`}
                className="rounded-sm text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function SceneModeSelector() {
  const sceneMode = useAppStore((s) => s.scene.sceneMode)
  const setSceneMode = useAppStore((s) => s.setSceneMode)
  return (
    <Select
      value={sceneMode ?? SCENE_NONE}
      onValueChange={(v) => setSceneMode(v === SCENE_NONE ? null : (v as SceneMode))}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Scene mode" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SCENE_NONE}>Any mode</SelectItem>
        {SCENE_MODES.map((m) => (
          <SelectItem key={m} value={m}>
            {SCENE_MODE_LABELS[m]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Multi-select of the NPCs/factions the party is facing or dealing with — pinned into grounding and
// named in the scene block so advice targets the actual actors. (Adapts NearbyPcsSelector, grouped.)
function PresentEntitiesSelector({ campaignId }: { campaignId: string }) {
  const { entities } = useEntities(campaignId)
  const presentEntityIds = useAppStore((s) => s.scene.presentEntityIds)
  const setPresentEntities = useAppStore((s) => s.setPresentEntities)
  const [open, setOpen] = useState(false)

  const options = entities.filter(
    (e) => e.type === 'npc' || e.type === 'faction' || e.type === 'creature'
  )
  if (options.length === 0) return null

  const selected = new Set(presentEntityIds)
  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPresentEntities(options.filter((e) => next.has(e.id)).map((e) => e.id))
  }
  const chosen = options.filter((e) => selected.has(e.id))
  const label =
    chosen.length === 0
      ? 'In the scene'
      : chosen.length === 1
        ? chosen[0].name
        : `${chosen.length} present`
  const groups = (['npc', 'faction'] as const)
    .map((type) => ({ type, items: options.filter((e) => e.type === type) }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn(chosen.length === 0 && 'text-muted-foreground')}>{label}</span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search NPCs & factions…" />
            <CommandList>
              <CommandEmpty>No NPCs or factions.</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g.type} heading={ENTITY_TYPE_LABELS[g.type]}>
                  {g.items.map((e) => (
                    <CommandItem key={e.id} value={`${e.name} ${e.id}`} onSelect={() => toggle(e.id)}>
                      <Check
                        className={cn('size-4', selected.has(e.id) ? 'opacity-100' : 'opacity-0')}
                      />
                      {e.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chosen.map((e) => (
            <Badge key={e.id} variant="secondary" className="gap-1 pr-1">
              {e.name}
              <button
                type="button"
                onClick={() => toggle(e.id)}
                aria-label={`Remove ${e.name}`}
                className="rounded-sm text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
