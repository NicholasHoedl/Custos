import { useEffect, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronsUpDown,
  MoreHorizontal,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { ENTITY_TYPE_LABELS, type Campaign, type Session } from '@shared/entity-types'
import {
  SCENE_MODES,
  SCENE_MODE_LABELS,
  TIMES_OF_DAY,
  TIME_OF_DAY_LABELS,
  type SceneMode,
  type TimeOfDay
} from '@shared/scene-types'
import { ledger } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useCampaigns, useEntities, useSessions } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore, type ViewKey } from '@renderer/store/ui-store'
import { SearchBox } from '@renderer/components/capture/SearchBox'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

const NAV: { key: ViewKey; label: string; icon: typeof ScrollText }[] = [
  { key: 'capture', label: 'Capture', icon: ScrollText },
  { key: 'recall', label: 'Recall', icon: Search },
  { key: 'suggest', label: 'Suggest', icon: Sparkles },
  { key: 'settings', label: 'Settings', icon: Settings }
]

export function Sidebar() {
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <BookOpen className="size-5 text-primary" />
        <span className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Ledger
        </span>
      </div>

      <div className="space-y-2 px-3">
        <CampaignSelector />
        {activeCampaignId && <SessionControl campaignId={activeCampaignId} />}
        {activeCampaignId && <ActivePcSelector campaignId={activeCampaignId} />}
        {activeCampaignId && <SceneControls campaignId={activeCampaignId} />}
        {activeCampaignId && <SearchBox campaignId={activeCampaignId} />}
      </div>

      <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = key === activeView
          return (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-sidebar-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="px-5 py-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Phase 1 · capture
        </span>
      </div>
    </aside>
  )
}

function CampaignSelector() {
  const { campaigns, refresh } = useCampaigns()
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveCampaign = useAppStore((s) => s.setActiveCampaign)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const activeCampaign = campaigns.find((c) => c.id === activeCampaignId) ?? null

  // If the persisted campaign no longer exists, clear the stale selection once campaigns load.
  useEffect(() => {
    if (
      activeCampaignId &&
      campaigns.length > 0 &&
      !campaigns.some((c) => c.id === activeCampaignId)
    ) {
      setActiveCampaign(null)
    }
  }, [campaigns, activeCampaignId, setActiveCampaign])

  return (
    <div className="flex items-center gap-1.5">
      <Select value={activeCampaignId ?? ''} onValueChange={(v) => setActiveCampaign(v)}>
        <SelectTrigger className="min-w-0 flex-1">
          <SelectValue placeholder="Select campaign" />
        </SelectTrigger>
        <SelectContent>
          {campaigns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {activeCampaign && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Campaign actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setCreateOpen(true)}
        aria-label="New campaign"
      >
        <Plus className="size-4" />
      </Button>
      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(c) => {
          refresh()
          setActiveCampaign(c.id)
        }}
      />
      {activeCampaign && (
        <>
          <EditCampaignDialog
            campaign={activeCampaign}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSaved={refresh}
          />
          <DeleteCampaignDialog
            campaign={activeCampaign}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={() => {
              setActiveCampaign(null)
              refresh()
            }}
          />
        </>
      )}
    </div>
  )
}

function CreateCampaignDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (campaign: Campaign) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
    }
  }, [open])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const campaign = await ledger.campaign.create({
        name: trimmed,
        description: description.trim() || undefined
      })
      toast.success('Campaign created', { description: trimmed })
      onCreated(campaign)
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not create campaign', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">New campaign</DialogTitle>
          <DialogDescription>Start a new campaign to track its story.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">Name</Label>
            <Input
              id="cc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-desc">Description (optional)</Label>
            <Textarea
              id="cc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditCampaignDialog({
  campaign,
  open,
  onOpenChange,
  onSaved
}: {
  campaign: Campaign
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState(campaign.name)
  const [description, setDescription] = useState(campaign.description ?? '')
  const [busy, setBusy] = useState(false)

  // Re-seed the fields from the campaign each time the dialog opens (it stays mounted between opens).
  useEffect(() => {
    if (open) {
      setName(campaign.name)
      setDescription(campaign.description ?? '')
    }
  }, [open, campaign])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await ledger.campaign.update(campaign.id, {
        name: trimmed,
        description: description.trim() || null
      })
      toast.success('Campaign updated', { description: trimmed })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not update campaign', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit campaign</DialogTitle>
          <DialogDescription>Rename this campaign or update its description.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ec-name">Name</Label>
            <Input
              id="ec-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ec-desc">Description (optional)</Label>
            <Textarea
              id="ec-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteCampaignDialog({
  campaign,
  open,
  onOpenChange,
  onDeleted
}: {
  campaign: Campaign
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const [confirm, setConfirm] = useState('')
  const [counts, setCounts] = useState<{ entities: number; sessions: number } | null>(null)
  const [busy, setBusy] = useState(false)

  // Load what's at stake (entity/session counts) so the warning is concrete; reset on close.
  useEffect(() => {
    if (!open) {
      setConfirm('')
      setCounts(null)
      return
    }
    let alive = true
    Promise.all([ledger.entity.list(campaign.id), ledger.session.list(campaign.id)])
      .then(([entities, sessions]) => {
        if (alive) setCounts({ entities: entities.length, sessions: sessions.length })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open, campaign.id])

  const match = confirm.trim() === campaign.name

  async function doDelete() {
    if (!match || busy) return
    setBusy(true)
    try {
      await ledger.campaign.delete(campaign.id)
      toast.success('Campaign deleted', { description: campaign.name })
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error('Could not delete campaign', { description: String(err) })
      setBusy(false) // keep the dialog open so the typed confirmation isn't lost
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Delete {campaign.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the entire campaign
            {counts
              ? ` — all ${counts.entities} ${counts.entities === 1 ? 'entity' : 'entities'}, ${counts.sessions} ${counts.sessions === 1 ? 'session' : 'sessions'}, and every note, relationship, and AI persona within it`
              : ', including all its entities, notes, relationships, sessions, and AI personas'}
            . This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dc-confirm">
            Type <span className="font-medium text-foreground">{campaign.name}</span> to confirm
          </Label>
          <Input
            id="dc-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoFocus
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && match) {
                e.preventDefault()
                doDelete()
              }
            }}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={doDelete} disabled={!match || busy}>
            Delete campaign
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function sessionLabel(s: Session): string {
  const suffix = s.title ? ` · ${s.title}` : s.date ? ` · ${s.date}` : ''
  return `Session ${s.number}${suffix}`
}

function SessionControl({ campaignId }: { campaignId: string }) {
  const { sessions, refresh } = useSessions(campaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  // Auto-select the most recent session whenever the active one isn't a valid session in this campaign
  // — covers first load (none active) and recovery after the active session is deleted.
  useEffect(() => {
    if (sessions.length > 0 && !sessions.some((s) => s.id === activeSessionId)) {
      const latest = sessions.reduce((a, b) => (a.number >= b.number ? a : b))
      setActiveSession(latest.id)
    }
  }, [sessions, activeSessionId, setActiveSession])

  async function newSession() {
    if (busy) return
    setBusy(true)
    try {
      const session = await ledger.session.create({ campaignId })
      refresh()
      setActiveSession(session.id)
      toast.success(`Session ${session.number} started`)
    } catch (err) {
      toast.error('Could not start session', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={activeSessionId ?? ''}
        onValueChange={setActiveSession}
        disabled={sessions.length === 0}
      >
        <SelectTrigger className="min-w-0 flex-1">
          <SelectValue placeholder="No sessions" />
        </SelectTrigger>
        <SelectContent>
          {[...sessions]
            .sort((a, b) => b.number - a.number)
            .map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {sessionLabel(s)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {activeSession && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Session actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        variant="outline"
        size="icon"
        onClick={newSession}
        disabled={busy}
        aria-label="New session"
      >
        <Plus className="size-4" />
      </Button>
      {activeSession && (
        <>
          <EditSessionDialog
            session={activeSession}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSaved={refresh}
          />
          <DeleteSessionDialog
            session={activeSession}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={() => {
              setActiveSession(null) // the auto-select effect re-picks the latest remaining session
              refresh()
            }}
          />
        </>
      )}
    </div>
  )
}

function EditSessionDialog({
  session,
  open,
  onOpenChange,
  onSaved
}: {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(session.title ?? '')
  const [date, setDate] = useState(session.date ?? '')
  const [summary, setSummary] = useState(session.summary ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(session.title ?? '')
      setDate(session.date ?? '')
      setSummary(session.summary ?? '')
    }
  }, [open, session])

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      await ledger.session.update(session.id, {
        title: title.trim() || null,
        date: date.trim() || null,
        summary: summary.trim() || null
      })
      toast.success(`Session ${session.number} updated`)
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not update session', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit session {session.number}</DialogTitle>
          <DialogDescription>Update this session’s title, date, or summary.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="es-title">Title (optional)</Label>
            <Input
              id="es-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-date">Date (optional)</Label>
            <Input
              id="es-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-summary">Summary (optional)</Label>
            <Textarea
              id="es-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteSessionDialog({
  session,
  open,
  onOpenChange,
  onDeleted
}: {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function doDelete() {
    if (busy) return
    setBusy(true)
    try {
      await ledger.session.delete(session.id)
      toast.success(`Session ${session.number} deleted`)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error('Could not delete session', { description: String(err) })
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Delete session {session.number}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the session and its event-log entries. Notes captured during it are kept, but
            they’ll no longer be linked to a session. This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={doDelete} disabled={busy}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ActivePcSelector({ campaignId }: { campaignId: string }) {
  const { entities: pcs } = useEntities(campaignId, 'pc')
  const activePcId = useAppStore((s) => s.activePcId)
  const setActivePc = useAppStore((s) => s.setActivePc)

  if (pcs.length === 0) return null

  return (
    <Select value={activePcId ?? ''} onValueChange={setActivePc}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Active character" />
      </SelectTrigger>
      <SelectContent>
        {pcs.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const SCENE_NONE = '__none__'

function isOpenQuestStatus(status: string | null): boolean {
  return !status || !['completed', 'failed'].includes(status.toLowerCase())
}

// The "current scene" cluster: the scene mode, where the party is, the time, who's present, who they're
// facing, and the quest in progress. These feed the optional `scene` payload into Recall and Suggest
// (see use-recall / use-suggest). Collapsible to save room; each entity-backed selector hides when its
// list is empty. Collapsing only hides the controls — the selected scene (in app-store) stays active.
function SceneControls({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(true)
  const scene = useAppStore((s) => s.scene)
  const sceneActive =
    Boolean(scene.locationId) ||
    Boolean(scene.embarkedQuestId) ||
    scene.nearbyPcIds.length > 0 ||
    scene.presentEntityIds.length > 0 ||
    Boolean(scene.sceneMode) ||
    Boolean(scene.timeOfDay)
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
          <TimeOfDaySelector />
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

function TimeOfDaySelector() {
  const timeOfDay = useAppStore((s) => s.scene.timeOfDay)
  const setTimeOfDay = useAppStore((s) => s.setTimeOfDay)
  return (
    <Select
      value={timeOfDay ?? SCENE_NONE}
      onValueChange={(v) => setTimeOfDay(v === SCENE_NONE ? null : (v as TimeOfDay))}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Time of day" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SCENE_NONE}>Any time</SelectItem>
        {TIMES_OF_DAY.map((t) => (
          <SelectItem key={t} value={t}>
            {TIME_OF_DAY_LABELS[t]}
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

  const options = entities.filter((e) => e.type === 'npc' || e.type === 'faction')
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
