import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { ApplyResult } from '@shared/import-types'
import { ledger } from '@renderer/lib/ipc'
import { useEntities, useEvents } from '@renderer/hooks/use-ledger'
import { useImport } from '@renderer/hooks/use-import'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { useAppStore } from '@renderer/store/app-store'
import { formatTime } from '@renderer/lib/format'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { ChangesetReview } from '@renderer/components/capture/ChangesetReview'

interface EventFeedProps {
  sessionId: string | null
  /** True while the persisted session is still being restored (T3) — shown instead of the
   *  "start a session" copy so a real zero-sessions campaign reads differently from a loading one. */
  restoring?: boolean
}

function applySummary(r: ApplyResult): string {
  const parts = [
    r.createdEntityIds.length > 0 && `${r.createdEntityIds.length} new`,
    r.linkedEntityIds.length > 0 && `${r.linkedEntityIds.length} linked`,
    r.statusChangesApplied + r.relationshipChangesApplied > 0 &&
      `${r.statusChangesApplied + r.relationshipChangesApplied} changes`,
    r.createdNoteIds.length > 0 && `${r.createdNoteIds.length} notes`
  ].filter(Boolean) as string[]
  return parts.length > 0 ? parts.join(' · ') : 'No new changes'
}

// The Journal — the primary at-the-table capture surface (ADR: main character + journal capture). You
// jot a plain sentence or two of what happened; the raw line is kept here as your log, and (with an API
// key) Claude proposes the entities, notes, status changes, and relationship links it implies for inline
// review, applied stamped at the current session. Internals still ride the event_log table (createEvent);
// "journal" is the user-facing name. Manual entity/note editing (Capture) becomes the fallback path.
export function EventFeed({ sessionId, restoring = false }: EventFeedProps) {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const { events, refresh } = useEvents(sessionId)
  const { entities: campaignEntities } = useEntities(activeCampaignId)
  const { status: onb } = useOnboarding()
  const imp = useImport({ withChanges: true })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const reviewing = imp.status === 'review' || imp.status === 'applying'
  const extracting = imp.status === 'extracting'

  // When an apply finishes, summarize it, refresh the log, and clear the review for the next entry.
  useEffect(() => {
    if (imp.status !== 'done') return
    if (imp.result) toast.success('Journal entry processed', { description: applySummary(imp.result) })
    imp.reset()
    refresh()
  }, [imp.status, imp.result, imp.reset, refresh])

  async function submit(): Promise<void> {
    const content = text.trim()
    if (!content || !sessionId || busy || reviewing || extracting) return
    setBusy(true)
    try {
      // The raw journal line is durable — save it first, so it stands even if the AI proposal is discarded.
      await ledger.event.create({ sessionId, content })
      setText('')
      refresh()
      // Then, if a key is configured, let Claude propose entities/notes/changes for inline review.
      if (onb.keyReady) imp.extract(content)
    } catch (err) {
      toast.error('Could not save journal entry', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  const ordered = [...events].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <h2 className="font-display text-xl font-semibold text-foreground">Journal</h2>
        <p className="text-xs text-muted-foreground">
          {restoring
            ? 'Restoring session…'
            : !sessionId
              ? 'Start a session to begin your journal.'
              : onb.keyReady
                ? 'Jot what happened — Ledger proposes the entities, notes, and updates it implies.'
                : 'Jot what happened. Add an API key in Settings to auto-extract entities and notes.'}
        </p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No journal entries yet.</p>
        ) : (
          ordered.map((ev) => (
            <div key={ev.id} className="flex gap-3 border-l-2 border-border pl-3">
              <span className="shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground">
                {formatTime(ev.timestamp)}
              </span>
              <p className="whitespace-pre-wrap text-sm text-foreground/90">{ev.content}</p>
            </div>
          ))
        )}
      </div>

      {reviewing ? (
        <div className="flex max-h-[60%] flex-col border-t border-border p-3">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Review what to add</span>
          </div>
          <ChangesetReview
            imp={imp}
            campaignEntities={campaignEntities}
            onApply={() => imp.apply(sessionId)}
            onDiscard={imp.reset}
            applyLabel="Add to campaign"
          />
        </div>
      ) : (
        sessionId && (
          <div className="border-t border-border p-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              disabled={extracting}
              placeholder={
                extracting ? 'Reading your entry…' : 'What happened? A sentence or two…  (Ctrl+Enter)'
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {imp.reason === 'empty' && 'Saved — nothing to extract from that one.'}
                {imp.reason === 'bad_key' && 'Saved — your API key was rejected; update it in Settings.'}
                {imp.reason === 'offline' && 'Saved — offline, so nothing was extracted.'}
                {imp.reason === 'too_long' && 'Saved — that entry was long; extraction was skipped.'}
              </span>
              <Button size="sm" onClick={() => void submit()} disabled={!text.trim() || busy || extracting}>
                {extracting ? 'Reading…' : 'Add'}
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  )
}
