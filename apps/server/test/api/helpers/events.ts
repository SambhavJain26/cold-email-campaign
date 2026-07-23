// B6.14 traceability helpers: assert exactly which events a mutation appended
// (docs/10 §Events emitted) - including the load-bearing "none" rows.
import type { Pool } from 'pg';
import { expect } from 'vitest';

/** Snapshot the log position before a mutation. */
export async function eventWatermark(pool: Pool): Promise<number> {
  const res = await pool.query('SELECT coalesce(max(id), 0)::int AS wm FROM events');
  return (res.rows[0] as { wm: number }).wm;
}

/** Assert the exact multiset of event types appended past the watermark. */
export async function expectAppended(
  pool: Pool,
  watermark: number,
  expected: Record<string, number>,
): Promise<void> {
  const res = await pool.query(
    'SELECT type, count(*)::int AS n FROM events WHERE id > $1 GROUP BY type ORDER BY type',
    [watermark],
  );
  const actual = Object.fromEntries(
    (res.rows as { type: string; n: number }[]).map((r) => [r.type, r.n]),
  );
  expect(actual).toEqual(expected);
}

export async function expectNoNewEvents(pool: Pool, watermark: number): Promise<void> {
  await expectAppended(pool, watermark, {});
}
