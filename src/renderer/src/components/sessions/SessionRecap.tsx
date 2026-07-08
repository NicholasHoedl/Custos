import { useEffect, useState } from 'react'
import { AlertTriangle, BookText, KeyRound, Sparkles, WifiOff } from 'lucide-react'
import type { Session } from '@shared/entity-types'
import { useRecap } from '@renderer/hooks/use-recap'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { Button } from '@renderer/components/ui/button'
import { Banner } from '@renderer/components/chrome'
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

// The "Previously on…" recap for ONE session — generate/stream/save + show the saved summary. Extracted
// from the old standalone RecapView (ADR-032) so the Sessions view embeds it per selected session. The
// caller gates the API key; this just drives generation for `session`.
export function SessionRecap({ session, onSaved }: { session: Session; onSaved?: () => void }) {
  const recap = useRecap()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { reset, generate, cancel } = recap

  // Switching the selected session clears any streamed recap so we show the new one's saved summary.
  useEffect(() => {
    reset()
  }, [session.id, reset])

  useEffect(() => {
    if (recap.status === 'done' && recap.reason === 'ok') onSaved?.()
  }, [recap.status, recap.reason, onSaved])

  const streaming = recap.status === 'streaming'
  const body = recap.recap || (recap.status === 'idle' ? (session.summary ?? '') : '')

  function onGenerate() {
    if (streaming) return
    if (session.summary) setConfirmOpen(true)
    else generate(session.id)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inscribed text-xs">Previously…</h3>
        {streaming ? (
          <Button size="sm" variant="outline" onClick={cancel}>
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onGenerate}>
            <BookText className="size-3.5" />
            {session.summary ? 'Regenerate' : 'Generate recap'}
          </Button>
        )}
      </div>

      {recap.status === 'error' && (
        <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
          {recap.error && ['no_key', 'bad_key', 'offline'].includes(recap.error.kind)
            ? reasonCopy(recap.error.kind)
            : `Something went wrong: ${recap.error?.message}`}
        </Banner>
      )}
      {recap.status === 'done' && recap.reason === 'empty' && (
        <Banner icon={<Sparkles className="size-4" />}>
          This session has no chronicle entries or annals yet — capture some first, then recap it.
        </Banner>
      )}
      {recap.status === 'done' && recap.reason === 'offline' && (
        <Banner icon={<WifiOff className="size-4" />}>{reasonCopy('offline')}</Banner>
      )}
      {recap.status === 'done' && recap.reason === 'no_key' && (
        <Banner icon={<KeyRound className="size-4" />}>{reasonCopy('no_key')}</Banner>
      )}

      {body ? (
        <article className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
          {body}
          {streaming && <span className="ml-0.5 animate-pulse text-primary">▌</span>}
        </article>
      ) : (
        !streaming &&
        recap.status !== 'error' && (
          <p className="text-sm text-muted-foreground">
            No recap yet — generate one to read at the table.
          </p>
        )
      )}
      {recap.status === 'done' && recap.reason === 'ok' && (
        <p className="text-xs text-muted-foreground">Saved to this session’s summary.</p>
      )}

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
            <AlertDialogAction onClick={() => generate(session.id)}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
