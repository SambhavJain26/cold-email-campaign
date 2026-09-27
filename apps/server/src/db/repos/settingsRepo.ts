import { eq } from 'drizzle-orm';
import type { DbLike } from '../client';
import { complianceSettings, settings } from '../schema';

export type SettingsRow = typeof settings.$inferSelect;
export type SettingsPatch = Partial<Omit<SettingsRow, 'id' | 'updatedAt'>>;

/**
 * The render footer's ingredients (docs/08 §4) plus the unsubscribe base URL
 * (0010). `unsubscribeBaseUrl` is '' whenever the feature is dormant.
 */
export interface ComplianceRow {
  physicalAddress: string;
  optoutText: string;
  signatureName: string;
  signatureRoleLine: string;
  unsubscribeBaseUrl: string;
}

function toComplianceRow(row: typeof complianceSettings.$inferSelect): ComplianceRow {
  return {
    physicalAddress: row.physicalAddress,
    optoutText: row.optoutText,
    signatureName: row.signatureName,
    signatureRoleLine: row.signatureRoleLine,
    unsubscribeBaseUrl: row.unsubscribeBaseUrl,
  };
}

export async function getSettings(db: DbLike): Promise<SettingsRow> {
  const rows = await db.select().from(settings);
  const row = rows[0];
  if (!row) throw new Error('settings row missing — was 0002_seed applied?');
  return row;
}

/** The render footer's ingredients (docs/08 §4) — single seeded row (id = 1). */
export async function getComplianceSettings(db: DbLike): Promise<ComplianceRow> {
  const rows = await db.select().from(complianceSettings);
  const row = rows[0];
  if (!row) throw new Error('compliance_settings row missing — was 0002_seed applied?');
  return toComplianceRow(row);
}

/** B6.10 PUT /settings — range validation is the API layer's job (shared schema). */
export async function updateSettings(
  db: DbLike,
  patch: SettingsPatch,
  at: Date,
): Promise<SettingsRow> {
  const rows = await db
    .update(settings)
    .set({ ...patch, updatedAt: at })
    .where(eq(settings.id, 1))
    .returning();
  return rows[0]!;
}

/** B6.10 PUT /compliance — the empty-address 422 guard lives in the route. */
export async function updateComplianceSettings(
  db: DbLike,
  patch: Partial<ComplianceRow>,
  at: Date,
): Promise<ComplianceRow> {
  const rows = await db
    .update(complianceSettings)
    .set({ ...patch, updatedAt: at })
    .where(eq(complianceSettings.id, 1))
    .returning();
  return toComplianceRow(rows[0]!);
}
