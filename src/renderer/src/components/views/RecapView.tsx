import { useEffect, useState } from 'react'
import { AlertTriangle, BookText, KeyRound, RotateCcw, Sparkles, WifiOff } from 'lucide-react'
import type { RecapReason } from '@shared/recap-types'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useSessions } from '@renderer/hooks/use-ledger'
import { useRecap } from '@renderer/hooks/use-recap'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Banner, PaneHeader, PaneShell, SetupCard } from '@renderer/components/chrome'

// "Previously on…" — generate a neutral recap of a chosen session, grounded in that session's beats and
// notes, streamed in and saved to the session's summary. Lives as a Capture pane (like Notes).
export function RecapView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb } = useOnboarding()
  const { sessions, refresh } = useSessions(activeCampaignId)
  const recap = useRecap()
  // The picked session lives in the app store so it survives switching panes (e.g. Recap → Capture
  // and back while working through a backlog of recaps).
  const sessionId = useAppStore((s) => s.recapSessionId)
  const setRecapSession = useAppStore((s) => s.setRecapSession)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Default to the newest session once the list loads (sessions come back newest-first), and recover
  // if the remembered session no longer exists (deleted).
  useEffect(() => {
    if (sessions.length && (!sessionId || !sessions.some((s) => s.id === sessionId))) {
      setRecapSession(sessions[0].id)
    }
  }, [sessions, sessionId, setRecapSession])

  // After a successful save, refresh the list so the stored summary is reflected in the picker state.
  useEffect(() => {
    if (recap.status === 'done' && recap.reason === 'ok') refresh()
  }, [recap.status, recap.reason, refresh])

  const selected = sessions.find((s) => s.id === sessionId) ?? null
  const streaming = recap.status === 'streaming'

  function pick(id: string) {
    setRecapSession(id)
    recap.reset()
  }

  function onGenerate() {
    if (!sessionId || streaming) return
    if (selected?.summary) setConfirmOpen(true)
    else recap.generate(sessionId)
  }

  if (!onb.keyReady) {
    return (
      <PaneShell size="form">
        <SetupCard
          title="Add your API key to generate recaps"
          body="Recap uses Claude to summarize a session — add a key to enable it."
          action={
            <Button size="sm" variant="outline" onClick={() => setActiveView('settings')}>
              Open Settings
            </Button>
          }
        />
      </PaneShell>
    )
  }

  if (sessions.length === 0) {
    return (
      <Centered
        title="No sessions yet"
        body="Start a session in the log, then come back to recap it."
      />
    )
  }

  // The pane shows the freshly streamed recap when there is one; otherwise the saved summary (if any).
  const body = recap.recap || (recap.status === 'idle' ? (selected?.summary ?? '') : '')

  return (
    <PaneShell size="form">
      <PaneHeader
        title="Recap"
        description="A “previously on…” of a session, saved to its summary."
        action={
          (recap.recap || recap.status !== 'idle') && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={recap.reset}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )
        }
      />

      <div className="flex items-center gap-2">
        <Select value={sessionId ?? undefined} onValueChange={pick}>
          <SelectTrigger className="h-9 flex-1">
            <SelectValue placeholder="Pick a session" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                Session {s.number}
                {s.title ? ` — ${s.title}` : ''}
                {s.summary ? ' ✓' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {streaming ? (
          <Button size="sm" variant="outline" onClick={recap.cancel}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={onGenerate} disabled={!sessionId}>
            <BookText className="size-3.5" />
            {selected?.summary ? 'Regenerate' : 'Generate'}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {recap.status === 'error' && (
          <Banner icon={<AlertTriangle className="size-4" />} tone="destructive" className="mb-3">
            Something went wrong: {recap.error?.message}
          </Banner>
        )}
        {recap.status === 'done' && recap.reason !== 'ok' && (
          <ReasonBanner reason={recap.reason} />
        )}

        {body ? (
          <article className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
            {body}
            {streaming && <span className="ml-0.5 animate-pulse text-primary">▌</span>}
          </article>
        ) : (
          !streaming &&
          recap.status !== 'error' && (
            <p className="px-1 pt-8 text-center text-sm text-muted-foreground">
              {streaming ? '' : 'Pick a session and generate a recap to read at the table.'}
            </p>
          )
        )}

        {recap.status === 'done' && recap.reason === 'ok' && (
          <p className="mt-3 text-xs text-muted-foreground">Saved to the session summary.</p>
        )}
        {recap.status === 'idle' && selected?.summary && !recap.recap && (
          <p className="mt-3 text-xs text-muted-foreground">Saved recap — regenerate to refresh it.</p>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Replace the saved recap?</AlertDialogTitle>
            <AlertDialogDescription>
              This session already has a saved summary. Generating a new recap will overwrite it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => sessionId && recap.generate(sessionId)}>
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PaneShell>
  )
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <BookText className="size-10 text-muted-foreground/50" />
      <div>
        <p className="font-display text-lg font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

function ReasonBanner({ reason }: { reason: RecapReason | null }) {
  if (reason === 'empty')
    return (
      <Banner icon={<Sparkles className="size-4" />} className="mb-3">
        This session has no beats or notes yet — capture some first, then recap it.
      </Banner>
    )
  if (reason === 'no_key')
    return (
      <Banner icon={<KeyRound className="size-4" />} className="mb-3">
        No API key — add one in Settings.
      </Banner>
    )
  if (reason === 'offline')
    return (
      <Banner icon={<WifiOff className="size-4" />} className="mb-3">
        You’re offline — Recap needs an internet connection.
      </Banner>
    )
  return null
}
