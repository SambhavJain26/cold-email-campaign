// Bulk tiering (B5.6, docs/09 §4): by explicit ids or by the lead-list
// filter - "select all N matching" without shipping N ids. Tier edits never
// touch enrolled_tier (snapshotted at enrollment); they affect only future
// enrollments.
import type { LeadTier } from '@coldemail/shared';
import type { DbLike } from '../db/client';
import { updateTierByFilter, updateTierByIds, type LeadFilter } from '../db/repos/leadsRepo';

export interface BulkTierInput {
  leadIds?: number[];
  filter?: LeadFilter;
  tier: LeadTier | null; // null clears back to untiered
}

export async function bulkTier(
  deps: { db: DbLike },
  input: BulkTierInput,
): Promise<{ updated: number }> {
  const hasIds = input.leadIds !== undefined && input.leadIds.length > 0;
  const hasFilter = input.filter !== undefined;
  if (hasIds === hasFilter) {
    throw new Error('bulk-tier takes exactly one of leadIds or filter');
  }
  const updated = hasIds
    ? await updateTierByIds(deps.db, input.leadIds!, input.tier)
    : await updateTierByFilter(deps.db, input.filter!, input.tier);
  return { updated };
}

export type { LeadFilter };
