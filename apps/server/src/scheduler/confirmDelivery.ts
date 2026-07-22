// confirm-delivery (decision N): fires at send + delivery_confirm_hours.
// If no bounce exists for (enrollment, step) AT/AFTER that send → append
// `delivered`. A bounce arriving later is still processed normally — reducer
// precedence handles it.
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import type { EventStore } from '../services/eventStore';
import { hasBounceSince } from '../db/repos/eventsRepo';
import { getById } from '../db/repos/enrollmentsRepo';
import { buildEvent } from '../domain/events';
import type { ConfirmDeliveryJob } from './types';

export interface ConfirmDeliveryDeps {
  db: Db;
  store: EventStore;
  clock: Clock;
}

/** Returns true iff a `delivered` event was appended. */
export async function runConfirmDelivery(
  deps: ConfirmDeliveryDeps,
  job: ConfirmDeliveryJob,
): Promise<boolean> {
  const { db, store, clock } = deps;
  // Bounces BEFORE this send belong to an earlier attempt of the same step
  // (soft-retry) and do not veto this one.
  if (await hasBounceSince(db, job.enrollmentId, job.stepNo, job.sentAt)) return false;
  const e = await getById(db, job.enrollmentId);
  if (!e) return false;
  await store.append([
    buildEvent.delivered({
      leadId: e.leadId,
      enrollmentId: e.id,
      campaignId: e.campaignId,
      occurredAt: clock.now(),
      stepNo: job.stepNo,
    }),
  ]);
  return true;
}
