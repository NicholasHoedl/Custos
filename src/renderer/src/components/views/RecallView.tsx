import { useState, type ReactNode } from 'react'
import { AlertTriangle, Download, KeyRound, RotateCcw, Search, Sparkles, WifiOff } from 'lucide-react'
import type { RecallMode, RecallSource } from '@shared/recall-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useRecall } from '@renderer/hooks/use-recall'
import { useOnboarding } from '@renderer/hooks/use-onboarding'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'

export function RecallView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activePcId = useAppStore((s) => s.activePcId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const { status: onb, progress, downloading, error: setupError, download } = useOnboarding()
  const recall = useRecall()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<RecallMode>('in_character')

  if (!activeCampaignId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Search className="size-10 text-muted-foreground/50" />
        <div>
          <p className="font-display text-lg font-medium text-foreground">No campaign selected</p>
          <p className="text-sm text-muted-foreground">Pick a campaign in the sidebar to recall from.</p>
        </div>
      </div>
    )
  }

  const canInCharacter = Boolean(activePcId)
  const effectiveMode: RecallMode = canInCharacter ? mode : 'factual'
  const streaming = recall.status === 'streaming'

  function submit() {
    if (!query.trim() || streaming || !onb.modelReady) return
    recall.ask(query, effectiveMode)
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-foreground">Recall</h1>
          <p className="text-sm text-muted-foreground">
            Ask in plain language.{' '}
            {canInCharacter ? 'Answered in character.' : 'Answered from your notes.'}
          </p>
        </div>
        {(query.trim().length > 0 || recall.status !== 'idle') && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => {
              recall.reset()
              setQuery('')
            }}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        )}
      </header>

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
          body="Without a key you'll still get the relevant notes — Claude writes the answer."
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
        <div className="flex items-center justify-between gap-3">
          <ModeToggle mode={effectiveMode} setMode={setMode} canInCharacter={canInCharacter} />
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
        {!canInCharacter && (
          <p className="text-xs text-muted-foreground">
            Tip: select an active character in the sidebar to answer in character.
          </p>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {recall.status === 'idle' && (
          <p className="px-1 pt-8 text-center text-sm text-muted-foreground">
            Your answer will appear here, drawn from this campaign&apos;s notes.
          </p>
        )}

        {recall.reason === 'offline' && (
          <Banner icon={<WifiOff className="size-4" />}>
            You&apos;re offline — showing the relevant notes instead of a synthesized answer.
          </Banner>
        )}
        {recall.reason === 'no_key' && (
          <Banner icon={<KeyRound className="size-4" />}>
            No API key — showing the relevant notes. Add a key in Settings to get a written answer.
          </Banner>
        )}
        {recall.error && (
          <Banner icon={<AlertTriangle className="size-4" />} tone="destructive">
            {recall.error.kind === 'no_model'
              ? 'The search model is still downloading.'
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
      </div>
    </div>
  )
}

function ModeToggle({
  mode,
  setMode,
  canInCharacter
}: {
  mode: RecallMode
  setMode: (m: RecallMode) => void
  canInCharacter: boolean
}) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => canInCharacter && setMode('in_character')}
        disabled={!canInCharacter}
        title={canInCharacter ? undefined : 'Select an active character to answer in character'}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 transition-colors',
          mode === 'in_character'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground',
          !canInCharacter && 'cursor-not-allowed opacity-50'
        )}
      >
        <Sparkles className="size-3" />
        In character
      </button>
      <button
        type="button"
        onClick={() => setMode('factual')}
        className={cn(
          'rounded px-2 py-1 transition-colors',
          mode === 'factual'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Just the facts
      </button>
    </div>
  )
}

function Sources({ sources }: { sources: RecallSource[] }) {
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  function open(s: RecallSource) {
    setSelectedEntity(s.entityId)
    setActiveView('capture')
  }
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Sources</h3>
      <ul className="space-y-1.5">
        {sources.map((s, i) => (
          <li key={`${s.entityId}-${s.noteId ?? i}`}>
            <button
              onClick={() => open(s)}
              className="w-full rounded-md border border-border bg-card/40 px-3 py-2 text-left transition-colors hover:border-primary/50"
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{s.entityName}</span>
                {s.sessionLabel && (
                  <span className="font-mono text-[10px] text-muted-foreground">{s.sessionLabel}</span>
                )}
              </span>
              {s.snippet && (
                <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                  {s.snippet}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SetupCard({
  icon,
  title,
  body,
  action
}: {
  icon: ReactNode
  title: string
  body: string
  action: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <span className="text-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

function ProgressBar({ progress }: { progress: { loaded?: number; total?: number } | null }) {
  const pct =
    progress?.total && progress.total > 0
      ? Math.round(((progress.loaded ?? 0) / progress.total) * 100)
      : null
  return (
    <div className="flex w-40 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: pct != null ? `${pct}%` : '40%' }}
        />
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">
        {pct != null ? `${pct}%` : '…'}
      </span>
    </div>
  )
}

function Banner({
  icon,
  children,
  tone = 'muted'
}: {
  icon: ReactNode
  children: ReactNode
  tone?: 'muted' | 'destructive'
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'destructive'
          ? 'border-destructive/40 bg-destructive/10 text-foreground'
          : 'border-border bg-muted/40 text-muted-foreground'
      )}
    >
      <span className={tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}>
        {icon}
      </span>
      <span>{children}</span>
    </div>
  )
}
