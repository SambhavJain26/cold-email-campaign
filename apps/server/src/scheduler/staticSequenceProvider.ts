// B3's SequenceProvider: sequences registered in memory (scenario config /
// composition). Replaced by a DB-backed provider when 0003_sequences lands
// (B4.1) - same interface, scheduler untouched.
import type { SequenceDef } from '../domain/sequence';
import type { SequenceProvider } from './types';

export class StaticSequenceProvider implements SequenceProvider {
  private byCampaign = new Map<number, SequenceDef>();

  register(campaignId: number, seq: SequenceDef): void {
    this.byCampaign.set(campaignId, seq);
  }

  sequenceFor(campaignId: number): Promise<SequenceDef> {
    const seq = this.byCampaign.get(campaignId);
    if (!seq) {
      return Promise.reject(new Error(`no sequence registered for campaign ${campaignId}`));
    }
    return Promise.resolve(seq);
  }
}
