import type { Db } from '../db/client';
import type { Clock } from '../clock';
import type { EventStore } from './eventStore';
import type { SequenceProvider } from '../scheduler/types';
import type { AlertSink } from '../alerts/types';
import {
  activeAutoEnrollmentCampaigns,
  autoEnrollmentCursor,
  claimAutoEnrollmentDay,
  completeAutoEnrollmentDay,
  createAutoEnrollmentRun,
  finishAutoEnrollmentRun,
  recordAutoEnrollmentCampaign,
  setAutoEnrollmentCursor,
  setAutoEnrollmentRunCapacity,
  type AutoEnrollmentTrigger,
} from '../db/repos/autoEnrollmentRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { localParts } from '../scheduler/window';
import { acquireEnrollmentCapacityLock } from '../db/repos/locksRepo';
import { availablePoolLeads, markPoolEligibility, poolSummary } from '../db/repos/campaignPoolRepo';
import { capacityToday, enrollLeadsInTransaction } from './enrollment';
import { poolEligibility } from './campaignPools';

export interface AutoEnrollmentDeps {
  db: Db;
  store: EventStore;
  clock: Clock;
  sequences: SequenceProvider;
  alerts: AlertSink;
}

export interface AutoEnrollmentRunResult {
  runId: number;
  enrolled: number;
  localDate: string;
  trigger: AutoEnrollmentTrigger;
}

export class AutoEnrollmentService {
  constructor(private readonly deps: AutoEnrollmentDeps) {}

  run(
    trigger: AutoEnrollmentTrigger,
    onlyCampaignIds?: readonly number[],
  ): Promise<AutoEnrollmentRunResult | null> {
    return runAutoEnrollment(this.deps, trigger, onlyCampaignIds);
  }
}

function localDateKey(now: Date, timezone: string): string {
  const parts = localParts(now, timezone);
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

function isSerializationFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && current.code === '40001') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

/**
 * Coordinate all enabled campaigns under one capacity lock. A daily run is
 * claimed once per application-local date; immediate enable/activation runs
 * use the same lock but do not consume or recreate the daily claim.
 */
export async function runAutoEnrollment(
  deps: AutoEnrollmentDeps,
  trigger: AutoEnrollmentTrigger,
  onlyCampaignIds?: readonly number[],
): Promise<AutoEnrollmentRunResult | null> {
  const now = deps.clock.now();
  const settings = await getSettings(deps.db);
  const localDate = localDateKey(now, settings.defaultTimezone);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await deps.db.transaction(
        async (tx) => {
          // Serialize the claim itself as well as capacity consumption. This
          // makes concurrent worker checks converge on one winner and one no-op.
          // PostgreSQL may still abort the waiter's old serializable snapshot;
          // that retry is absorbed below rather than exposed to the job runner.
          await acquireEnrollmentCapacityLock(tx);
          if (trigger === 'daily' && !(await claimAutoEnrollmentDay(tx, localDate, now))) {
            return null;
          }
          const runId = await createAutoEnrollmentRun(tx, {
            trigger,
            localDate,
            capacitySnapshot: {},
            now,
          });
          let campaigns = await activeAutoEnrollmentCampaigns(tx);
          if (onlyCampaignIds) {
            const allowed = new Set(onlyCampaignIds);
            campaigns = campaigns.filter((campaign) => allowed.has(campaign.id));
          }

          if (campaigns.length === 0) {
            await setAutoEnrollmentRunCapacity(tx, runId, { shared_room: 0, campaigns: 0 });
            await finishAutoEnrollmentRun(tx, runId, {
              now: deps.clock.now(),
              lastServedCampaignId: null,
            });
            if (trigger === 'daily') {
              await completeAutoEnrollmentDay(tx, localDate, deps.clock.now());
            }
            return { runId, enrolled: 0 };
          }

          const firstCapacity = await capacityToday(
            { db: tx, clock: deps.clock },
            campaigns[0]!.id,
          );
          let sharedRoom = firstCapacity.roomForNew;
          await setAutoEnrollmentRunCapacity(tx, runId, {
            total_daily_capacity: firstCapacity.total,
            sent_so_far_today: firstCapacity.sentSoFar,
            followups_due_today: firstCapacity.followupsDue,
            pending_openers_today: firstCapacity.pendingOpeners,
            shared_room: sharedRoom,
            campaigns: campaigns.length,
          });

          const cursor = await autoEnrollmentCursor(tx);
          const cursorIndex =
            cursor === null ? -1 : campaigns.findIndex((campaign) => campaign.id === cursor);
          if (cursorIndex >= 0) {
            campaigns = [
              ...campaigns.slice(cursorIndex + 1),
              ...campaigns.slice(0, cursorIndex + 1),
            ];
          }

          const states = [] as Array<{
            campaign: (typeof campaigns)[number];
            capRemaining: number;
            eligible: Array<{
              id: number;
              tier: 'A' | 'B' | 'C' | 'nurture' | null;
              poolId: number;
            }>;
            selected: Array<{
              id: number;
              tier: 'A' | 'B' | 'C' | 'nurture' | null;
              poolId: number;
            }>;
            skipped: Record<string, number>;
          }>;
          for (const campaign of campaigns) {
            const cap = await capacityToday({ db: tx, clock: deps.clock }, campaign.id);
            const summary = await poolSummary(tx, campaign.id);
            const candidates = await availablePoolLeads(tx, campaign.id, summary.available);
            const checked = await poolEligibility(
              tx,
              deps.sequences,
              campaign.id,
              candidates.map((candidate) => candidate.leadId),
              now,
            );
            const allowed = new Set(checked.eligible.map((lead) => lead.id));
            const skipped: Record<string, number> = {};
            for (const candidate of candidates) {
              const reason = checked.reasons.get(candidate.leadId) ?? null;
              await markPoolEligibility(tx, candidate.poolId, reason, now);
              if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
            }
            states.push({
              campaign,
              capRemaining: cap.campaignCapRemaining,
              eligible: candidates
                .filter((candidate) => allowed.has(candidate.leadId))
                .map((candidate) => ({
                  id: candidate.leadId,
                  tier: candidate.tier,
                  poolId: candidate.poolId,
                })),
              selected: [],
              skipped,
            });
          }

          let lastServedCampaignId: number | null = cursor;
          let madeProgress = true;
          while (sharedRoom > 0 && madeProgress) {
            madeProgress = false;
            for (const state of states) {
              if (sharedRoom <= 0) break;
              if (state.selected.length >= state.capRemaining) continue;
              const next = state.eligible[state.selected.length];
              if (!next) continue;
              state.selected.push(next);
              sharedRoom -= 1;
              lastServedCampaignId = state.campaign.id;
              madeProgress = true;
            }
          }

          let enrolled = 0;
          for (const state of states) {
            const result = await enrollLeadsInTransaction(
              deps,
              tx,
              state.campaign.id,
              state.selected.map((lead) => ({ id: lead.id, tier: lead.tier })),
              now,
              new Map(state.selected.map((lead) => [lead.id, lead.poolId])),
            );
            enrolled += result.enrolled;
            await recordAutoEnrollmentCampaign(tx, {
              runId,
              campaignId: state.campaign.id,
              eligibleBefore: state.eligible.length,
              capRemaining: state.capRemaining,
              enrolled: result.enrolled,
              skipped: state.skipped,
            });
          }
          await setAutoEnrollmentCursor(tx, lastServedCampaignId, now);
          await finishAutoEnrollmentRun(tx, runId, {
            now: deps.clock.now(),
            lastServedCampaignId,
          });
          if (trigger === 'daily') {
            await completeAutoEnrollmentDay(tx, localDate, deps.clock.now());
          }
          return { runId, enrolled };
        },
        { isolationLevel: 'serializable' },
      );
      if (result === null) return null;
      return { runId: result.runId, enrolled: result.enrolled, localDate, trigger };
    } catch (error) {
      if (isSerializationFailure(error) && attempt < 3) continue;
      const message = error instanceof Error ? error.message : String(error);
      const failedRunId = await createAutoEnrollmentRun(deps.db, {
        trigger,
        localDate,
        capacitySnapshot: {},
        now,
      });
      await finishAutoEnrollmentRun(deps.db, failedRunId, {
        now: deps.clock.now(),
        error: message,
      });
      await deps.alerts.emit('job_failed', 'error', {
        job: 'auto-enrollment',
        trigger,
        local_date: localDate,
        error: message,
      });
      throw error;
    }
  }
  return null;
}
