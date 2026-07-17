import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, Lightbulb, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { BUG_REPORT_EMAIL, BUG_REPORT_ENDPOINT } from '@shared/ipc-types'
import { ledger } from '@renderer/lib/ipc'
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

/** Auto-send is live once the intake worker URL is baked in (ADR-058); until then this reads and behaves
 *  exactly like the two-step email flow, so an undeployed build changes nothing. */
const AUTO_SEND = BUG_REPORT_ENDPOINT.length > 0

// The in-app feature requester (Settings → Feedback, ADR-064) — a sibling of BugReportDialog that sends a
// DIFFERENT kind of email to the same inbox: a problem + a proposed feature, with a name + optional reply
// email, and NO screenshots or diagnostics. With the intake worker deployed (AUTO_SEND) Submit POSTs it
// (`kind:'feature'`) and it lands as a "[Custos] Feature request" email; otherwise it falls back to a
// prefilled mailto: draft + a revealed request.txt. The main process does the sending; this just reports
// which path ran.
export function FeatureRequestDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [replyTo, setReplyTo] = useState('') // optional, auto-send only; persists across opens like name
  const [problem, setProblem] = useState('')
  const [proposedFeature, setProposedFeature] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ sent: boolean; mailOpened: boolean } | null>(null)

  // Re-seed each open: keep any previously typed name (else prefill from settings.userName).
  useEffect(() => {
    if (!open) return
    setProblem('')
    setProposedFeature('')
    setDone(null)
    ledger.settings
      .get()
      .then((s) => setName((prev) => prev || s.userName?.trim() || ''))
      .catch(() => {})
  }, [open])

  const canSubmit = problem.trim().length > 0 && proposedFeature.trim().length > 0 && !busy

  async function submit(): Promise<void> {
    if (!canSubmit) return
    setBusy(true)
    try {
      const res = await ledger.featurerequest.submit({
        name: name.trim(),
        replyTo: replyTo.trim() || undefined,
        problem: problem.trim(),
        proposedFeature: proposedFeature.trim()
      })
      if (res.ok) setDone({ sent: res.sent, mailOpened: res.mailOpened })
      else toast.error('Could not prepare the request', { description: res.error })
    } catch (err) {
      toast.error('Could not prepare the request', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  /** Fallback when no mail client opens: the same text as request.txt, onto the clipboard. */
  function copyRequest(): void {
    const text = [
      'Custos feature request',
      `From: ${name.trim() || 'anonymous'}`,
      '',
      '--- Problem ---',
      problem.trim(),
      '',
      '--- Proposed feature ---',
      proposedFeature.trim()
    ].join('\n')
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Request copied'))
      .catch((err) => toast.error('Copy failed', { description: String(err) }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Request a feature</DialogTitle>
          <DialogDescription>
            {AUTO_SEND
              ? 'Pressing Send delivers your idea straight to the developer.'
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
                    <p className="font-medium text-foreground">Request sent — thank you</p>
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
                        Your email draft is open with your request in it — just send it. (A copy also
                        opened in a folder beside it, in case you need it.)
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        Couldn’t open your email app. Copy the request below and send it to{' '}
                        <span className="font-mono text-foreground">{BUG_REPORT_EMAIL}</span>.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {!done.sent && (
                <Button variant="outline" size="sm" onClick={copyRequest}>
                  <Copy className="size-3.5" />
                  Copy request text
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
                <Label htmlFor="fr-name">Your name</Label>
                <Input
                  id="fr-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="So I know who to thank (optional)"
                />
              </div>
              {AUTO_SEND && (
                <div className="space-y-1.5">
                  <Label htmlFor="fr-email">Your email</Label>
                  <Input
                    id="fr-email"
                    type="email"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    placeholder="Only if you’d like a reply (optional)"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="fr-problem">What problem are you facing?</Label>
                <Textarea
                  id="fr-problem"
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="The friction or limitation you keep running into."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fr-feature">What would you like to see?</Label>
                <Textarea
                  id="fr-feature"
                  value={proposedFeature}
                  onChange={(e) => setProposedFeature(e.target.value)}
                  rows={4}
                  placeholder="The feature or change you think would address it."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                <Lightbulb className="size-3.5" />
                {busy
                  ? AUTO_SEND
                    ? 'Sending…'
                    : 'Preparing…'
                  : AUTO_SEND
                    ? 'Send request'
                    : 'Open email draft'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
