import { useState } from 'react'
import { UserRound } from 'lucide-react'
import { toast } from 'sonner'
import type { Entity } from '@shared/entity-types'
import { ledger } from '@renderer/lib/ipc'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useCampaigns, useEntities } from '@renderer/hooks/use-ledger'
import { EmptyState, PaneShell, PaneHeader } from '@renderer/components/chrome'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { CharacterDashboard } from '@renderer/components/entities/CharacterDashboard'
import { EntityForm } from '@renderer/components/entities/EntityForm'

// The Character page (ADR-030): the single home for the campaign's MAIN CHARACTER. You set / re-designate
// it here, and manage its full profile — the bespoke CharacterDashboard (profile, persona, the
// Draft-from-backstory tool, relationships, notes, history). First item in the navbar.
export function CharacterView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const { campaigns } = useCampaigns()
  const { entities, refresh } = useEntities(activeCampaignId)

  const campaign = campaigns.find((c) => c.id === activeCampaignId)
  const mainCharacterId = campaign?.mainCharacterId ?? null
  const pcs = entities.filter((e) => e.type === 'pc')

  if (!activeCampaignId) {
    return (
      <EmptyState icon={UserRound} title="No campaign selected">
        Choose a campaign in the sidebar to manage its main character.
      </EmptyState>
    )
  }

  // Grandfathered / just-cleared: no main character yet → prompt to set one.
  if (!mainCharacterId) {
    return (
      <PaneShell size="form">
        <PaneHeader
          title="Character"
          description="Your main character is the hero you play and whose voice the Keeper speaks in."
        />
        <div className="space-y-3 rounded-lg border border-border bg-card/60 p-6 text-center">
          <UserRound className="mx-auto size-8 text-primary/70" />
          <p className="text-sm text-muted-foreground">
            This campaign has no main character yet. Choose the hero you play.
          </p>
          <div className="flex justify-center">
            <MainCharacterPicker campaignId={activeCampaignId} pcs={pcs} value={null} onChanged={refresh} />
          </div>
          {pcs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No player characters yet — create one to begin.
            </p>
          )}
        </div>
      </PaneShell>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <UserRound className="size-4 shrink-0 text-primary" />
        <span className="text-xs text-muted-foreground">Main character</span>
        <div className="ml-auto">
          <MainCharacterPicker
            campaignId={activeCampaignId}
            pcs={pcs}
            value={mainCharacterId}
            onChanged={refresh}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <CharacterDashboard
          key={mainCharacterId}
          mainCharacterId={mainCharacterId}
          allEntities={entities}
          onDeleted={() => {
            // The MC was deleted → its FK self-nulls campaign.main_character_id → show the setter again.
            useUiStore.getState().bumpCampaigns()
            refresh()
          }}
        />
      </div>
    </div>
  )
}

// Set or re-designate the main character: pick an existing PC, or create a new one (then designate it).
function MainCharacterPicker({
  campaignId,
  pcs,
  value,
  onChanged
}: {
  campaignId: string
  pcs: Entity[]
  value: string | null
  onChanged: () => void
}) {
  const [createOpen, setCreateOpen] = useState(false)

  async function setMain(id: string): Promise<void> {
    try {
      await ledger.campaign.update(campaignId, { mainCharacterId: id })
      useUiStore.getState().bumpCampaigns() // refresh every useCampaigns → the page re-renders on the new MC
      onChanged()
    } catch (err) {
      toast.error('Could not set main character', { description: String(err) })
    }
  }

  return (
    <div className="flex items-center gap-2">
      {pcs.length > 0 && (
        <Select value={value ?? ''} onValueChange={(v) => void setMain(v)}>
          <SelectTrigger className="h-8 w-48" aria-label="Main character">
            <SelectValue placeholder="Choose a character" />
          </SelectTrigger>
          <SelectContent>
            {pcs.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
        New character
      </Button>
      <EntityForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        campaignId={campaignId}
        defaultType="pc"
        onSaved={(entity) => void setMain(entity.id)}
      />
    </div>
  )
}
