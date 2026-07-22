// Advisory-lock helpers (transaction-scoped). Keyspace:
//   (0, 0)              — projection-wide: rebuild holds exclusively, appends share
//   (1, enrollmentId)   — per-enrollment append serialization
import { sql } from 'drizzle-orm';
import type { DbLike } from '../client';

export async function acquireRebuildLockShared(db: DbLike): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock_shared(0, 0)`);
}

export async function acquireRebuildLockExclusive(db: DbLike): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(0, 0)`);
}

export async function lockEnrollment(db: DbLike, enrollmentId: number): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(1, ${enrollmentId})`);
}
