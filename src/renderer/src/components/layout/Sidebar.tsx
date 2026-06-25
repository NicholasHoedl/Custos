import { useEffect, useState } from 'react'
import { BookOpen, Plus, ScrollText, Search, Settings, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { Campaign, Session } from '@shared/entity-types'
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
        <SelectTrigger className="flex-1">
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

function sessionLabel(s: Session): string {
  const suffix = s.title ? ` · ${s.title}` : s.date ? ` · ${s.date}` : ''
  return `Session ${s.number}${suffix}`
}

function SessionControl({ campaignId }: { campaignId: string }) {
  const { sessions, refresh } = useSessions(campaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const [busy, setBusy] = useState(false)

  // Auto-select the most recent session when none is active (so notes link to a session by default).
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
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
        <SelectTrigger className="flex-1">
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
      <Button
        variant="outline"
        size="icon"
        onClick={newSession}
        disabled={busy}
        aria-label="New session"
      >
        <Plus className="size-4" />
      </Button>
    </div>
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
