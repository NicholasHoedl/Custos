import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { QuickAddBar } from '@renderer/components/capture/QuickAddBar'
import { EventFeed } from '@renderer/components/capture/EventFeed'
import { EntityBrowser, type EntityFilter } from '@renderer/components/entities/EntityBrowser'
import { EntityDetail } from '@renderer/components/entities/EntityDetail'

// Master/detail capture surface: quick-add on top, the entity browser on the left, and either the
// selected entity's detail or the live session log on the right.
export function CaptureView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const selectedEntityId = useAppStore((s) => s.selectedEntityId)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const [filter, setFilter] = useState<EntityFilter>('all')
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
            onShowSessionLog={() => setSelectedEntity(null)}
          />
        </div>
        <div className="min-w-0 flex-1">
          {selectedEntityId ? (
            <EntityDetail
              key={selectedEntityId}
              entityId={selectedEntityId}
              allEntities={entities}
              sessionId={activeSessionId}
              onEntityChanged={refresh}
              onDeleted={() => {
                setSelectedEntity(null)
                refresh()
              }}
            />
          ) : (
            <EventFeed sessionId={activeSessionId} />
          )}
        </div>
      </div>
    </div>
  )
}
