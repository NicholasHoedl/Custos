import { useEffect, useState } from 'react'
import {
  Bug,
  Check,
  DatabaseBackup,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  FolderOpen,
  KeyRound,
  Lightbulb,
  MessagesSquare,
  Palette,
  RefreshCw,
  RotateCw,
  ScrollText,
  Settings
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppSettings } from '@shared/entity-types'
import type { AppInfo, UpdateStatus } from '@shared/ipc-types'
import { AI_FEATURE_LABELS, type AiFeature, type UsageSummary } from '@shared/usage-types'
import { ledger } from '@renderer/lib/ipc'
import { formatUsd } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import { ACCENT_COLORS, ACCENT_META, applyAccent } from '@renderer/lib/accent'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useSettings } from '@renderer/hooks/use-settings'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import { BugReportDialog } from '@renderer/components/BugReportDialog'
import { FeatureRequestDialog } from '@renderer/components/FeatureRequestDialog'
import { PaneBody, PaneHeader, ProgressBar } from '@renderer/components/chrome'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

/** The muted status line beside the "Check for updates" button (P2-1). Empty when there's nothing to say. */
function updateLabel(s: UpdateStatus | null): string {
  switch (s?.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Downloading v${s.version ?? ''}…`
    case 'downloading':
      return `Downloading… ${s.percent ?? 0}%`
    case 'not-available':
      return 'You’re up to date.'
    case 'disabled':
      return s.message ?? 'Updates apply to the installed app.'
    case 'error':
      return s.message ?? 'Update check failed.'
    default:
      return '' // idle, or 'downloaded' (the button already says "Restart to update")
  }
}

export function SettingsView() {
  const { settings, update } = useSettings()
  const { status: onb, progress, downloading, error: modelError, download } = useOnboarding()
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const [keyInput, setKeyInput] = useState('')
  const [keyExists, setKeyExists] = useState(false)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const [importing, setImporting] = useState(false)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [bugOpen, setBugOpen] = useState(false)
  const [featureOpen, setFeatureOpen] = useState(false)

  useEffect(() => {
    ledger.apikey
      .exists()
      .then(setKeyExists)
      .catch((e) => {
        setKeyExists(false)
        toast.error("Couldn't check for a saved key", { description: String(e) })
      })
    // Version + data-folder location for the "Your data" card (P0-3). Silent on failure — the card
    // simply shows without them.
    ledger.app
      .info()
      .then(setAppInfo)
      .catch(() => setAppInfo(null))
    // AI spend totals (P0-4) — refreshed each time Settings mounts.
    ledger.usage
      .summary()
      .then(setUsage)
      .catch(() => setUsage(null))
  }, [])

  // Auto-update status (P2-1): the main process pushes lifecycle events (launch check + manual checks).
  useEffect(() => ledger.onUpdateStatus(setUpdateStatus), [])

  async function backupNow(): Promise<void> {
    if (backingUp) return
    setBackingUp(true)
    try {
      const res = await ledger.app.backupNow()
      if (res.ok) toast.success('Backup written', { description: res.path })
      else toast.error('Backup failed', { description: res.error })
    } catch (err) {
      toast.error('Backup failed', { description: String(err) })
    } finally {
      setBackingUp(false)
    }
  }

  async function importCampaign(): Promise<void> {
    if (importing) return
    setImporting(true)
    try {
      const res = await ledger.campaign.import()
      if (res.ok) {
        useUiStore.getState().bumpCampaigns()
        useAppStore.getState().setActiveCampaign(res.campaignId)
        toast.success(`Imported “${res.name}”`, {
          description: `${res.counts.entities} entities · ${res.counts.notes} notes · ${res.counts.sessions} sessions. Search re-indexes in the background.`
        })
      } else if (!('canceled' in res)) {
        toast.error('Import failed', { description: res.error })
      }
    } catch (err) {
      toast.error('Import failed', { description: String(err) })
    } finally {
      setImporting(false)
    }
  }

  async function saveKey() {
    const k = keyInput.trim()
    if (!k || busy) return
    setBusy(true)
    try {
      await ledger.apikey.set(k)
      setKeyExists(true)
      setKeyInput('')
      const { valid } = await ledger.apikey.validate()
      if (valid) toast.success('API key saved and validated')
      else
        toast.warning('Key saved, but validation failed', {
          description: 'Check the key is correct and that you are online.'
        })
    } catch (err) {
      toast.error('Could not save key', { description: String(err) })
    } finally {
      setBusy(false)
      // Push signal for the spotlight tutorial's apikey step (ADR-059): it validates once per save
      // attempt instead of polling. Bumped in `finally` so a failed set also nudges a re-check.
      useUiStore.getState().bumpKeySaved()
    }
  }

  async function clearKey() {
    try {
      await ledger.apikey.clear()
      setKeyExists(false)
      toast.success('API key removed')
    } catch (err) {
      toast.error('Could not remove key', { description: String(err) })
    }
  }

  async function reindexNotes() {
    setReindexing(true)
    try {
      const n = await ledger.onboarding.reindex()
      toast.success(`Re-indexed ${n} item${n === 1 ? '' : 's'} for search`)
    } catch (err) {
      toast.error('Re-index failed', { description: String(err) })
    } finally {
      setReindexing(false)
    }
  }

  async function exportCampaign() {
    if (!activeCampaignId || exporting) return
    setExporting(true)
    try {
      const res = await ledger.campaign.export(activeCampaignId)
      if (res.ok) {
        toast.success('Campaign exported', {
          description: `${res.counts.entities} entities · ${res.counts.notes} notes · ${res.counts.links} links → ${res.path}`
        })
      } else if ('error' in res) {
        toast.error('Export failed', { description: res.error })
      } // canceled → no toast
    } catch (err) {
      toast.error('Export failed', { description: String(err) })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHeader icon={Settings} title="Settings" />
      <PaneBody size="form" className="gap-8">
        <section className="space-y-3" data-tour="api-key-card">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <h2 className="font-display text-lg font-medium text-foreground">Anthropic API key</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Stored encrypted on this device, your key never leaves your machine except to call
            Anthropic. Don’t have one? Create a key at console.anthropic.com.
          </p>
          {keyExists && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <Check className="size-4 text-primary" />
              <span className="text-foreground">A key is saved.</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={clearKey}>
                Remove
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={show ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-…"
                className="pr-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveKey()
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Toggle key visibility"
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button onClick={saveKey} disabled={!keyInput.trim() || busy}>
              Save &amp; validate
            </Button>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Palette className="size-4 text-primary" />
            <h2 className="font-display text-lg font-medium text-foreground">Accent color</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            The single accent the app uses for focus, active state, and highlights. Ember is the
            default — pick another to re-tint everything.
          </p>
          <div className="flex flex-wrap gap-3">
            {ACCENT_COLORS.map((c) => {
              const active = (settings?.accentColor ?? 'ember') === c
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    applyAccent(c) // live, before the persist round-trip
                    void update({ accentColor: c })
                  }}
                  aria-label={ACCENT_META[c].label}
                  aria-pressed={active}
                  className="group flex flex-col items-center gap-1.5"
                >
                  <span
                    className={cn(
                      'size-9 rounded-full ring-offset-2 ring-offset-background transition',
                      active
                        ? 'ring-2 ring-foreground'
                        : 'ring-1 ring-border group-hover:ring-foreground/40'
                    )}
                    style={{ backgroundColor: ACCENT_META[c].swatch }}
                  />
                  <span
                    className={cn('text-xs', active ? 'text-foreground' : 'text-muted-foreground')}
                  >
                    {ACCENT_META[c].label}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-foreground">Lore model</h2>
          <p className="text-sm text-muted-foreground">
            Powers Lore’s answers and generates character personas. Sonnet is faster and cheaper;
            Opus is the highest quality.
          </p>
          <Select
            value={settings?.recallModel ?? 'claude-sonnet-4-6'}
            onValueChange={(v) => update({ recallModel: v as AppSettings['recallModel'] })}
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (default)</SelectItem>
              <SelectItem value="claude-opus-4-8">Claude Opus 4.8 (highest quality)</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-foreground">Counsel model</h2>
          <p className="text-sm text-muted-foreground">
            The model and reasoning depth behind Counsel and Converse. Opus reasons best; higher
            effort gives richer results but is slower at the table.
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">Model</span>
              <Select
                value={settings?.suggestModel ?? 'claude-opus-4-8'}
                onValueChange={(v) => update({ suggestModel: v as AppSettings['suggestModel'] })}
              >
                <SelectTrigger className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-opus-4-8">Claude Opus 4.8 (default)</SelectItem>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (faster)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">Effort</span>
              <Select
                value={settings?.suggestEffort ?? 'high'}
                onValueChange={(v) => update({ suggestEffort: v as AppSettings['suggestEffort'] })}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High (default)</SelectItem>
                  <SelectItem value="medium">Medium (faster)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-foreground">Extraction model</h2>
          <p className="text-sm text-muted-foreground">
            Reads a session’s chronicle (the Extract tool), pasted notes (Transcribe), and a backstory
            (Draft) to propose entities, notes, and changes for your review. Because you review every
            suggestion before it’s saved, a cheaper model at medium effort loses little.
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">Model</span>
              <Select
                value={settings?.extractionModel ?? 'claude-sonnet-4-6'}
                onValueChange={(v) =>
                  update({ extractionModel: v as AppSettings['extractionModel'] })
                }
              >
                <SelectTrigger className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (default)</SelectItem>
                  <SelectItem value="claude-opus-4-8">Claude Opus 4.8 (highest quality)</SelectItem>
                  <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (cheapest)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">Effort</span>
              <Select
                value={settings?.extractionEffort ?? 'medium'}
                onValueChange={(v) =>
                  update({ extractionEffort: v as AppSettings['extractionEffort'] })
                }
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="medium">Medium (default)</SelectItem>
                  <SelectItem value="high">High (richer)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-foreground">Illuminate model</h2>
          <p className="text-sm text-muted-foreground">
            Powers Illuminate, which enriches an entity with relationships and profile details. It makes
            one call per entity, so it’s the priciest tool — and because you review every proposal, a
            cheaper model keeps costs down without risking bad data. Haiku is the default.
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">Model</span>
              <Select
                value={settings?.illuminateModel ?? 'claude-haiku-4-5'}
                onValueChange={(v) =>
                  update({ illuminateModel: v as AppSettings['illuminateModel'] })
                }
              >
                <SelectTrigger className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (default, cheapest)</SelectItem>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (balanced)</SelectItem>
                  <SelectItem value="claude-opus-4-8">Claude Opus 4.8 (highest quality)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="block text-xs text-muted-foreground">Effort</span>
              <Select
                value={settings?.illuminateEffort ?? 'medium'}
                onValueChange={(v) =>
                  update({ illuminateEffort: v as AppSettings['illuminateEffort'] })
                }
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="medium">Medium (default)</SelectItem>
                  <SelectItem value="high">High (richer)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-foreground">Local search model</h2>
          <p className="text-sm text-muted-foreground">
            Powers semantic search over your notes, used by Lore and Counsel. These models
            (about 225 MB) run entirely on your device — nothing they read ever leaves your machine.
          </p>
          {onb.modelReady ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <Check className="size-4 text-primary" />
              <span className="text-foreground">Model installed.</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={reindexNotes}
                disabled={reindexing}
              >
                {reindexing ? 'Re-indexing…' : 'Re-index notes'}
              </Button>
            </div>
          ) : downloading || progress?.status === 'downloading' ? (
            <ProgressBar progress={progress} />
          ) : (
            <div className="space-y-2">
              {modelError && <p className="text-xs text-destructive">{modelError}</p>}
              <Button size="sm" variant="outline" onClick={download}>
                <Download className="size-4" />
                {modelError ? 'Retry download' : 'Download models (~225 MB)'}
              </Button>
            </div>
          )}
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-foreground">Export &amp; import</h2>
          <p className="text-sm text-muted-foreground">
            Save the active campaign to a JSON file — a portable backup of every entity, note, link,
            session, and event — or import one to move a campaign between machines. Search
            re-indexes automatically after an import.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={exportCampaign}
              disabled={!activeCampaignId || exporting}
            >
              <FileDown className="size-4" />
              {exporting ? 'Exporting…' : 'Export to JSON'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void importCampaign()}
              disabled={importing}
            >
              <FileUp className="size-4" />
              {importing ? 'Importing…' : 'Import from JSON'}
            </Button>
          </div>
          {!activeCampaignId && (
            <p className="text-xs text-muted-foreground">Select a campaign to export.</p>
          )}
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-foreground">Your data</h2>
          <p className="text-sm text-muted-foreground">
            Everything lives on this device. Custos backs up your database at every launch and keeps
            the five most recent snapshots. You can also back up on demand — a good idea before
            anything risky.
          </p>
          {appInfo && (
            <p className="break-all font-mono text-xs text-muted-foreground">{appInfo.dataDir}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void backupNow()}
              disabled={backingUp}
            >
              <DatabaseBackup className="size-4" />
              {backingUp ? 'Backing up…' : 'Back up now'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void ledger.app.openDataFolder()}>
              <FolderOpen className="size-4" />
              Open data folder
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void ledger.app.openLogsFolder()}>
              <ScrollText className="size-4" />
              Open logs
            </Button>
          </div>
          {appInfo && (
            <p className="pt-1 text-xs text-muted-foreground">Custos v{appInfo.version}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {updateStatus?.state === 'downloaded' ? (
              <Button size="sm" variant="outline" onClick={() => void ledger.update.install()}>
                <RotateCw className="size-4" />
                Restart to update{updateStatus.version ? ` (v${updateStatus.version})` : ''}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void ledger.update.check()}
                disabled={
                  updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'
                }
              >
                <RefreshCw
                  className={`size-4 ${
                    updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'
                      ? 'animate-spin'
                      : ''
                  }`}
                />
                Check for updates
              </Button>
            )}
            {updateLabel(updateStatus) && (
              <span className="text-xs text-muted-foreground">{updateLabel(updateStatus)}</span>
            )}
          </div>
        </section>

        <Separator />

        <section className="space-y-3" data-tour="feedback">
          <div className="flex items-center gap-2">
            <MessagesSquare className="size-4 text-primary" />
            <h2 className="font-display text-lg font-medium text-foreground">Feedback</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Something broken, or an idea for a change? Send it straight to the developer — a bug
            report with screenshots and diagnostics, or a feature request.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setBugOpen(true)}>
              <Bug className="size-4" />
              Report a bug…
            </Button>
            <Button size="sm" variant="outline" onClick={() => setFeatureOpen(true)}>
              <Lightbulb className="size-4" />
              Request a feature…
            </Button>
          </div>
          <BugReportDialog open={bugOpen} onOpenChange={setBugOpen} />
          <FeatureRequestDialog open={featureOpen} onOpenChange={setFeatureOpen} />
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-display text-lg font-medium text-foreground">AI usage</h2>
          <p className="text-sm text-muted-foreground">
            An estimate of what you’ve spent on your Anthropic key, tracked locally for each call.
            Anthropic’s bill is the final word — this is here so an Extract or Illuminate run is never a
            surprise.
          </p>
          {usage ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <p className="text-foreground">
                This month ({usage.monthKey}): <strong>{formatUsd(usage.monthUsd)}</strong> across{' '}
                {usage.monthCalls} {usage.monthCalls === 1 ? 'call' : 'calls'}
              </p>
              {Object.entries(usage.byFeature).length > 0 && (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {(
                    Object.entries(usage.byFeature) as [AiFeature, { calls: number; usd: number }][]
                  )
                    .sort((a, b) => b[1].usd - a[1].usd)
                    .map(([feature, f]) => (
                      <li key={feature} className="flex justify-between">
                        <span>{AI_FEATURE_LABELS[feature] ?? feature}</span>
                        <span className="font-mono">
                          {formatUsd(f.usd)} · {f.calls}×
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              <p className="border-t border-border pt-1.5 text-xs text-muted-foreground">
                Lifetime: {formatUsd(usage.lifetimeUsd)} across {usage.lifetimeCalls}{' '}
                {usage.lifetimeCalls === 1 ? 'call' : 'calls'}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No usage recorded yet.</p>
          )}
        </section>
      </PaneBody>
    </div>
  )
}
