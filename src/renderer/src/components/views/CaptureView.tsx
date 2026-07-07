import { useEffect, useRef, useState } from 'react'
import { useEntities } from '@renderer/hooks/use-ledger'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { OnboardingChecklist } from '@renderer/components/OnboardingChecklist'
import {
  EntityBrowser,
  type CapturePanel,
  type EntityFilter
} from '@renderer/components/entities/EntityBrowser'
import { EntityForm } from '@renderer/components/entities/EntityForm'
import { EntityDetail } from '@renderer/components/entities/EntityDetail'
import { NotesView } from '@renderer/components/views/NotesView'
import { RecapView } from '@renderer/components/views/RecapView'
import { ImportView } from '@renderer/components/views/ImportView'

// Master/detail capture surface: the entity browser on the left (tabs: Add entity / Notes / Recap /
// Import), and on the right either the selected entity's detail or the active pane — including the
// full "Add entity" profile form, which is now its own pane rather than a popup.
export function CaptureView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const selectedEntityId = useAppStore((s) => s.selectedEntityId)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const [filter, setFilter] = useState<EntityFilter>('all')
  const [capturePanel, setCapturePanel] = useState<CapturePanel>('notes')
  const { entities, refresh } = useEntities(activeCampaignId)

  // The global quick-add hotkey / Ctrl+K (ADR-010/023) opens the Add-entity pane. Skip the initial mount
  // so it only fires on an actual bump.
  const quickAddNonce = useUiStore((s) => s.quickAddNonce)
  const firstNonce = useRef(true)
  useEffect(() => {
    if (firstNonce.current) {
      firstNonce.current = false
      return
    }
    setSelectedEntity(null)
    setCapturePanel('add')
  }, [quickAddNonce, setSelectedEntity])

  if (!activeCampaignId) {
    // No campaign yet: the welcome IS the empty state (it carries the create-campaign step).
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <OnboardingChecklist />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* OnboardingChecklist returns null once setup is done — `empty:hidden` drops the bar entirely. */}
      <div className="border-b border-border p-3 empty:hidden">
        <OnboardingChecklist />
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
            onShowAddEntity={() => {
              setSelectedEntity(null)
              setCapturePanel('add')
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
          ) : capturePanel === 'add' ? (
            <EntityForm
              key={activeCampaignId}
              variant="page"
              campaignId={activeCampaignId}
              onSaved={(entity) => {
                setFilter('all')
                refresh()
                setSelectedEntity(entity.id) // opens the new entity's detail, leaving the add pane
              }}
              onCancel={() => setCapturePanel('notes')}
            />
          ) : capturePanel === 'recap' ? (
            <RecapView key={activeCampaignId} />
          ) : capturePanel === 'import' ? (
            <ImportView key={activeCampaignId} />
          ) : (
            <NotesView key={activeCampaignId} />
          )}
        </div>
      </div>
    </div>
  )
}
