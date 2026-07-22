import type { DbLike } from '../client';
import { settings } from '../schema';

export type SettingsRow = typeof settings.$inferSelect;

export async function getSettings(db: DbLike): Promise<SettingsRow> {
  const rows = await db.select().from(settings);
  const row = rows[0];
  if (!row) throw new Error('settings row missing - was 0002_seed applied?');
  return row;
}
