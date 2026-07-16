import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Copy, ImagePlus, Mail, X } from 'lucide-react'
import { toast } from 'sonner'
import { BUG_REPORT_EMAIL, BUG_REPORT_ENDPOINT } from '@shared/ipc-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
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

/** Cap the attachments — a handful of shots is plenty, and each crosses the IPC bridge as base64. */
const MAX_SHOTS = 5

/** Auto-send is live once the intake worker URL is baked in (ADR-058); until then the dialog reads and
 *  behaves exactly like the two-step email flow, so an undeployed build changes nothing. */
const AUTO_SEND = BUG_REPORT_ENDPOINT.length > 0

// The in-app bug reporter (launched from the Settings page's "Report a bug" section, ADR-060). Collects
// name + optional reply email + description + screenshots, and silently attaches diagnostics. With the
// intake worker deployed (AUTO_SEND, ADR-058) Submit POSTs the report and it lands in the dev inbox as
// an email; otherwise — or on any send failure — it falls back to ADR-057's two-step flow (bundle +
// prefilled mailto: draft + revealed folder). The main process does the sending; the dialog just reports
// which path ran. (The old sidebar launcher's window-snap-before-open was dropped with the move —
// screenshots are attached by hand via paste/drag/picker.)
export function BugReportDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activeView = useUiStore((s) => s.activeView)
  const [name, setName] = useState('')
  const [replyTo, setReplyTo] = useState('') // optional, auto-send only; persists across opens like name
  const [description, setDescription] = useState('')
  const [screenshots, setScreenshots] = useState<string[]>([])
  const [diagnostics, setDiagnostics] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ sent: boolean; mailOpened: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /** The in-flight silent gather — awaited at submit so a fast submitter never loses the block. */
  const diagPromise = useRef<Promise<string> | null>(null)

  // Re-seed each open: keep any previously typed name (else prefill from settings.userName) and gather
  // a fresh diagnostics block. The deps beyond `open` are stable while the modal is up.
  useEffect(() => {
    if (!open) return
    setDescription('')
    setScreenshots([])
    setDone(null)
    ledger.settings
      .get()
      .then((s) => setName((prev) => prev || s.userName?.trim() || ''))
      .catch(() => {})
    // Diagnostics are gathered + attached SILENTLY — no in-dialog section (deliberate). The tester
    // still sees the full text in the revealed bundle's report.txt, and nothing sends until they do.
    const gather = ledger.bugreport
      .diagnostics(activeCampaignId, activeView)
      .catch((err) => `(could not gather diagnostics: ${String(err)})`)
    diagPromise.current = gather
    void gather.then(setDiagnostics)
  }, [open, activeCampaignId, activeView])

  function addFiles(files: File[]): void {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const url = reader.result
          setScreenshots((prev) => (prev.length >= MAX_SHOTS ? prev : [...prev, url]))
        }
      }
      reader.readAsDataURL(f)
    }
  }

  const canSubmit = description.trim().length > 0 && !busy

  async function submit(): Promise<void> {
    if (!canSubmit) return
    setBusy(true)
    try {
      // Await the silent gather so a fast submit never loses the diagnostics block.
      const diag = diagPromise.current ? await diagPromise.current : diagnostics
      const res = await ledger.bugreport.submit({
        name: name.trim(),
        replyTo: replyTo.trim() || undefined,
        description: description.trim(),
        diagnostics: diag || null,
        screenshots
      })
      if (res.ok) setDone({ sent: res.sent, mailOpened: res.mailOpened })
      else toast.error('Could not prepare the report', { description: res.error })
    } catch (err) {
      toast.error('Could not prepare the report', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  /** Fallback when no mail client opens: the same text as report.txt, onto the clipboard. */
  function copyReport(): void {
    const parts = ['Custos bug report', `From: ${name.trim() || 'anonymous'}`, '', description.trim()]
    if (diagnostics) parts.push('', '--- Diagnostics ---', diagnostics)
    navigator.clipboard
      .writeText(parts.join('\n'))
      .then(() => toast.success('Report copied'))
      .catch((err) => toast.error('Copy failed', { description: String(err) }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.items)
            .filter((i) => i.type.startsWith('image/'))
            .map((i) => i.getAsFile())
            .filter((f): f is File => f !== null)
          if (files.length > 0) addFiles(files)
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Report a bug</DialogTitle>
          <DialogDescription>
            {AUTO_SEND
              ? 'Pressing Send delivers this report — screenshots and diagnostics included — straight to the developer.'
              : 'Goes straight to the developer by email — nothing leaves this machine until you press send in your mail app.'}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              {done.sent ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
              ) : (
                <Mail className="mt-0.5 size-5 shrink-0 text-primary" />
              )}
              <div className="space-y-1 text-sm">
                {done.sent ? (
                  <>
                    <p className="font-medium text-foreground">Report sent — thank you</p>
                    <p className="text-muted-foreground">
                      It’s on its way to the developer
                      {replyTo.trim() ? ' — if a reply is needed, it’ll go to the address you gave' : ''}
                      .
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-foreground">One last step — send the email</p>
                    {done.mailOpened ? (
                      <p className="text-muted-foreground">
                        Your email draft is open, and the folder with your report just opened beside
                        it. Drag <span className="font-mono">report.txt</span>
                        {screenshots.length > 0 ? ' and the screenshots' : ''} into the email, then
                        send it.
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        Couldn’t open your email app. Copy the report below and send it (plus the
                        files in the folder that just opened) to{' '}
                        <span className="font-mono text-foreground">{BUG_REPORT_EMAIL}</span>.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {!done.sent && (
                <Button variant="outline" size="sm" onClick={copyReport}>
                  <Copy className="size-3.5" />
                  Copy report text
                </Button>
              )}
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
              <div className="space-y-1.5">
                <Label htmlFor="br-name">Your name</Label>
                <Input
                  id="br-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="So I know who to thank (optional)"
                />
              </div>
              {AUTO_SEND && (
                <div className="space-y-1.5">
                  <Label htmlFor="br-email">Your email</Label>
                  <Input
                    id="br-email"
                    type="email"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    placeholder="Only if you’d like a reply (optional)"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="br-desc">What went wrong?</Label>
                <Textarea
                  id="br-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  autoFocus
                  placeholder="What happened — and what were you doing right before? The more detail, the better."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Screenshots</Label>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    addFiles(Array.from(e.dataTransfer.files))
                  }}
                  className="flex min-h-20 flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 p-2"
                >
                  {screenshots.map((s, i) => (
                    <div key={i} className="group relative">
                      <img
                        src={s}
                        alt={`Screenshot ${i + 1}`}
                        className="h-16 w-24 rounded border border-border object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Remove screenshot ${i + 1}`}
                        onClick={() => setScreenshots((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  {screenshots.length < MAX_SHOTS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-16 text-muted-foreground"
                      onClick={() => fileRef.current?.click()}
                    >
                      <ImagePlus className="size-4" />
                      Add image
                    </Button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) addFiles(Array.from(e.target.files))
                      e.target.value = ''
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste (Ctrl+V), drag images in, or add files — a screenshot of the problem helps a
                  lot.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                <Mail className="size-3.5" />
                {busy
                  ? AUTO_SEND
                    ? 'Sending…'
                    : 'Preparing…'
                  : AUTO_SEND
                    ? 'Send report'
                    : 'Open email draft'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
