import { eq } from 'drizzle-orm';
import type { DbLike } from '../client';
import { operator } from '../schema';

export type OperatorRow = typeof operator.$inferSelect;

/** The single operator row (id = 1), or null before first boot seeds it. */
export async function getOperator(db: DbLike): Promise<OperatorRow | null> {
  const rows = await db.select().from(operator);
  return rows[0] ?? null;
}

export async function insertOperator(
  db: DbLike,
  input: { email: string; passwordHash: string },
): Promise<void> {
  await db.insert(operator).values({ id: 1, email: input.email, passwordHash: input.passwordHash });
}

export async function updatePasswordHash(
  db: DbLike,
  passwordHash: string,
  at: Date,
): Promise<void> {
  await db.update(operator).set({ passwordHash, updatedAt: at }).where(eq(operator.id, 1));
}
