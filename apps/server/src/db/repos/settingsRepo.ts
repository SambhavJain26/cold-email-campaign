import type { DbLike } from '../client';
import { complianceSettings, settings } from '../schema';

export type SettingsRow = typeof settings.$inferSelect;

export async function getSettings(db: DbLike): Promise<SettingsRow> {
  const rows = await db.select().from(settings);
  const row = rows[0];
  if (!row) throw new Error('settings row missing - was 0002_seed applied?');
  return row;
}

/** The render footer's ingredients (docs/08 §4) - single seeded row (id = 1). */
export async function getComplianceSettings(
  db: DbLike,
): Promise<{ physicalAddress: string; optoutText: string }> {
  const rows = await db.select().from(complianceSettings);
  const row = rows[0];
  if (!row) throw new Error('compliance_settings row missing - was 0002_seed applied?');
  return { physicalAddress: row.physicalAddress, optoutText: row.optoutText };
}
