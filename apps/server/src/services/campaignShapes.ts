// Per-campaign sequence shape for projection rebuilds (the DB lookup B6.12
// deferred to "B7.3's compare job"). rebuildProjections' shapeFor is SYNC, so
// preload one shape per campaign into a map and hand back a sync lookup.
//
// A campaign with a real sequence → shapeOf(its steps); a sequence-less
// campaign (SequenceProvider throws) → Infinity, i.e. completion is never
// derived — which matches how such a campaign's projections were built (it
// can't send, so it can't complete).
import type { Db } from '../db/client';
import { listCampaignIds } from '../db/repos/campaignsRepo';
import { shapeOf } from '../domain/sequence';
import type { SequenceShape } from '../domain/reducer';
import type { SequenceProvider } from '../scheduler/types';

export async function loadCampaignShapes(
  db: Db,
  sequences: SequenceProvider,
  softRetryMax: number,
): Promise<(campaignId: number) => SequenceShape> {
  const fallback: SequenceShape = { lastStepNo: Number.POSITIVE_INFINITY, softRetryMax };
  const byCampaign = new Map<number, SequenceShape>();
  for (const id of await listCampaignIds(db)) {
    try {
      byCampaign.set(id, shapeOf(await sequences.sequenceFor(id), softRetryMax));
    } catch {
      byCampaign.set(id, fallback); // no sequence assigned — completion inert
    }
  }
  return (campaignId) => byCampaign.get(campaignId) ?? fallback;
}
