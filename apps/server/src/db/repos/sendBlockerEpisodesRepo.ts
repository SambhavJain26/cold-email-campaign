import { sql } from 'drizzle-orm';
import type { DbLike } from '../client';

/** Atomically opens new episodes and closes every condition no longer active. */
export async function reconcileSendBlockerEpisodes(
  db: DbLike,
  codes: readonly string[],
  openedAt: Date,
): Promise<Set<string>> {
  if (codes.length === 0) {
    await db.execute(sql`DELETE FROM send_blocker_episodes`);
    return new Set();
  }
  await db.execute(
    sql`DELETE FROM send_blocker_episodes WHERE code <> ALL(${sql.param([...codes])}::text[])`,
  );
  const opened = await db.execute(sql`
    INSERT INTO send_blocker_episodes (code, opened_at)
    SELECT code, ${openedAt} FROM unnest(${sql.param([...codes])}::text[]) AS code
    ON CONFLICT (code) DO NOTHING
    RETURNING code`);
  return new Set((opened.rows as Array<{ code: string }>).map((row) => row.code));
}
