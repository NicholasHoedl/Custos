import type { CampaignExport } from '@shared/export-types'
import { CAMPAIGN_EXPORT_VERSION } from '@shared/export-types'
import type { DbContext } from './db-context'
import { getCampaign } from './campaign.service'
import { listSessions } from './session.service'
import { listEntities } from './entity.service'
import { listAllNotes } from './note.service'
import { listLinksForCampaign } from './link.service'
import { listEventsForCampaign } from './event.service'
import { listStatusHistoryForCampaign } from './chronology.service'
import { getPersona } from './persona.service'
import { now } from './serialize'

// Build a portable JSON snapshot of one campaign (export-only). Pure read + assemble — the IPC handler
// owns the save dialog + file write. Embeddings are omitted (regenerable on load). See export-types.ts.

export function buildCampaignExport(ctx: DbContext, campaignId: string): CampaignExport {
  const campaign = getCampaign(ctx, campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  const entities = listEntities(ctx, campaignId)
  const personae = entities
    .filter((e) => e.type === 'pc')
    .map((e) => getPersona(ctx, e.id))
    .filter((p): p is NonNullable<typeof p> => p !== null)

  return {
    version: CAMPAIGN_EXPORT_VERSION,
    exportedAt: now(),
    campaign,
    sessions: listSessions(ctx, campaignId),
    entities,
    statusHistory: listStatusHistoryForCampaign(ctx, campaignId),
    notes: listAllNotes(ctx, campaignId),
    entityLinks: listLinksForCampaign(ctx, campaignId),
    eventLog: listEventsForCampaign(ctx, campaignId),
    personae
  }
}
