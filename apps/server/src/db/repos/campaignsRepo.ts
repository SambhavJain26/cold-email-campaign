import { eq } from 'drizzle-orm';
import type { PersonalizationMode } from '@coldemail/shared';
import type { DbLike } from '../client';
import { campaigns } from '../schema';

export type CampaignRow = typeof campaigns.$inferSelect;

export interface TierEffortConfig {
  A: PersonalizationMode;
  B: PersonalizationMode;
  C: PersonalizationMode;
  /** Market-keyed {{custom_observation}} segment rule (docs/08 §3), 'default' key incl. */
  auto_observations?: Record<string, string>;
}

export interface RampConfig {
  ramp_days: number;
  ramp_daily_enroll_cap: number;
}

export async function getCampaign(db: DbLike, id: number): Promise<CampaignRow | undefined> {
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return rows[0];
}

export function tierEffortOf(c: CampaignRow): TierEffortConfig {
  return c.tierEffortConfig as TierEffortConfig;
}

export function rampOf(c: CampaignRow): RampConfig {
  return c.rampConfig as RampConfig;
}

/** The campaign's auto_observations table, or null when unset (docs/08 §3). */
export function autoObservationsOf(c: CampaignRow): Record<string, string> | null {
  return tierEffortOf(c).auto_observations ?? null;
}
