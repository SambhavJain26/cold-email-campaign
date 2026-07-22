// Scheduler seams (B3/B4): interfaces the tick depends on. Concrete providers:
// - SequenceProvider: static/in-memory in tests (staticSequenceProvider.ts);
//   DB-backed in prod (dbSequenceProvider.ts, B4.1). The scheduler never knows.
// - Renderer: the real engine (render/engine.ts, B4) — its vocabulary lives in
//   render/types and is re-exported here for downstream imports.
// - JobPort: scenario runner's inline queue in tests; pg-boss at B3.16.
import type { SequenceDef } from '../domain/sequence';

export type {
  LeadLite,
  RenderContext,
  RenderInput,
  RenderedMessage,
  Renderer,
} from '../render/types';

export interface SequenceProvider {
  /** The sequence a campaign sends. Throws if the campaign has none. */
  sequenceFor(campaignId: number): Promise<SequenceDef>;
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
