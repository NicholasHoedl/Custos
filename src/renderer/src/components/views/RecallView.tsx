import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookPlus,
  Copy,
  Download,
  KeyRound,
  RotateCcw,
  Search,
  WifiOff
} from 'lucide-react'
import type { RecallSource, RecallTurn } from '@shared/recall-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useRecall } from '@renderer/hooks/use-recall'
import { useEntities, useSessions } from '@renderer/hooks/use-ledger'
import { useLensHistory } from '@renderer/hooks/use-lens-history'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { MentionTextarea } from '@renderer/components/entities/MentionTextarea'
import { AsOfSelect } from '@renderer/components/AsOfSelect'
import { PromptStarters } from '@renderer/components/recall/PromptStarters'
import { useLensSave } from '@renderer/components/lens/LensResultBar'
import { LensIdle } from '@renderer/components/lens/LensIdle'
import { LensPromptInfo } from '@renderer/components/lens/LensPromptInfo'
import { RECALL_STARTERS } from '@renderer/lib/lens-starters'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { recallProse } from '@renderer/lib/lens-prose'
import { formatRunCost } from '@renderer/lib/format'
import {
  Banner,
  EmptyState,
  PaneBody,
  PaneHeader,
  ProgressBar,
  SetupCard
} from '@renderer/components/chrome'

type Speed = 'quick' | 'deep'

export function RecallView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const pendingLens = useUiStore((s) => s.pendingLens)
  const consumePendingLens = useUiStore((s) => s.consumePendingLens)
  const { status: onb, progress, downloading, error: setupError, download } = useOnboarding()
  const recall = useRecall()
  const [query, setQuery] = useState('')
  const [speed, setSpeed] = useState<Speed>('quick')
  const { sessions } = useSessions(activeCampaignId)
  const { entities } = useEntities(activeCampaignId)
  const [asOf, setAsOf] = useState<number | null>(null)
  const { entries: recent, remember } = useLensHistory('recall')
  const rememberedRef = useRef(0)

  // Snapshot each completed turn's answer into the cross-session lens history (P1-1). Resets when the
  // transcript is cleared (Reset) so a fresh conversation re-remembers correctly.
  useEffect(() => {
    const n = recall.turns.length
    if (n < rememberedRef.current) rememberedRef.current = 0
    while (rememberedRef.current < n) {
      const t = recall.turns[rememberedRef.current]
      if (t.answer) remember(t.question || 'Lore', recallProse(t.question, t.answer))
      rememberedRef.current++
    }
  }, [recall.turns, remember])

  // Seeded from elsewhere (the Web graph: a node or node-pair → a Lore question). Pre-fill the box; the
  // player reviews and presses Ask.
  useEffect(() => {
    if (pendingLens?.view === 'recall' && pendingLens.query != null) {
      setQuery(pendingLens.query)
      consumePendingLens()
    }
  }, [pendingLens, consumePendingLens])

  if (!activeCampaignId) {
    return (
      <EmptyState icon={Search} title="No campaign selected">
        Choose a campaign in the sidebar to search its lore.
      </EmptyState>
    )
  }

  const streaming = recall.status === 'streaming'
  const hasThread = recall.turns.length > 0

  function submit() {
    if (!query.trim() || streaming || !onb.modelReady) return
    // In-character Recall is disabled in the UI for now (the logic stays in recall.service); ask
    // factually. The speed toggle picks Quick (Sonnet + concise) vs Deep (the Settings model + full).
    recall.ask(query, { asOfSession: asOf ?? undefined, speed })
    setQuery('')
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        icon={Search}
        title="Lore"
        action={
          <div className="flex items-center gap-1">
            <LensPromptInfo lens="recall" />
            {(query.trim().length > 0 || hasThread || recall.status !== 'idle') && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  recall.reset()
                  setQuery('')
                }}
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            )}
          </div>
        }
      />
      <PaneBody size="reading">
        {!onb.modelReady ? (
          <SetupCard
            icon={<Download className="size-4" />}
            title={
              setupError ? 'Model download failed' : 'Finish setup: download the local search model'
            }
            body={setupError ?? 'A one-time ~30 MB download enables offline semantic search.'}
            action={
              progress?.status === 'downloading' || downloading ? (
                <ProgressBar progress={progress} />
              ) : (
                <Button size="sm" onClick={download}>
                  {setupError ? 'Retry' : 'Download model'}
                </Button>
              )
            }
          />
        ) : !onb.keyReady ? (
          <SetupCard
            icon={<KeyRound className="size-4" />}
            title="Add your API key to synthesize answers"
            body="Without a key you'll still get the relevant notes — the Keeper writes the answer."
            action={
              <Button size="sm" variant="outline" onClick={() => setActiveView('settings')}>
                Open Settings
              </Button>
            }
          />
        ) : null}

        <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
          <MentionTextarea
            value={query}
            onValueChange={setQuery}
            rows={2}
            placeholder={
              hasThread
                ? 'Ask a follow-up — it stays in context…'
                : 'e.g. Who is Glastav, and what should we make of him?'
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <PromptStarters entities={entities} onUse={(q) => setQuery(q)} />
              <AsOfSelect sessions={sessions} value={asOf} onChange={setAsOf} />
              <SpeedToggle speed={speed} setSpeed={setSpeed} />
            </div>
            {streaming ? (
              <Button variant="outline" size="sm" onClick={recall.cancel}>
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={submit} disabled={!query.trim() || !onb.modelReady}>
                {hasThread ? 'Follow up' : 'Ask'}
              </Button>
            )}
          </div>
        </div>

        {/* Transcript — the in-flight turn (newest) on top, then completed turns newest-first. */}
        <div className="flex-1 space-y-6 overflow-y-auto">
          {(streaming || recall.error) && (
            <div className="space-y-3">
              {recall.question && (
                <p className="text-sm font-medium text-foreground/70">{recall.question}</p>
              )}
              {recall.error ? (
                <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
                  {['no_model', 'no_key', 'bad_key', 'offline'].includes(recall.error.kind)
                    ? reasonCopy(recall.error.kind)
                    : `Something went wrong: ${recall.error.message}`}
                </Banner>
              ) : (
                <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
                  {recall.answer}
                  <span className="ml-0.5 animate-pulse text-primary">▌</span>
                </div>
              )}
              {recall.sources.length > 0 && <Sources sources={recall.sources} />}
            </div>
          )}

          {[...recall.turns].reverse().map((turn, i) => (
            <TurnBlock key={recall.turns.length - 1 - i} turn={turn} />
          ))}

          {!hasThread && recall.status === 'idle' && (
            <LensIdle starters={RECALL_STARTERS} recent={recent} onPick={setQuery} />
          )}
        </div>
      </PaneBody>
    </div>
  )
}

/** Quick (Sonnet + concise, table-first) vs Deep (the Settings "Lore model" + full synthesis). Per-query. */
function SpeedToggle({ speed, setSpeed }: { speed: Speed; setSpeed: (s: Speed) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setSpeed('quick')}
        title="Sonnet — faster, tighter answers"
        className={cn(
          'rounded px-2 py-1 transition-colors',
          speed === 'quick'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Quick
      </button>
      <button
        type="button"
        onClick={() => setSpeed('deep')}
        title="Your Settings model — fuller synthesis"
        className={cn(
          'rounded px-2 py-1 transition-colors',
          speed === 'deep'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Deep
      </button>
    </div>
  )
}

/** One completed turn in the transcript: the question, the answer (+ per-turn Copy/Save note), its sources,
 *  and — on the degraded paths — a note that it's showing the retrieved notes instead of an answer. */
function TurnBlock({ turn }: { turn: RecallTurn }) {
  const { copy, inscribe } = useLensSave()
  const prose = recallProse(turn.question, turn.answer)
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground/70">{turn.question}</p>

      {turn.reason === 'offline' && (
        <Banner icon={<WifiOff className="size-4" />}>
          {reasonCopy('offline')} Showing the relevant notes instead.
        </Banner>
      )}
      {turn.reason === 'no_key' && (
        <Banner icon={<KeyRound className="size-4" />}>
          {reasonCopy('no_key')} Showing the relevant notes instead.
        </Banner>
      )}

      {turn.answer && (
        <>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
            {turn.answer}
          </div>
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => copy(prose)}
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => inscribe(prose)}
            >
              <BookPlus className="size-3.5" />
              Save note
            </Button>
          </div>
        </>
      )}

      {turn.sources.length > 0 && <Sources sources={turn.sources} />}

      {turn.cost && (
        <p className="text-right font-mono text-[10px] text-muted-foreground">
          {formatRunCost(turn.cost)}
        </p>
      )}
    </div>
  )
}

function Sources({ sources }: { sources: RecallSource[] }) {
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  function open(entityId: string) {
    setSelectedEntity(entityId)
    setActiveView('capture')
  }
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="inscribed text-xs">Sources</h3>
      <ul className="space-y-1.5">
        {sources.map((s, i) => {
          // A campaign-lore note (ADR-021) belongs to no entity — show it as a non-clickable card.
          const eid = s.entityId
          const body = (
            <>
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {s.entityName ?? 'Campaign lore'}
                </span>
                {s.cited && (
                  <span className="font-mono text-[9px] uppercase tracking-wider text-primary/80">
                    cited
                  </span>
                )}
                {s.sessionLabel && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {s.sessionLabel}
                  </span>
                )}
              </span>
              {s.snippet && (
                <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                  {s.snippet}
                </span>
              )}
            </>
          )
          return (
            <li key={`${eid ?? 'lore'}-${s.noteId ?? i}`}>
              {eid ? (
                <button
                  onClick={() => open(eid)}
                  className={cn(
                    'w-full rounded-md border bg-card/40 px-3 py-2 text-left transition-colors hover:border-primary/50',
                    s.cited ? 'border-primary/30' : 'border-border'
                  )}
                >
                  {body}
                </button>
              ) : (
                <div
                  className={cn(
                    'w-full rounded-md border bg-card/40 px-3 py-2 text-left',
                    s.cited ? 'border-primary/30' : 'border-border'
                  )}
                >
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
