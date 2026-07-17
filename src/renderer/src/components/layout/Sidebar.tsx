import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, HelpCircle, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Campaign } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useCampaigns, useEntities } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { NAV_ITEMS, NAV_GROUP_LABELS } from '@renderer/lib/nav-items'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { QuickstartGuide } from '@renderer/components/onboarding/QuickstartGuide'

export function Sidebar() {
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)

  return (
    <aside data-tour="sidebar" className="flex h-full w-64 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-4">
        <BookOpen className="size-5 shrink-0 text-metal" />
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-2xl font-semibold uppercase leading-none tracking-[0.18em] text-metal">
            Custos
          </span>
          {/* A minimalist dictionary gloss — pronunciation + definition (Custos = Latin "keeper"). */}
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground/60">
            ˈkus-tōs · keeper, custodian
          </span>
        </div>
      </div>

      <div className="space-y-2 px-3">
        <CampaignSelector />
        {activeCampaignId && <MainCharacterBadge campaignId={activeCampaignId} />}
        {activeCampaignId && <SearchBox campaignId={activeCampaignId} />}
      </div>

      {/* min-h-0 + overflow-y-auto: on a too-short window the nav scrolls, instead of its content
          (which won't flex-shrink below its natural height) pushing the pinned Guide row off-screen. */}
      <nav className="mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {NAV_ITEMS.flatMap((item, i) => {
          const { key, label, icon: Icon, group } = item
          const prevGroup = NAV_ITEMS[i - 1]?.group
          const active = key === activeView
          const nodes: ReactNode[] = []
          // Emit a section heading before the first item of each group — except Settings (a plain
          // divider) and Home (the single top item, no marker at all — ADR-061).
          if (group !== prevGroup && group !== 'home') {
            nodes.push(
              group === 'settings' ? (
                <div key="settings-sep" className="mt-1 border-t border-border/60 pt-2" />
              ) : (
                <div
                  key={group + '-h'}
                  data-tour={'nav-group-' + group}
                  className="inscribed px-3 pt-2.5 text-xs text-muted-foreground"
                >
                  {NAV_GROUP_LABELS[group]}
                </div>
              )
            )
          }
          nodes.push(
            <button
              key={key}
              data-tour={'nav-' + key}
              onClick={() => setActiveView(key)}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-sidebar-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          )
          return nodes
        })}
      </nav>

      <QuickstartButton />
    </aside>
  )
}

// An out-of-the-way help affordance pinned to the bottom of the sidebar (below the flex-1 nav). Opens the
// always-available Quickstart guide (ADR-045) — the reference the trimmed first-run tutorial points to.
function QuickstartButton() {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1 border-t border-border/60 px-3 py-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-tour="guide"
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <HelpCircle className="size-4" />
            Guide
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Quickstart guide</TooltipContent>
      </Tooltip>
      <QuickstartGuide open={open} onOpenChange={setOpen} />
    </div>
  )
}

// "Report a bug" moved into the Settings page (ADR-060) — its old sidebar slot is gone, and with it the
// window-snap-before-open (from Settings the snap only ever captured Settings, so it was dropped).

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
          <SelectValue placeholder="Select a campaign" />
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
        data-tour="new-campaign"
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
  const [mainCharacterName, setMainCharacterName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setMainCharacterName('')
      setDescription('')
    }
  }, [open])

  async function submit() {
    const trimmed = name.trim()
    const mcName = mainCharacterName.trim()
    // A campaign is created WITH its mandatory main character (ADR-029) — both fields are required.
    if (!trimmed || !mcName || busy) return
    setBusy(true)
    try {
      const campaign = await ledger.campaign.create({
        name: trimmed,
        description: description.trim() || undefined,
        mainCharacterName: mcName
      })
      useUiStore.getState().bumpCampaigns()
      toast.success('Campaign created', { description: trimmed })
      // The MainCharacterBadge reseeds the active-PC lens from the new campaign's main character.
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
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
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
            <Label htmlFor="cc-mc">Main character</Label>
            <Input
              id="cc-mc"
              value={mainCharacterName}
              onChange={(e) => setMainCharacterName(e.target.value)}
              placeholder="Your player character's name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Every campaign has one main character — the hero you play and whose voice the Keeper
              speaks in. You can flesh out their profile afterward.
            </p>
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
          <Button onClick={submit} disabled={!name.trim() || !mainCharacterName.trim() || busy}>
            {busy ? 'Creating…' : 'Create'}
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
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
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
            {busy ? 'Saving…' : 'Save'}
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
      .catch(() => {}) // intentional: the delete dialog's "N entities / M sessions" hint is best-effort
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
      useUiStore.getState().bumpCampaigns()
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
            {busy ? 'Deleting…' : 'Delete campaign'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// The active-session switcher moved to the Chronicle header (components/sessions/SessionControl.tsx,
// ADR-036) — the capture surface the active session actually governs.

// The campaign's MAIN CHARACTER (★) — its single, mandatory protagonist and the ONLY in-character lens.
// A read-only "Playing as X" indicator (ADR-030): it locks the active-PC lens to the main character and
// navigates to the Character page (where the MC is actually set + managed). There is no picker here.
function MainCharacterBadge({ campaignId }: { campaignId: string }) {
  const { entities: pcs } = useEntities(campaignId, 'pc')
  const { campaigns } = useCampaigns()
  const activePcId = useAppStore((s) => s.activePcId)
  const setActivePc = useAppStore((s) => s.setActivePc)
  const setActiveView = useUiStore((s) => s.setActiveView)

  const campaign = campaigns.find((c) => c.id === campaignId)
  const mainCharacterId = campaign?.mainCharacterId ?? null
  const mc = mainCharacterId != null ? pcs.find((p) => p.id === mainCharacterId) : undefined

  // The main character IS the lens: once the CAMPAIGN is loaded, lock the active PC to its
  // main_character_id (null when unset). Keyed off the campaign — NOT the pc list — so a slow entities
  // load can't transiently clear the lens; the FK self-nulls if the MC pc is deleted. Converges (guarded).
  useEffect(() => {
    if (!campaign) return // campaigns not loaded yet — don't touch the lens
    if (activePcId !== mainCharacterId) setActivePc(mainCharacterId)
  }, [campaign, mainCharacterId, activePcId, setActivePc])

  return (
    <button
      type="button"
      onClick={() => setActiveView('character')}
      title="Manage your main character"
      className="flex w-full items-center gap-1.5 rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/60"
    >
      <Star
        className={cn(
          'size-4 shrink-0',
          mc ? 'fill-primary text-primary' : 'text-muted-foreground'
        )}
        aria-hidden
      />
      {mc ? (
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">Playing as </span>
          <span className="font-medium text-foreground">{mc.name}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Set a main character</span>
      )}
    </button>
  )
}
