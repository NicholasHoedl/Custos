import { useEffect, useState } from 'react'
import { Check, Download, Eye, EyeOff, FileDown, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import type { AppSettings } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useSettings } from '@renderer/hooks/use-settings'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import { PaneHeader, PaneShell, ProgressBar } from '@renderer/components/chrome'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

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

  useEffect(() => {
    ledger.apikey
      .exists()
      .then(setKeyExists)
      .catch((e) => {
        setKeyExists(false)
        toast.error("Couldn't check for a saved key", { description: String(e) })
      })
  }, [])

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
    <PaneShell size="form" scroll className="gap-8">
      <PaneHeader title="Settings" size="lg" description="API key, model, and preferences." />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <h2 className="font-display text-lg font-medium text-foreground">Anthropic API key</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Stored encrypted on this device — it never leaves your machine except to call Anthropic. Get
          one at console.anthropic.com.
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
        <h2 className="font-display text-lg font-medium text-foreground">Recall model</h2>
        <p className="text-sm text-muted-foreground">
          Sonnet is faster and cheaper; Opus is the highest quality.
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
        <h2 className="font-display text-lg font-medium text-foreground">Suggest</h2>
        <p className="text-sm text-muted-foreground">
          The model and reasoning depth used to suggest in-character actions. Opus reasons best; higher
          effort is richer but slower at the table.
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
        <h2 className="font-display text-lg font-medium text-foreground">Local search model</h2>
        <p className="text-sm text-muted-foreground">
          A small embedding model (~30 MB) powers semantic search. It runs entirely on your device.
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
              {modelError ? 'Retry download' : 'Download model (~30 MB)'}
            </Button>
          </div>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-foreground">Export campaign</h2>
        <p className="text-sm text-muted-foreground">
          Save the active campaign to a JSON file — a portable backup of every entity, note, link,
          session, and event. (Search embeddings are omitted; they rebuild automatically on load.)
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={exportCampaign}
          disabled={!activeCampaignId || exporting}
        >
          <FileDown className="size-4" />
          {exporting ? 'Exporting…' : 'Export to JSON'}
        </Button>
        {!activeCampaignId && (
          <p className="text-xs text-muted-foreground">Select a campaign first.</p>
        )}
      </section>
    </PaneShell>
  )
}
