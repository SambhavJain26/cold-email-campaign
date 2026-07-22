// B4.1's SequenceProvider: serves SequenceDefs from the 0003_sequences tables
// via campaigns.sequence_id. Same interface as StaticSequenceProvider (B3) —
// the scheduler never knows the difference.
import type { DbLike } from '../db/client';
import { loadSequenceDef, sequenceIdForCampaign } from '../db/repos/sequencesRepo';
import type { SequenceDef } from '../domain/sequence';
import type { SequenceProvider } from './types';

export class DbSequenceProvider implements SequenceProvider {
  constructor(private readonly db: DbLike) {}

  async sequenceFor(campaignId: number): Promise<SequenceDef> {
    const sequenceId = await sequenceIdForCampaign(this.db, campaignId);
    if (sequenceId === null) {
      throw new Error(`campaign ${campaignId} has no sequence assigned`);
    }
    const seq = await loadSequenceDef(this.db, sequenceId);
    if (!seq) {
      throw new Error(`campaign ${campaignId} references missing sequence ${sequenceId}`);
    }
    return seq;
  }
}
