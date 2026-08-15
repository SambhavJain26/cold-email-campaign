// Capability tokens for the public unsubscribe endpoint (0010, docs/16 §8).
//
// The raw token NEVER touches the database — only its sha256 does. That is the
// whole security property: a dump of this table lets nobody unsubscribe
// anybody, because the lookup key is one-way. It also means a token cannot be
// re-read after issue, so each send attempt mints its own and every token
// issued for an enrollment stays redeemable.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { eq, isNull, and } from 'drizzle-orm';
import type { DbLike } from '../client';
import { unsubscribeTokens } from '../schema';

/** 32 bytes → 43 base64url chars. Well past guessing range for a public URL. */
const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Goes in the email and nowhere else. */
  raw: string;
}

export interface TokenTarget {
  enrollmentId: number;
  leadId: number;
  campaignId: number;
  stepNo: number;
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Tokens arrive from an untrusted URL, so the lookup must not leak timing.
 * Postgres equality on the hash is not constant-time, but the hash is of a
 * high-entropy secret, so the practical exposure is nil; this guard exists for
 * the comparison we control.
 */
function hashEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Mint a token for one send attempt. Returns the raw value exactly once. */
export async function issueToken(db: DbLike, target: TokenTarget): Promise<IssuedToken> {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  await db.insert(unsubscribeTokens).values({
    tokenHash: hashToken(raw),
    enrollmentId: target.enrollmentId,
    leadId: target.leadId,
    campaignId: target.campaignId,
    stepNo: target.stepNo,
  });
  return { raw };
}

export interface ResolvedToken {
  id: number;
  enrollmentId: number;
  leadId: number;
  campaignId: number;
  usedAt: Date | null;
}

/** Resolve a raw token from the URL. null = unknown; the caller must not say which. */
export async function resolveToken(db: DbLike, raw: string): Promise<ResolvedToken | null> {
  if (raw === '' || raw.length > 128) return null;
  const digest = hashToken(raw);
  const rows = await db
    .select({
      id: unsubscribeTokens.id,
      tokenHash: unsubscribeTokens.tokenHash,
      enrollmentId: unsubscribeTokens.enrollmentId,
      leadId: unsubscribeTokens.leadId,
      campaignId: unsubscribeTokens.campaignId,
      usedAt: unsubscribeTokens.usedAt,
    })
    .from(unsubscribeTokens)
    .where(eq(unsubscribeTokens.tokenHash, digest));
  const row = rows[0];
  if (!row || !hashEquals(row.tokenHash, digest)) return null;
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    leadId: row.leadId,
    campaignId: row.campaignId,
    usedAt: row.usedAt,
  };
}

/** Stamp first redeem. Idempotent: a second POST leaves the original time. */
export async function markUsed(db: DbLike, id: number, at: Date): Promise<void> {
  await db
    .update(unsubscribeTokens)
    .set({ usedAt: at })
    .where(and(eq(unsubscribeTokens.id, id), isNull(unsubscribeTokens.usedAt)));
}
