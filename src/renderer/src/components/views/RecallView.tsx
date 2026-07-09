import { useState } from 'react'
import { AlertTriangle, Download, KeyRound, RotateCcw, Search, WifiOff } from 'lucide-react'
import type { RecallSource } from '@shared/recall-types'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useRecall } from '@renderer/hooks/use-recall'
import { useEntities, useSessions } from '@renderer/hooks/use-ledger'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { AsOfSelect } from '@renderer/components/AsOfSelect'
import { PromptStarters } from '@renderer/components/recall/PromptStarters'
import { reasonCopy } from '@renderer/lib/ai-copy'
import { formatRunCost } from '@renderer/lib/format'
import {
  Banner,
  EmptyState,
  PaneHeader,
  PaneShell,
  ProgressBar,
  SetupCard
} from '@renderer/components/chrome'

export function RecallView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb, progress, downloading, error: setupError, download } = useOnboarding()
  const recall = useRecall()
  const [query, setQuery] = useState('')
  const { sessions } = useSessions(activeCampaignId)
  const { entities } = useEntities(activeCampaignId)
  const [asOf, setAsOf] = useState<number | null>(null)

  if (!activeCampaignId) {
    return (
      <EmptyState icon={Search} title="No campaign selected">
        Choose a campaign in the sidebar to search its lore.
      </EmptyState>
    )
  }

  const streaming = recall.status === 'streaming'

  function submit() {
    if (!query.trim() || streaming || !onb.modelReady) return
    // In-character Recall is disabled in the UI for now (the logic stays in recall.service); ask
    // factually. Restore the mode toggle below to bring it back.
    recall.ask(query, 'factual', asOf ?? undefined)
  }

  return (
    <PaneShell size="reading">
      <PaneHeader
        title="Lore"
        size="lg"
        description="Ask in plain language — answered from your annals."
        action={
          (query.trim().length > 0 || recall.status !== 'idle') && (
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
          )
        }
      />

      {!onb.modelReady ? (
        <SetupCard
          icon={<Download className="size-4" />}
          title={setupError ? 'Model download failed' : 'Finish setup: download the local search model'}
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
        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={2}
          placeholder="e.g. Who is Glastav, and what should we make of him?"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PromptStarters entities={entities} onUse={(q) => setQuery(q)} />
            <AsOfSelect sessions={sessions} value={asOf} onChange={setAsOf} />
          </div>
          {streaming ? (
            <Button variant="outline" size="sm" onClick={recall.cancel}>
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={submit} disabled={!query.trim() || !onb.modelReady}>
              Ask
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {recall.status === 'idle' && (
          <p className="px-1 pt-8 text-center text-sm text-muted-foreground">
            The Keeper’s answer appears here, drawn from your annals.
          </p>
        )}

        {recall.reason === 'offline' && (
          <Banner icon={<WifiOff className="size-4" />}>
            {reasonCopy('offline')} Showing the relevant notes instead.
          </Banner>
        )}
        {recall.reason === 'no_key' && (
          <Banner icon={<KeyRound className="size-4" />}>
            {reasonCopy('no_key')} Showing the relevant notes instead.
          </Banner>
        )}
        {recall.error && (
          <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
            {['no_model', 'no_key', 'bad_key', 'offline'].includes(recall.error.kind)
              ? reasonCopy(recall.error.kind)
              : `Something went wrong: ${recall.error.message}`}
          </Banner>
        )}

        {recall.answer && (
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
            {recall.answer}
            {streaming && <span className="ml-0.5 animate-pulse text-primary">▌</span>}
          </div>
        )}

        {recall.sources.length > 0 && <Sources sources={recall.sources} />}

        {recall.status === 'done' && recall.cost && (
          <p className="text-right font-mono text-[10px] text-muted-foreground">
            {formatRunCost(recall.cost)}
          </p>
        )}
      </div>
    </PaneShell>
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
                {s.sessionLabel && (
                  <span className="font-mono text-[10px] text-muted-foreground">{s.sessionLabel}</span>
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
                  className="w-full rounded-md border border-border bg-card/40 px-3 py-2 text-left transition-colors hover:border-primary/50"
                >
                  {body}
                </button>
              ) : (
                <div className="w-full rounded-md border border-border bg-card/40 px-3 py-2 text-left">
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

