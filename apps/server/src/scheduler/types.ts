// Scheduler seams (B3): interfaces the tick depends on. Concrete providers:
// - SequenceProvider: static/in-memory in B3 (staticSequenceProvider.ts);
//   DB-backed once 0003_sequences lands in B4. The scheduler never knows.
// - Renderer: stub in B3 (render/stub.ts); real engine in B4 (docs/08).
// - JobPort: scenario runner's inline queue in tests; pg-boss at B3.16.
import type { SequenceDef, SequenceStepDef, VariantDef } from '../domain/sequence';

export interface SequenceProvider {
  /** The sequence a campaign sends. Throws if the campaign has none. */
  sequenceFor(campaignId: number): Promise<SequenceDef>;
}

/** What the renderer needs to know about the recipient (subset of leads row). */
export interface LeadLite {
  id: number;
  email: string;
  firstName: string | null;
  company: string | null;
  state: string | null;
}

export interface RenderInput {
  variant: VariantDef;
  step: SequenceStepDef;
  lead: LeadLite;
  enrollmentId: number;
}

export interface RenderedMessage {
  subject: string;
  bodyText: string;
  /** Echoes variant.contentHash — stored on the sent event (decision Q). */
  contentHash: string;
}

export interface Renderer {
  render(input: RenderInput): RenderedMessage;
}

export interface ConfirmDeliveryJob {
  enrollmentId: number;
  stepNo: number;
  /** The send this confirmation belongs to — bounces BEFORE it don't block (retry case). */
  sentAt: Date;
  runAt: Date;
}

export interface JobPort {
  scheduleConfirmDelivery(job: ConfirmDeliveryJob): Promise<void>;
}
