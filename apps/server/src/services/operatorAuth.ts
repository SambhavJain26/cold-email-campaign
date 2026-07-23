// Operator account lifecycle (decision I): single row, argon2id hashes.
// ensureOperator runs at boot (main.ts) and in the API test harness -
// compose() stays side-effect-free.
import { hash, verify } from '@node-rs/argon2';
import type { DbLike } from '../db/client';
import { getOperator, insertOperator } from '../db/repos/operatorRepo';

// OWASP-recommended argon2id parameters (2024 baseline). `algorithm: 2` is
// Algorithm.Argon2id - the enum is an ambient const enum, unusable under
// verbatimModuleSyntax, so the literal is pinned here with a test in mind:
// hashes must start '$argon2id$'.
const ARGON2_OPTS = {
  algorithm: 2,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false; // malformed hash ≡ wrong password, never a 500
  }
}

/**
 * First-boot seeding: create the operator row from OPERATOR_EMAIL +
 * argon2id(OPERATOR_INITIAL_PASSWORD) if it doesn't exist yet. Idempotent -
 * an existing row (including a changed password) is never touched.
 */
export async function ensureOperator(
  db: DbLike,
  config: { OPERATOR_EMAIL: string; OPERATOR_INITIAL_PASSWORD: string },
): Promise<void> {
  const existing = await getOperator(db);
  if (existing) return;
  await insertOperator(db, {
    email: config.OPERATOR_EMAIL,
    passwordHash: await hashPassword(config.OPERATOR_INITIAL_PASSWORD),
  });
}
