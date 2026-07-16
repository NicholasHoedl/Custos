import { useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { WELCOME_COPY } from '@renderer/lib/guide-content'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'

/** Step 0 of the spotlight tutorial (ADR-059) — the only full-screen page left: the welcome message
 *  (WELCOME_COPY — placeholder until rewritten) + the user's name. Everything after this happens in the
 *  real app under the Spotlight. Non-skippable: no close, no Esc handler, and the opaque backdrop keeps
 *  the app behind it unreachable (the same shell the old wizard used). */
export function WelcomeCard({ onSubmit }: { onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onSubmit(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="First-run tutorial"
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/98 p-6"
    >
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center gap-2 border-b border-border px-6 py-4">
          <BookOpen className="size-5 text-primary" />
          <span className="font-display text-lg font-semibold text-foreground">
            {WELCOME_COPY.title}
          </span>
        </header>
        <div className="space-y-4 px-6 py-6">
          <p className="text-sm leading-relaxed text-muted-foreground">{WELCOME_COPY.body}</p>
          <div className="space-y-2">
            <Label htmlFor="tut-name">Your name</Label>
            <Input
              id="tut-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
          </div>
        </div>
        <footer className="flex justify-end border-t border-border px-6 py-4">
          <Button onClick={() => void submit()} disabled={!name.trim() || busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Begin
          </Button>
        </footer>
      </div>
    </div>
  )
}
