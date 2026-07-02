import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { QuickAddBar } from '@renderer/components/capture/QuickAddBar'
import { EventFeed } from '@renderer/components/capture/EventFeed'
import {
  EntityBrowser,
  type CapturePanel,
  type EntityFilter
} from '@renderer/components/entities/EntityBrowser'
import { EntityDetail } from '@renderer/components/entities/EntityDetail'
import { NotesView } from '@renderer/components/views/NotesView'
import { RecapView } from '@renderer/components/views/RecapView'
import { ImportView } from '@renderer/components/views/ImportView'
import { BackfillView } from '@renderer/components/views/BackfillView'

// Master/detail capture surface: quick-add on top, the entity browser on the left, and either the
// selected entity's detail or the live session log on the right.
export function CaptureView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const selectedEntityId = useAppStore((s) => s.selectedEntityId)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const [filter, setFilter] = useState<EntityFilter>('all')
  const [capturePanel, setCapturePanel] = useState<CapturePanel>('session')
  const { entities, refresh } = useEntities(activeCampaignId)

  if (!activeCampaignId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <BookOpen className="size-10 text-muted-foreground/50" />
        <div>
          <p className="font-display text-lg font-medium text-foreground">No campaign selected</p>
          <p className="text-sm text-muted-foreground">
            Create or pick a campaign in the sidebar to start capturing.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <QuickAddBar
          campaignId={activeCampaignId}
          sessionId={activeSessionId}
          onCreated={(entity) => {
            setFilter('all')
            refresh()
            setSelectedEntity(entity.id)
          }}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 border-r border-border">
          <EntityBrowser
            entities={entities}
            selectedId={selectedEntityId}
            filter={filter}
            onFilterChange={setFilter}
            onSelect={setSelectedEntity}
            panel={capturePanel}
            onShowSessionLog={() => {
              setSelectedEntity(null)
              setCapturePanel('session')
            }}
            onShowNotes={() => {
              setSelectedEntity(null)
              setCapturePanel('notes')
            }}
            onShowRecap={() => {
              setSelectedEntity(null)
              setCapturePanel('recap')
            }}
            onShowImport={() => {
              setSelectedEntity(null)
              setCapturePanel('import')
            }}
            onShowBackfill={() => {
              setSelectedEntity(null)
              setCapturePanel('backfill')
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          {selectedEntityId ? (
            <EntityDetail
              key={selectedEntityId}
              entityId={selectedEntityId}
              allEntities={entities}
              onEntityChanged={refresh}
              onDeleted={() => {
                setSelectedEntity(null)
                refresh()
              }}
            />
          ) : capturePanel === 'notes' ? (
            <NotesView key={activeCampaignId} />
          ) : capturePanel === 'recap' ? (
            <RecapView key={activeCampaignId} />
          ) : capturePanel === 'import' ? (
            <ImportView key={activeCampaignId} />
          ) : capturePanel === 'backfill' ? (
            <BackfillView key={activeCampaignId} />
          ) : (
            <EventFeed sessionId={activeSessionId} />
          )}
        </div>
      </div>
    </div>
  )
}
